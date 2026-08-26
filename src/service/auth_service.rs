use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use crate::auth::jwt::JwtManager;
use crate::auth::jwt_validator::JwtValidator;
use crate::auth::password::PasswordHasher;
use crate::auth::refresh::{RefreshTokenManager, RefreshTokenValue};
use crate::auth::SessionUser;
use crate::config::{Config, CookieConfig, JwtConfig};
use crate::entity::user;
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

/// Result of a successful login or refresh — what the route handler needs
/// to build the response + cookies.
pub struct AuthSession {
    pub user: user::Model,
    pub access_token: String,
    pub refresh_token: String,
}

impl AuthSession {
    /// Set the auth cookies on a `CookieJar` and return the updated jar.
    pub fn set_cookies(
        &self,
        jar: axum_extra::extract::CookieJar,
        cookie_cfg: &CookieConfig,
        jwt_cfg: &JwtConfig,
    ) -> axum_extra::extract::CookieJar {
        crate::auth::cookies::set_auth_cookies(
            jar,
            cookie_cfg,
            jwt_cfg,
            &self.access_token,
            &self.refresh_token,
        )
    }
}

/// Auth service. Constructed once at startup with shared `Arc<T>` deps
/// and stored as `Arc<AuthService>` on `AppState`.
pub struct AuthService {
    store: Arc<CompositeStore>,
    jwt: Arc<JwtManager>,
    jwt_validator: Arc<JwtValidator>,
    refresh: Arc<RefreshTokenManager>,
    password: Arc<PasswordHasher>,
    config: Arc<Config>,
}

impl AuthService {
    /// Construct from shared deps. Each dep is an `Arc<T>` cloned from
    /// the bootstrap phase — cheap (refcount bump), no allocation.
    pub fn new(
        store: Arc<CompositeStore>,
        jwt: Arc<JwtManager>,
        jwt_validator: Arc<JwtValidator>,
        refresh: Arc<RefreshTokenManager>,
        password: Arc<PasswordHasher>,
        config: Arc<Config>,
    ) -> Self {
        Self {
            store,
            jwt,
            jwt_validator,
            refresh,
            password,
            config,
        }
    }

    /// Register a new user account.
    /// - Regular users get the `user` role.
    /// - The first registered user gets the `employee` role (bootstrapping
    ///   the admin/support account). They can then log in via
    ///   `/api/auth/employee-login` to access the admin dashboard.
    pub async fn register(
        &self,
        email: String,
        username: String,
        password: String,
    ) -> AppResult<user::Model> {
        validate_email(&email)?;
        validate_username(&username)?;
        validate_password(&password)?;

        // Check if this is the first user (will become admin)
        let user_count = self.store.user_store().count_users().await?;
        let is_first_user = user_count == 0;

        let password_arc = self.password.clone();
        let pwd_for_hash = password.clone();
        let hash = tokio::task::spawn_blocking(move || password_arc.hash(&pwd_for_hash))
            .await
            .map_err(|e| AppError::Internal(format!("hash join: {e}")))?
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let role_name = if is_first_user { "employee" } else { "user" };

        let model = self
            .store
            .user_store()
            .create_user(email, username, hash, role_name.to_string())
            .await?;

        // If this is first time setup, then also create nullclaw agent
        if is_first_user {
            let _ = self
                .store
                .user_store()
                .create_user(
                    "nullclaw_agent@example.com".into(),
                    "nullclaw_agent".into(),
                    "hashed_password".into(),
                    role_name.to_string(),
                )
                .await?;
        }

        let roles = self.store.rbac_store().list_roles().await?;
        if let Some(role) = roles.iter().find(|r| r.name == role_name) {
            self.store
                .rbac_store()
                .assign_role(model.id, role.id)
                .await?;
        }

        Ok(model)
    }

    /// Exchange credentials for an auth session (access + refresh).
    pub async fn login(&self, email: String, password: String) -> AppResult<AuthSession> {
        let user = self
            .store
            .user_store()
            .get_user_by_email(email)
            .await?
            .ok_or_else(|| AppError::Unauthorized("invalid credentials".into()))?;

        let hash = user
            .password_hash
            .as_deref()
            .ok_or_else(|| AppError::Unauthorized("invalid credentials".into()))?;

        // Argon2 verify is CPU-heavy (50-150ms with default params). Run it
        // on a blocking-pool thread so we don't stall the tokio worker.
        let password_arc = self.password.clone();
        let pwd_string = password.to_string();
        let hash_string = hash.to_string();
        let password_ok =
            tokio::task::spawn_blocking(move || password_arc.verify(&pwd_string, &hash_string))
                .await
                .map_err(|e| AppError::Internal(format!("verify join: {e}")))?;

        if !password_ok {
            return Err(AppError::Unauthorized("invalid credentials".into()));
        }

        self.issue_session(user).await
    }

    /// Rotate a refresh token: revoke the old, issue a new one + new access.
    ///
    /// Uses `try_revoke_refresh_token` (atomic conditional UPDATE) so two
    /// concurrent refresh requests with the same token can't both succeed
    /// — the second `rows_affected == 0` and returns `None`, which we
    /// surface as a 401. This closes the replay-attack window that the
    /// previous `get_refresh_token` + `revoke_refresh_token` pair had.
    pub async fn refresh(&self, refresh_token: String) -> AppResult<AuthSession> {
        let value = RefreshTokenValue::parse(&refresh_token)
            .ok_or_else(|| AppError::BadRequest("malformed refresh token".into()))?;

        let model = self
            .store
            .refresh_token_store()
            .get_refresh_token(value.id)
            .await?
            .ok_or_else(|| AppError::Unauthorized("unknown refresh token".into()))?;

        if model.revoked || model.expires_at < Utc::now() {
            return Err(AppError::Unauthorized("refresh token expired".into()));
        }

        if !constant_time_eq::constant_time_eq(
            model.token_hash.as_bytes(),
            self.refresh.secret_hash(&value.secret).as_bytes(),
        ) {
            return Err(AppError::Unauthorized("refresh token mismatch".into()));
        }

        // Atomically claim the token: only the first concurrent caller wins.
        // Without this guard, two concurrent refresh requests both pass the
        // checks above and both issue fresh sessions — an infinite replay
        // window if the token is ever stolen.
        let user_id = self
            .store
            .refresh_token_store()
            .try_revoke_refresh_token(value.id)
            .await?
            .ok_or_else(|| AppError::Unauthorized("refresh token already used".into()))?;

        let user = self.store.user_store().get_user(user_id).await?;
        self.issue_session(user).await
    }

    /// Logout: revoke all refresh tokens + invalidate the cached JWT so
    /// the access token stops working immediately.
    pub async fn logout(&self, user_id: Uuid) -> AppResult<()> {
        self.store
            .refresh_token_store()
            .revoke_all_refresh_tokens_for_user(user_id)
            .await?;
        self.jwt_validator.revoke_all_for_user(user_id).await;
        Ok(())
    }

    /// Fetch the current user (after auth has been verified by the
    /// extractor). Hits the cached `get_user` path.
    pub async fn me(&self, user_id: Uuid) -> AppResult<user::Model> {
        Ok(self.store.user_store().get_user(user_id).await?)
    }

    /// Register (or link) a user via OAuth 2.0. Mirrors `register()` but
    /// skips password hashing — the user authenticated via an external
    /// provider (Facebook / Google / X-Twitter), so there's no password
    /// to verify. Instead, the `(provider, subject)` pair becomes the
    /// user's authentication credential.
    ///
    /// Behaviour:
    ///   1. If a user with this `(provider, subject)` already exists,
    ///      return them (idempotent).
    ///   2. If a user with this email already exists (registered via
    ///      password earlier), LINK the OAuth identity to them — set
    ///      `oauth_provider` + `oauth_subject` so future OAuth logins
    ///      find them by id.
    ///   3. Otherwise, create a new user with `email_verified_at = now`
    ///      (the provider verified the email).
    ///
    /// Role assignment mirrors `register()`: first user → `employee`,
    /// others → `user`.
    pub async fn register_oauth_user(
        &self,
        email: String,
        name: String,
        provider: String,
        subject: String,
        avatar_url: Option<String>,
    ) -> AppResult<user::Model> {
        let user_count = self.store.user_store().count_users().await?;
        let is_first_user = user_count == 0;
        let role_name = if is_first_user { "employee" } else { "user" };

        let model = self
            .store
            .user_store()
            .upsert_oauth_user(
                email,
                name,
                provider,
                subject,
                avatar_url,
                role_name.to_string(),
            )
            .await?;

        // Assign role (mirrors `register()`). Idempotent — if the user
        // was linked (not created), the role is already assigned; the
        // RBAC store's `assign_role` is a no-op for existing grants.
        let roles = self.store.rbac_store().list_roles().await?;
        if let Some(role) = roles.iter().find(|r| r.name == role_name) {
            let _ = self.store.rbac_store().assign_role(model.id, role.id).await;
        }

        Ok(model)
    }

    /// Determine whether a user is an employee (has any non-`"user"`
    /// role). Used by the `employee-login` route + the OAuth callback
    /// to gate employee-only endpoints.
    pub async fn is_employee(&self, user_id: Uuid) -> AppResult<bool> {
        let perms = self
            .store
            .rbac_store()
            .get_user_permissions(user_id)
            .await
            .map_err(|e| AppError::Internal(format!("failed to check roles: {e}")))?;
        Ok(perms.role_names.iter().any(|role| role != "user"))
    }

    /// Quick DB-health ping — used by the `/health` readiness check.
    /// Returns the number of roles in the RBAC table (a non-zero count
    /// means migrations ran + the DB is reachable).
    pub async fn db_ping(&self) -> AppResult<u64> {
        let count = self.store.rbac_store().list_roles().await?.len() as u64;
        Ok(count)
    }

    /// Verify an access token and return the authenticated user id.
    pub async fn verify_access_token(&self, token: &str) -> AppResult<Uuid> {
        let claims = self
            .jwt_validator
            .verify(token)
            .await
            .map_err(|e| AppError::Unauthorized(format!("invalid token: {e}")))?;
        Ok(claims.sub)
    }

    /// Verify an access token and return the full `SessionUser` (loaded
    /// from the user store). Used by transports that route by role/brand
    /// (WebSocket, audio-call) where carrying just the id isn't enough.
    pub async fn verify_access_token_session(&self, token: &str) -> AppResult<SessionUser> {
        let user_id = self.verify_access_token(token).await?;
        let user = self.store.user_store().get_user(user_id).await?;
        let mut session = SessionUser::from_model(&user);
        if let Some(brand_id) = user.brand_id {
            if let Ok(Some(brand)) = self
                .store
                .brand_store()
                .get_by_id(brand_id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))
            {
                session.brand_name = Some(brand.name);
            }
        }
        Ok(session)
    }

    /// Issue a fresh auth session: new access JWT + new refresh token
    /// (persisted).
    pub async fn issue_session(&self, user: user::Model) -> AppResult<AuthSession> {
        let id = user.id;
        let access = self
            .jwt
            .issue_access(id)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let refresh_value = RefreshTokenValue::generate();
        let refresh_model = self.refresh.build_model(&refresh_value, id, None, None);
        self.store
            .refresh_token_store()
            .save_refresh_token(refresh_model)
            .await?;

        Ok(AuthSession {
            user,
            access_token: access,
            refresh_token: refresh_value.to_cookie_value(),
        })
    }

    /// Helper for routes: clear auth cookies on logout.
    pub fn clear_cookies(
        &self,
        jar: axum_extra::extract::CookieJar,
    ) -> axum_extra::extract::CookieJar {
        crate::auth::cookies::clear_auth_cookies(jar, &self.config.cookie)
    }

    /// Expose the cookie config (route handlers need it).
    pub fn cookie_config(&self) -> &CookieConfig {
        &self.config.cookie
    }

    /// Expose the JWT config (route handlers need it for cookie TTLs).
    pub fn jwt_config(&self) -> &JwtConfig {
        &self.config.jwt
    }

    /// Expose the JWT access TTL (route handlers use it for response shaping).
    pub fn access_ttl_secs(&self) -> u64 {
        self.config.jwt.access_ttl_secs
    }
}

// ---- Validation helpers -----------------------------------------------

fn validate_email(email: &str) -> AppResult<()> {
    if email.is_empty() || !email.contains('@') || email.len() > 254 {
        return Err(AppError::Validation("invalid email".into()));
    }
    Ok(())
}

fn validate_username(username: &str) -> AppResult<()> {
    if username.len() < 3 || username.len() > 64 {
        return Err(AppError::Validation(
            "username must be 3-64 characters".into(),
        ));
    }
    Ok(())
}

fn validate_password(password: &str) -> AppResult<()> {
    if password.len() < 8 || password.len() > 128 {
        return Err(AppError::Validation(
            "password must be 8-128 characters".into(),
        ));
    }
    Ok(())
}

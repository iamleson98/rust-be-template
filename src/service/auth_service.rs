//! Auth service — registration, login, refresh rotation, logout.
//!
//! Holds its dependencies directly (no `ServiceContext` intermediary, no
//! back-reference to `AppState`). This avoids circular `Arc` references
//! and keeps the dependency surface explicit.

use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use crate::auth::csrf::CsrfManager;
use crate::auth::jwt::JwtManager;
use crate::auth::jwt_validator::JwtValidator;
use crate::auth::password::PasswordHasher;
use crate::auth::refresh::{RefreshTokenManager, RefreshTokenValue};
use crate::config::{Config, CookieConfig};
use crate::entity::users;
use crate::error::{AppError, AppResult};
use crate::store::Store;

/// Result of a successful login or refresh — what the route handler needs
/// to build the response + cookies.
pub struct AuthSession {
    pub user: users::Model,
    pub access_token: String,
    pub refresh_token: String,
    pub csrf_token: String,
}

impl AuthSession {
    /// Set the auth + CSRF cookies on a `CookieJar` and return the updated jar.
    pub fn set_cookies(
        &self,
        jar: axum_extra::extract::CookieJar,
        cfg: &CookieConfig,
    ) -> axum_extra::extract::CookieJar {
        crate::auth::cookies::set_auth_cookies(
            jar,
            cfg,
            &self.access_token,
            &self.refresh_token,
            &self.csrf_token,
        )
    }
}

/// Auth service. Constructed once at startup with shared `Arc<T>` deps
/// and stored as `Arc<AuthService>` on `AppState`.
pub struct AuthService {
    store: Arc<dyn Store>,
    jwt: Arc<JwtManager>,
    jwt_validator: Arc<JwtValidator>,
    refresh: Arc<RefreshTokenManager>,
    password: Arc<PasswordHasher>,
    csrf: Arc<CsrfManager>,
    config: Arc<Config>,
}

impl AuthService {
    /// Construct from shared deps. Each dep is an `Arc<T>` cloned from
    /// the bootstrap phase — cheap (refcount bump), no allocation.
    pub fn new(
        store: Arc<dyn Store>,
        jwt: Arc<JwtManager>,
        jwt_validator: Arc<JwtValidator>,
        refresh: Arc<RefreshTokenManager>,
        password: Arc<PasswordHasher>,
        csrf: Arc<CsrfManager>,
        config: Arc<Config>,
    ) -> Self {
        Self {
            store,
            jwt,
            jwt_validator,
            refresh,
            password,
            csrf,
            config,
        }
    }

    /// Register a new user account. Assigns the default `user` role.
    pub async fn register(
        &self,
        email: String,
        username: String,
        password: String,
    ) -> AppResult<users::Model> {
        validate_email(&email)?;
        validate_username(&username)?;
        validate_password(&password)?;

        let hash = self
            .password
            .hash(&password)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let model = self
            .store
            .create_user(email, username, hash)
            .await?;

        // Assign the default "user" role by looking it up by name.
        let roles = self.store.list_roles().await?;
        if let Some(role) = roles.iter().find(|r| r.name == "user") {
            let _ = self.store.assign_role(model.id, role.id).await;
        }

        Ok(model)
    }

    /// Exchange credentials for an auth session (access + refresh + csrf).
    pub async fn login(&self, email: String, password: String) -> AppResult<AuthSession> {
        let user = self
            .store
            .get_user_by_email(email)
            .await?
            .ok_or_else(|| AppError::Unauthorized("invalid credentials".into()))?;

        if !self.password.verify(&password, &user.password_hash) {
            return Err(AppError::Unauthorized("invalid credentials".into()));
        }

        self.issue_session(user).await
    }

    /// Rotate a refresh token: revoke the old, issue a new one + new access.
    pub async fn refresh(&self, refresh_token: String) -> AppResult<AuthSession> {
        let value = RefreshTokenValue::parse(&refresh_token)
            .ok_or_else(|| AppError::BadRequest("malformed refresh token".into()))?;

        let model = self
            .store
            .get_refresh_token(value.id)
            .await?
            .ok_or_else(|| AppError::Unauthorized("unknown refresh token".into()))?;

        if model.revoked || model.expires_at < Utc::now() {
            return Err(AppError::Unauthorized("refresh token expired".into()));
        }

        if !constant_time_eq::constant_time_eq(
            model.token_hash.as_bytes(),
            value.secret_hash().as_bytes(),
        ) {
            return Err(AppError::Unauthorized("refresh token mismatch".into()));
        }

        // Rotate: revoke the old token, issue a new one for the same user.
        let user_id = model.user_id;
        self.store.revoke_refresh_token(value.id).await?;

        let user = self.store.get_user(user_id).await?;
        self.issue_session(user).await
    }

    /// Logout: revoke all refresh tokens + invalidate the cached JWT so
    /// the access token stops working immediately.
    pub async fn logout(&self, user_id: Uuid) -> AppResult<()> {
        self.store
            .revoke_all_refresh_tokens_for_user(user_id)
            .await?;
        self.jwt_validator.revoke_all_for_user(user_id).await;
        Ok(())
    }

    /// Fetch the current user (after auth has been verified by the
    /// extractor). Hits the cached `get_user` path.
    pub async fn me(&self, user_id: Uuid) -> AppResult<users::Model> {
        Ok(self.store.get_user(user_id).await?)
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

    /// Issue a fresh auth session: new access JWT + new refresh token
    /// (persisted) + new CSRF token.
    async fn issue_session(&self, user: users::Model) -> AppResult<AuthSession> {
        let access = self
            .jwt
            .issue_access(user.id)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let refresh_value = RefreshTokenValue::generate();
        let refresh_model = self
            .refresh
            .build_model(&refresh_value, user.id, None, None);
        self.store.save_refresh_token(refresh_model).await?;

        let csrf = self
            .csrf
            .issue(chrono::Duration::seconds(self.config.csrf.token_ttl_secs as i64));

        Ok(AuthSession {
            user,
            access_token: access,
            refresh_token: refresh_value.to_cookie_value(),
            csrf_token: csrf,
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

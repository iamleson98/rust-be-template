use std::sync::Arc;

use axum::http::{header::USER_AGENT, HeaderMap};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::auth::account::{NewAccount, NewBot, PasswordRehash};
use crate::auth::jwt::JwtManager;
use crate::auth::jwt_validator::JwtValidator;
use crate::auth::oauth::OAuthProfile;
use crate::auth::password::{needs_rehash, PasswordHasher};
use crate::auth::refresh::{RefreshTokenManager, RefreshTokenValue};
use crate::auth::SessionUser;
use crate::config::{Config, CookieConfig, JwtConfig};
use crate::entity::{refresh_tokens, user};
use crate::error::{AppError, AppResult};
use crate::nullclaw::NULLCLAW_BOT_EMAIL;
use crate::store::{CompositeStore, StoreError};

/// Which client a session is for: the mobile app's sessions last longer
/// (`JwtConfig::mobile_refresh_ttl_secs`), renewed on every refresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    Browser,
    Mobile,
}

impl SessionKind {
    /// The mobile app says so with `X-Client: mobile`.
    pub fn of(headers: &axum::http::HeaderMap) -> Self {
        let mobile = headers
            .get("x-client")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("mobile"));
        if mobile {
            Self::Mobile
        } else {
            Self::Browser
        }
    }
}

/// What a new session remembers about the request that opened it.
#[derive(Debug, Clone)]
pub struct SessionContext {
    pub kind: SessionKind,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
}

/// Longest `User-Agent` kept on a refresh token.
const USER_AGENT_MAX_CHARS: usize = 512;

impl SessionContext {
    pub fn of(headers: &HeaderMap) -> Self {
        Self {
            kind: SessionKind::of(headers),
            user_agent: headers
                .get(USER_AGENT)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.chars().take(USER_AGENT_MAX_CHARS).collect()),
            ip: crate::middleware::header_client_ip(headers).map(|ip| ip.to_string()),
        }
    }
}

/// Why a sign-in was refused.
#[derive(Debug)]
pub enum LoginError {
    /// Too many wrong passwords: the account is locked for another
    /// `retry_after_secs` seconds, whatever password is tried.
    Locked {
        retry_after_secs: u64,
    },
    Failed(AppError),
}

impl From<AppError> for LoginError {
    fn from(e: AppError) -> Self {
        Self::Failed(e)
    }
}

impl From<StoreError> for LoginError {
    fn from(e: StoreError) -> Self {
        Self::Failed(e.into())
    }
}

impl axum::response::IntoResponse for LoginError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Failed(e) => e.into_response(),
            Self::Locked { retry_after_secs } => {
                let mut response = AppError::TooManyRequests(LOCKED_MESSAGE.into()).into_response();
                response
                    .headers_mut()
                    .insert(axum::http::header::RETRY_AFTER, retry_after_secs.into());
                response
            }
        }
    }
}

const LOCKED_MESSAGE: &str =
    "too many failed sign-in attempts, try again later or reset your password";

/// Credentials of a sign-in: an email, or the phone given at registration.
pub struct LoginInput {
    pub email: Option<String>,
    pub phone: Option<String>,
    pub password: String,
}

/// A registration, as validated by the route.
pub struct RegisterInput {
    pub full_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub password: String,
    pub locale: Option<String>,
}

/// The number as the Worker stores it: `+84…` stays, a leading `0`
/// becomes `+84`, anything else is kept as typed.
pub fn normalize_account_phone(phone: &str) -> String {
    let phone = phone.trim();
    if phone.starts_with("+84") {
        phone.to_string()
    } else if let Some(rest) = phone.strip_prefix('0') {
        format!("+84{rest}")
    } else {
        phone.to_string()
    }
}

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

    /// Register a new password account.
    /// - Regular users get the `user` role.
    /// - The first registered HUMAN user gets the `admin` role
    ///   (bootstrapping the system administrator — full permissions).
    ///   The role is chosen inside the INSERT, so two simultaneous first
    ///   signups cannot both become admin, and the NullClaw bot never
    ///   counts as a human. They can then log in via
    ///   `/api/auth/employee-login` to access the admin dashboard, and can
    ///   mint `employee` accounts from the Users admin page.
    /// - The first admin brings the NullClaw bot support account (an
    ///   `employee` with `is_bot = true`).
    /// - A phone-only signup keeps the number in the email column too, so
    ///   the unique email key still identifies the account.
    pub async fn register(&self, input: RegisterInput) -> AppResult<user::Model> {
        let email = input
            .email
            .filter(|e| !e.is_empty())
            .map(|e| e.to_lowercase());
        let phone = input
            .phone
            .filter(|p| !p.is_empty())
            .map(|p| normalize_account_phone(&p));
        if email.is_none() && phone.is_none() {
            return Err(AppError::Validation("Email or phone is required".into()));
        }
        if let Some(email) = &email {
            validate_email(email)?;
        }
        validate_username(&input.full_name)?;
        validate_password(&input.password)?;

        // Argon2 on the DEDICATED worker pool — never `spawn_blocking`.
        // Tokio's blocking pool spins up a fresh thread per busy slot and
        // the engine's mimalloc (purge_delay=-1) strands Argon2's multi-MB
        // working set in each thread's local heap: measured +2.5 MB PER
        // LOGIN, permanent (60 concurrent logins = +154 MB, 2026-09-21
        // incident — see `auth::password::workers`). The dedicated pool
        // reuses two fixed threads, so the working set is allocated once
        // and reused for every future hash/verify.
        let password_hash = self
            .password
            .hash_async(input.password)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let account = NewAccount {
            full_name: input.full_name,
            email,
            phone,
            password_hash,
            locale: if input.locale.as_deref() == Some("en") {
                "en"
            } else {
                "vi"
            }
            .into(),
        };
        self.store
            .user_store()
            .register_account(account, bot_account())
            .await
            .map_err(conflict_as_app_error)
    }

    /// Check credentials and return the account, without opening a session.
    ///
    /// A wrong email and a wrong password are the same 401, answered in the
    /// same time: an unknown account is verified against a decoy hash.
    /// Consecutive wrong passwords lock the account
    /// (`AUTH_LOCKOUT_MAX_FAILURES` for `AUTH_LOCKOUT_SECS`); an account
    /// that is not active is only reported to someone who knew its
    /// password. A hash that is not current Argon2id (the Worker's PBKDF2,
    /// or older parameters) is replaced now that the plaintext is at hand.
    pub async fn authenticate(
        &self,
        input: LoginInput,
        ip: Option<String>,
    ) -> Result<user::Model, LoginError> {
        let users = self.store.user_store();
        let found = match (input.email.as_deref(), input.phone.as_deref()) {
            (Some(email), _) => users.find_account_by_email(email).await?,
            (None, Some(phone)) => {
                let mut spellings = vec![phone.to_string(), normalize_account_phone(phone)];
                spellings.dedup();
                users.find_account_by_phone(&spellings).await?
            }
            (None, None) => None,
        };
        let Some((user, hash)) = found.and_then(|u| u.password_hash.clone().map(|h| (u, h))) else {
            // Same work as a real check, so the answer time does not tell
            // whether the account exists.
            self.password.spend_verify_time(input.password).await;
            return Err(invalid_credentials().into());
        };

        if let Some(retry_after_secs) =
            lock_remaining_secs(user.locked_until.as_deref(), Utc::now())
        {
            return Err(LoginError::Locked { retry_after_secs });
        }
        // Argon2 verify is CPU-heavy (50-150ms with default params) and —
        // critically — allocates a multi-MB working set. It runs on the
        // DEDICATED worker pool, NOT `tokio::task::spawn_blocking` (see
        // `register` and `auth::password::workers`).
        if !self
            .password
            .verify_async(input.password.clone(), hash.clone())
            .await
        {
            let lockout = &self.config.auth;
            users
                .record_failed_login(user.id, lockout.lockout_max_failures, lockout.lockout_secs)
                .await?;
            return Err(invalid_credentials().into());
        }
        if user.status != "active" {
            return Err(inactive_account(&user).into());
        }

        let rehash = if needs_rehash(&hash) {
            let new = self
                .password
                .hash_async(input.password)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            Some(PasswordRehash { old: hash, new })
        } else {
            None
        };
        users.record_login_success(user.id, ip, rehash).await?;
        Ok(user)
    }

    /// Exchange credentials for an auth session (access + refresh).
    pub async fn login(
        &self,
        input: LoginInput,
        ctx: SessionContext,
    ) -> Result<AuthSession, LoginError> {
        let user = self.authenticate(input, ctx.ip.clone()).await?;
        Ok(self.issue_session(user, ctx).await?)
    }

    /// Change the signed-in user's password. The current one must match;
    /// an account made through Google/Facebook has none and sets its first.
    /// Every other device is signed out (their refresh tokens are revoked);
    /// this one gets a fresh session of its own kind (the mobile app's
    /// lasts longer).
    pub async fn change_password(
        &self,
        user_id: Uuid,
        current: Option<String>,
        new: String,
        ctx: SessionContext,
    ) -> AppResult<AuthSession> {
        let user = self.active_user(user_id).await?;
        if let Some(hash) = user.password_hash.clone() {
            let matches = match current {
                Some(current) => self.password.verify_async(current, hash).await,
                None => false,
            };
            // 400, not 401: a wrong current password must not end the session.
            if !matches {
                return Err(AppError::BadRequest("current password is incorrect".into()));
            }
        }
        let hash = self
            .password
            .hash_async(new)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let users = self.store.user_store();
        users.change_password(user_id, &hash).await?;
        self.issue_session(users.get_user(user_id).await?, ctx)
            .await
    }

    /// Rotate a refresh token: revoke the old, issue a new one + new access.
    ///
    /// Uses `try_revoke_refresh_token` (atomic conditional UPDATE) so two
    /// concurrent refresh requests with the same token can't both succeed
    /// — the second `rows_affected == 0` and returns `None`, which we
    /// surface as a 401. This closes the replay-attack window that the
    /// previous `get_refresh_token` + `revoke_refresh_token` pair had.
    pub async fn refresh(
        &self,
        refresh_token: String,
        ctx: SessionContext,
    ) -> AppResult<AuthSession> {
        let (value, _model) = self.verified_refresh_token(&refresh_token).await?;

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
        if user.status != "active" {
            return Err(inactive_account(&user));
        }
        self.issue_session(user, ctx).await
    }

    /// Logout — multi-session aware.
    ///
    /// Default (`all = false`): revoke ONLY the session the requesting
    /// device presented — its refresh token (cookie or body) and its
    /// access token (cookie or Bearer header). The user's OTHER devices
    /// (e.g. web console + phone app logged in at the same time) keep
    /// working: their refresh tokens stay valid, so the mobile app keeps
    /// auto-logging in after session expiry.
    ///
    /// `all = true` ("log out on all devices"): revoke every refresh
    /// token for the user AND kill all outstanding access tokens.
    pub async fn logout(
        &self,
        user_id: Uuid,
        refresh_token: Option<&str>,
        access_token: Option<&str>,
        all: bool,
    ) -> AppResult<()> {
        if all {
            self.store
                .refresh_token_store()
                .revoke_all_refresh_tokens_for_user(user_id)
                .await?;
            self.jwt_validator.revoke_all_for_user(user_id).await;
            return Ok(());
        }

        // Current session only. The revoke itself is pinned to the caller,
        // so a client cannot end someone ELSE's session by posting a token
        // that isn't theirs; one that is already revoked or expired is
        // simply a no-op.
        if let Some(value) = refresh_token.and_then(RefreshTokenValue::parse) {
            self.store
                .refresh_token_store()
                .try_revoke_owned_refresh_token(value.id, user_id)
                .await?;
        }
        if let Some(at) = access_token {
            self.jwt_validator.revoke(at).await;
        }
        Ok(())
    }

    /// Logout when the access token is missing/expired but the browser still
    /// has a refresh cookie. The token is verified (it exists, is live and
    /// matches its stored hash) before anything is revoked, and only that
    /// one session (the cookie's token) is.
    pub async fn logout_by_refresh_token(&self, refresh_token: String) -> AppResult<()> {
        let (value, _model) = self.verified_refresh_token(&refresh_token).await?;
        self.store
            .refresh_token_store()
            .try_revoke_refresh_token(value.id)
            .await?;
        Ok(())
    }

    async fn verified_refresh_token(
        &self,
        refresh_token: &str,
    ) -> AppResult<(RefreshTokenValue, refresh_tokens::Model)> {
        let value = RefreshTokenValue::parse(refresh_token)
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

        Ok((value, model))
    }

    /// Fetch the current user (after auth has been verified by the
    /// extractor). Hits the cached `get_user` path.
    pub async fn me(&self, user_id: Uuid) -> AppResult<user::Model> {
        self.active_user(user_id).await
    }

    /// The active account behind a verified identity. A token outlives its
    /// account (deleted or blocked since it was issued): that is a 401 like
    /// any other bad token, never a 404 or a working session.
    async fn active_user(&self, user_id: Uuid) -> AppResult<user::Model> {
        match self.store.user_store().get_user(user_id).await {
            Ok(user) if user.status == "active" => Ok(user),
            Ok(_) | Err(StoreError::NotFound(_)) => {
                Err(AppError::Unauthorized("account is not available".into()))
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Register (or link) a user via OAuth 2.0. Mirrors `register()` but
    /// skips password hashing — the user authenticated via an external
    /// provider (Facebook / Google), so there's no password
    /// to verify. Instead, the `(provider, subject)` pair becomes the
    /// user's authentication credential.
    ///
    /// Behaviour (one write transaction, see `UserStore::upsert_oauth_user`):
    ///   1. If a user with this `(provider, subject)` already exists,
    ///      return them (idempotent).
    ///   2. If a user with this email already exists (registered via
    ///      password earlier), LINK the OAuth identity to them and mark
    ///      the email verified. When that email was never verified, the
    ///      password account may have been registered by a stranger: its
    ///      password is cleared and every refresh token revoked.
    ///   3. Otherwise, create a new user with `email_verified_at = now`
    ///      (the provider verified the email).
    ///
    /// Role assignment mirrors `register()`: first HUMAN user → `admin`
    /// (with the support bot), others → `user`.
    pub async fn register_oauth_user(&self, profile: OAuthProfile) -> AppResult<user::Model> {
        let user = self
            .store
            .user_store()
            .upsert_oauth_user(profile, bot_account())
            .await
            .map_err(conflict_as_app_error)?;
        if user.status != "active" {
            return Err(inactive_account(&user));
        }
        Ok(user)
    }

    /// Determine whether a user is staff — an `employee` OR `admin`
    /// (has any non-`"user"` role). Used by the `employee-login` route
    /// + the OAuth callback to gate staff-only endpoints.
    pub async fn is_employee(&self, user_id: Uuid) -> AppResult<bool> {
        let perms = self
            .store
            .rbac_store()
            .get_user_permissions(user_id)
            .await
            .map_err(|e| AppError::Internal(format!("failed to check roles: {e}")))?;
        Ok(perms.role_names.iter().any(|role| role != "user"))
    }

    /// Ensure the NullClaw bot support account exists in its canonical
    /// state: `role = "employee"`, `is_bot = true`, employee RBAC
    /// grant attached.
    ///
    /// Called once at server bootstrap so databases set up before the
    /// three-role split (where the bot was created as a plain `user`
    /// with `is_bot = false`) self-heal on the next boot — no data
    /// migration needed. A no-op when the bot row is already
    /// canonical; a no-op when the bot doesn't exist yet (it is created
    /// at first-human signup).
    pub async fn ensure_bot_account(&self) -> AppResult<()> {
        // 1. Fix the role/is_bot columns on the bot row (if it exists
        //    and isn't canonical).
        if let Some(bot) = self
            .store
            .user_store()
            .normalize_bot_account(NULLCLAW_BOT_EMAIL)
            .await?
        {
            tracing::info!(
                bot_id = %bot.id,
                "normalized NullClaw bot account to role=employee, is_bot=true"
            );
        }

        // 2. Ensure the employee RBAC grant is attached (databases
        //    where signup ran before the grant logic shipped).
        let bot = self
            .store
            .user_store()
            .get_user_by_email(NULLCLAW_BOT_EMAIL.to_string())
            .await?;
        let Some(bot) = bot else {
            return Ok(()); // not created yet — first signup will handle it
        };

        let perms = self
            .store
            .rbac_store()
            .get_user_permissions(bot.id)
            .await
            .map_err(|e| AppError::Internal(format!("failed to load bot roles: {e}")))?;
        if perms.role_names.iter().any(|r| r == "employee") {
            return Ok(()); // grant already present
        }

        let roles = self.store.rbac_store().list_roles().await?;
        if let Some(role) = roles.iter().find(|r| r.name == "employee") {
            self.store
                .rbac_store()
                .assign_role(bot.id, role.id)
                .await
                .map_err(|e| AppError::Internal(format!("failed to grant bot role: {e}")))?;
            tracing::info!(bot_id = %bot.id, "granted the employee role to the NullClaw bot");
        }
        Ok(())
    }

    /// Find a user by email. Used by webhook handlers to find/create
    /// platform users (Zalo, Messenger, Telegram, Discord).
    pub async fn get_user_by_email(&self, email: String) -> AppResult<Option<user::Model>> {
        self.store
            .user_store()
            .get_user_by_email(email)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Create a platform user — a lightweight `user` row for an external
    /// platform user (Zalo/Messenger/Telegram/Discord). The password is
    /// random (never used — these users are identified by webhook events,
    /// not by password login).
    pub async fn create_platform_user(
        &self,
        email: String,
        name: String,
    ) -> AppResult<user::Model> {
        self.store
            .user_store()
            .create_user(email, name, uuid::Uuid::new_v4().to_string(), "user".into())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Quick DB-health ping — used by the `/health` readiness check.
    /// Returns the number of roles in the RBAC table (a non-zero count
    /// means migrations ran + the DB is reachable).
    pub async fn db_ping(&self) -> AppResult<u64> {
        let count = self.store.rbac_store().list_roles().await?.len() as u64;
        Ok(count)
    }

    /// Verify an access token and return the authenticated user id. The
    /// account must still exist and be active.
    pub async fn verify_access_token(&self, token: &str) -> AppResult<Uuid> {
        Ok(self.verified_user(token).await?.id)
    }

    /// Verify an access token and return the full `SessionUser` (loaded
    /// from the user store). Used by transports that route by role/brand
    /// (WebSocket, audio-call) where carrying just the id isn't enough.
    pub async fn verify_access_token_session(&self, token: &str) -> AppResult<SessionUser> {
        let user = self.verified_user(token).await?;
        self.session_user(user).await
    }

    async fn verified_user(&self, token: &str) -> AppResult<user::Model> {
        let claims = self
            .jwt_validator
            .verify(token)
            .await
            .map_err(|e| AppError::Unauthorized(format!("invalid token: {e}")))?;
        self.active_user(claims.sub).await
    }

    async fn session_user(&self, user: user::Model) -> AppResult<SessionUser> {
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

    /// Build a `SessionUser` from a user id (no token verification —
    /// the caller has ALREADY authenticated the id via `AuthUser`).
    /// Used by REST routes that need the role/brand for routing
    /// decisions (chat assignment actions).
    pub async fn session_user_by_id(&self, user_id: Uuid) -> AppResult<SessionUser> {
        let user = self.active_user(user_id).await?;
        self.session_user(user).await
    }

    /// Issue a fresh auth session: new access JWT + new refresh token
    /// (persisted, with the client that asked for it).
    pub async fn issue_session(
        &self,
        user: user::Model,
        ctx: SessionContext,
    ) -> AppResult<AuthSession> {
        let id = user.id;
        let access = self
            .jwt
            .issue_access(id)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let refresh_value = RefreshTokenValue::generate();
        let refresh_model = self.refresh.build_model_for(
            &refresh_value,
            id,
            ctx.user_agent,
            ctx.ip,
            ctx.kind == SessionKind::Mobile,
        );
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

// ---- Helpers ----------------------------------------------------------

fn invalid_credentials() -> AppError {
    AppError::Unauthorized("invalid credentials".into())
}

/// An account that is blocked or otherwise not active: the reason the
/// staff gave, else a generic one.
fn inactive_account(user: &user::Model) -> AppError {
    AppError::Forbidden(
        user.block_reason
            .clone()
            .unwrap_or_else(|| "account is not active".into()),
    )
}

/// Seconds the account stays locked (rounded up), `None` when it is not
/// locked or the lock has run out.
fn lock_remaining_secs(locked_until: Option<&str>, now: DateTime<Utc>) -> Option<u64> {
    let until = DateTime::parse_from_rfc3339(locked_until?).ok()?;
    let millis = (until.with_timezone(&Utc) - now).num_milliseconds();
    (millis > 0).then(|| ((millis + 999) / 1000) as u64)
}

/// The support bot created together with the first admin.
fn bot_account() -> NewBot {
    NewBot {
        email: NULLCLAW_BOT_EMAIL.to_string(),
        full_name: "nullclaw_agent".into(),
        // Not a hash: the bot can never sign in.
        password_hash: "hashed_password".into(),
    }
}

/// A taken email or phone is the caller's conflict (409), not a store fault.
fn conflict_as_app_error(e: StoreError) -> AppError {
    match e {
        StoreError::Conflict(message) => AppError::Conflict(message),
        other => other.into(),
    }
}

// ---- Validation helpers -----------------------------------------------

fn validate_email(email: &str) -> AppResult<()> {
    if email.is_empty() || !email.contains('@') || email.len() > 254 {
        return Err(AppError::Validation("invalid email".into()));
    }
    Ok(())
}

/// The display name, counted in characters: a 22-letter Vietnamese name
/// is more than 22 bytes.
fn validate_username(username: &str) -> AppResult<()> {
    if !(3..=64).contains(&username.chars().count()) {
        return Err(AppError::Validation(
            "username must be 3-64 characters".into(),
        ));
    }
    Ok(())
}

fn validate_password(password: &str) -> AppResult<()> {
    if !(8..=128).contains(&password.chars().count()) {
        return Err(AppError::Validation(
            "password must be 8-128 characters".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phones_are_normalised_like_the_worker_does() {
        assert_eq!(normalize_account_phone("0912345678"), "+84912345678");
        assert_eq!(normalize_account_phone(" 0912345678 "), "+84912345678");
        assert_eq!(normalize_account_phone("+84912345678"), "+84912345678");
        assert_eq!(normalize_account_phone("+1415555"), "+1415555");
        assert_eq!(normalize_account_phone("912345678"), "912345678");
    }

    #[test]
    fn the_lock_runs_out_at_its_deadline() {
        let now = DateTime::parse_from_rfc3339("2026-11-15T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(lock_remaining_secs(None, now), None);
        assert_eq!(lock_remaining_secs(Some("garbage"), now), None);
        assert_eq!(lock_remaining_secs(Some("2026-11-15T10:00:00Z"), now), None);
        assert_eq!(lock_remaining_secs(Some("2026-11-15T09:59:00Z"), now), None);
        assert_eq!(
            lock_remaining_secs(Some("2026-11-15T10:15:00Z"), now),
            Some(900)
        );
        // Partial seconds round up, as the Worker's `Retry-After` does.
        assert_eq!(
            lock_remaining_secs(Some("2026-11-15T10:00:00.001Z"), now),
            Some(1)
        );
    }

    #[test]
    fn the_display_name_limit_counts_characters() {
        assert!(validate_username(&"ệ".repeat(64)).is_ok());
        assert!(validate_username(&"ệ".repeat(65)).is_err());
        assert!(validate_username("Ệ").is_err());
        assert!(validate_username("Ệệ").is_err());
        assert!(validate_username("Ệệệ").is_ok());
    }

    #[test]
    fn the_password_limit_counts_characters() {
        assert!(validate_password(&"ệ".repeat(8)).is_ok());
        assert!(validate_password(&"ệ".repeat(128)).is_ok());
        assert!(validate_password(&"ệ".repeat(129)).is_err());
        assert!(validate_password("short").is_err());
    }
}

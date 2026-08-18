use axum::extract::State;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use validator::Validate;

use crate::entity::user;
use crate::error::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::state::AppState;

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    #[validate(length(min = 1, max = 128))]
    pub full_name: String,
    #[validate(email)]
    pub email: Option<String>,
    #[validate(custom(function = "validate_phone"))]
    pub phone: Option<String>,
    #[validate(length(min = 8, max = 128))]
    pub password: String,
}

fn validate_phone(phone: &str) -> Result<(), validator::ValidationError> {
    if phone.is_empty() || (phone.starts_with('0') && phone.len() >= 9 && phone.len() <= 11) {
        Ok(())
    } else {
        Err(validator::ValidationError::new("invalid_phone"))
    }
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct LoginRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 1))]
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AuthResponse {
    pub user: crate::auth::SessionUser,
    pub expires_at: DateTime<Utc>,
}

impl AuthResponse {
    fn from_user(u: &user::Model, access_ttl_secs: u64) -> Self {
        Self {
            user: crate::auth::SessionUser::from_model(u),
            expires_at: Utc::now() + chrono::Duration::seconds(access_ttl_secs as i64),
        }
    }
}

/// `POST /api/auth/register` — create a new user account + auto-login.
///
/// Issues auth cookies immediately on success so the user doesn't need to
/// call `/login` separately.
#[utoipa::path(
    post,
    path = "/api/auth/register",
    tag = "auth",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "Account created + logged in", body = AuthResponse),
        (status = 409, description = "Email/username already taken"),
    )
)]
pub async fn register(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    Json(body): Json<RegisterRequest>,
) -> AppResult<(axum_extra::extract::CookieJar, Json<AuthResponse>)> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    // Require either email or phone
    let email = body
        .email
        .filter(|e| !e.is_empty())
        .or(body.phone.filter(|p| !p.is_empty()))
        .ok_or_else(|| AppError::Validation("Email or phone is required".into()))?;

    // Use full_name as username
    let user = state
        .auth
        .register(email, body.full_name, body.password)
        .await?;

    // Auto-login: issue a session immediately so the user doesn't need
    // to call /login separately after registering.
    let session = state.auth.issue_session(user).await?;
    let jar = session.set_cookies(jar, state.auth.cookie_config(), state.auth.jwt_config());
    Ok((
        jar,
        Json(AuthResponse::from_user(
            &session.user,
            state.auth.access_ttl_secs(),
        )),
    ))
}

/// `POST /api/auth/login` — exchange credentials for cookies.
#[utoipa::path(
    post,
    path = "/api/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful", body = AuthResponse),
        (status = 401, description = "Invalid credentials"),
    )
)]
pub async fn login(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    Json(body): Json<LoginRequest>,
) -> AppResult<(axum_extra::extract::CookieJar, Json<AuthResponse>)> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let session = state.auth.login(body.email, body.password).await?;
    let jar = session.set_cookies(jar, state.auth.cookie_config(), state.auth.jwt_config());
    Ok((
        jar,
        Json(AuthResponse::from_user(
            &session.user,
            state.auth.access_ttl_secs(),
        )),
    ))
}

/// `POST /api/auth/employee-login` — employee-only login (rejects regular users).
#[utoipa::path(
    post,
    path = "/api/auth/employee-login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Employee login successful", body = AuthResponse),
        (status = 401, description = "Invalid credentials"),
        (status = 403, description = "Not an employee"),
    )
)]
pub async fn employee_login(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    Json(body): Json<LoginRequest>,
) -> AppResult<(axum_extra::extract::CookieJar, Json<AuthResponse>)> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let session = state.auth.login(body.email, body.password).await?;

    // Check the user_roles table (source of truth) for non-"user" roles
    let user_perms = state
        .store
        .rbac_store()
        .get_user_permissions(session.user.id)
        .await
        .map_err(|e| AppError::Internal(format!("failed to check roles: {e}")))?;

    // Only allow employees (must have at least one role that isn't "user")
    let is_employee = user_perms.role_names.iter().any(|role| role != "user");

    if !is_employee {
        return Err(AppError::Forbidden(
            "This endpoint is for employees only".into(),
        ));
    }

    let jar = session.set_cookies(jar, state.auth.cookie_config(), state.auth.jwt_config());
    Ok((
        jar,
        Json(AuthResponse::from_user(
            &session.user,
            state.auth.access_ttl_secs(),
        )),
    ))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RefreshRequest {
    /// Optional refresh token in the body. If absent, the token is read
    /// from the `refresh_token` httpOnly cookie. Accepting it from the
    /// body is a fallback for non-browser clients (curl, mobile) that
    /// can't use cookies.
    pub refresh_token: Option<String>,
}

/// `POST /api/auth/refresh` — rotate refresh token, issue new access.
///
/// Reads the refresh token from the httpOnly cookie first (preferred —
/// the token never touches JS), then falls back to the request body
/// (for non-browser clients).
#[utoipa::path(
    post,
    path = "/api/auth/refresh",
    tag = "auth",
    request_body = RefreshRequest,
    responses((status = 200, description = "Rotated tokens", body = AuthResponse))
)]
pub async fn refresh(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    Json(body): Json<RefreshRequest>,
) -> AppResult<(axum_extra::extract::CookieJar, Json<AuthResponse>)> {
    // Read refresh token: cookie first (preferred — JS can't read it),
    // body as fallback for non-browser clients.
    use crate::auth::cookies::extract_tokens;
    let (_, cookie_refresh) = extract_tokens(&jar);
    let refresh_token = cookie_refresh
        .or(body.refresh_token)
        .ok_or_else(|| AppError::Unauthorized("missing refresh token".into()))?;
    let session = state.auth.refresh(refresh_token).await?;
    let jar = session.set_cookies(jar, state.auth.cookie_config(), state.auth.jwt_config());
    Ok((
        jar,
        Json(AuthResponse::from_user(
            &session.user,
            state.auth.access_ttl_secs(),
        )),
    ))
}

/// `POST /api/auth/logout` — revoke all refresh tokens + clear cookies.
#[utoipa::path(
    post,
    path = "/api/auth/logout",
    tag = "auth",
    responses((status = 204, description = "Logged out"))
)]
pub async fn logout(
    State(state): State<AppState>,
    jar: axum_extra::extract::CookieJar,
    AuthUser(user_id): AuthUser,
) -> AppResult<axum_extra::extract::CookieJar> {
    state.auth.logout(user_id).await?;
    Ok(state.auth.clear_cookies(jar))
}

/// `GET /api/auth/me` — return the current authenticated user's info.
#[utoipa::path(
    get,
    path = "/api/auth/me",
    tag = "auth",
    responses((status = 200, description = "Current user", body = AuthResponse))
)]
pub async fn me(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<AuthResponse>> {
    let user = state.auth.me(user_id).await?;
    Ok(Json(AuthResponse::from_user(
        &user,
        state.auth.access_ttl_secs(),
    )))
}

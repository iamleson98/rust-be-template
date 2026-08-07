use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use crate::entity::users;
use crate::error::{AppError, AppResult};
use crate::middleware::AuthUser;
use crate::state::AppState;

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct RegisterRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 3, max = 64))]
    pub username: String,
    #[validate(length(min = 8, max = 128))]
    pub password: String,
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
    pub user_id: Uuid,
    pub username: String,
    pub email: String,
    pub expires_at: DateTime<Utc>,
}

impl AuthResponse {
    fn from_user(u: &users::Model, access_ttl_secs: u64) -> Self {
        Self {
            user_id: u.id,
            username: u.username.clone(),
            email: u.email.clone(),
            expires_at: Utc::now() + chrono::Duration::seconds(access_ttl_secs as i64),
        }
    }
}

/// `POST /api/auth/register` — create a new user account.
#[utoipa::path(
    post,
    path = "/api/auth/register",
    tag = "auth",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "Account created", body = AuthResponse),
        (status = 409, description = "Email/username already taken"),
    )
)]
pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> AppResult<Json<AuthResponse>> {
    body.validate().map_err(|e| AppError::Validation(e.to_string()))?;
    let user = state
        .auth
        .register(body.email, body.username, body.password)
        .await?;
    Ok(Json(AuthResponse::from_user(
        &user,
        state.auth.access_ttl_secs(),
    )))
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
    body.validate().map_err(|e| AppError::Validation(e.to_string()))?;
    let session = state.auth.login(body.email, body.password).await?;
    let jar = session.set_cookies(jar, state.auth.cookie_config());
    Ok((
        jar,
        Json(AuthResponse::from_user(&session.user, state.auth.access_ttl_secs())),
    ))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

/// `POST /api/auth/refresh` — rotate refresh token, issue new access.
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
    let session = state.auth.refresh(body.refresh_token).await?;
    let jar = session.set_cookies(jar, state.auth.cookie_config());
    Ok((
        jar,
        Json(AuthResponse::from_user(&session.user, state.auth.access_ttl_secs())),
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

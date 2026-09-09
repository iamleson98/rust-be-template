//! Push-device routes — `POST /api/push/devices`,
//! `DELETE /api/push/devices/{token}`.
//!
//! Clients register their FCM/APNs token right after login so the
//! server can wake the app for incoming calls ("ring even when
//! closed"). The push hub is process-global (the audio-call WS
//! handlers reach it without `AppState`), so these routes are thin
//! wrappers around `crate::push::push()`.

use axum::extract::{Path, State};
use axum::Json;

use crate::dto::push_device::{
    RegisterDeviceRequest, RegisterDeviceResponse, UnregisterDeviceResponse,
};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;

/// `POST /api/push/devices` — register the caller's device token.
///
/// Idempotent: re-registering a known (user, token) pair only
/// refreshes its timestamp. Any authenticated user may register; the
/// call-ring push only ever targets staff (agents), so employee
/// tokens are the ones that matter in practice.
#[utoipa::path(
    post,
    path = "/api/push/devices",
    tag = "push",
    request_body = RegisterDeviceRequest,
    responses(
        (status = 200, description = "Device registered", body = RegisterDeviceResponse),
        (status = 400, description = "Invalid token"),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn register_device(
    State(_st): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(body): Json<RegisterDeviceRequest>,
) -> Result<Json<RegisterDeviceResponse>, AppError> {
    let platform = body.platform.trim().to_lowercase();
    let platform = match platform.as_str() {
        "ios" => "ios",
        "web" => "web",
        _ => "android",
    };
    let token = body.token.trim().to_string();
    if token.is_empty() {
        return Err(AppError::BadRequest("token cannot be empty".into()));
    }
    crate::push::push()
        .register_device(&uid.to_string(), &token, platform)
        .await?;
    Ok(Json(RegisterDeviceResponse {
        ok: true,
        push_enabled: crate::push::push().is_enabled(),
    }))
}

/// `DELETE /api/push/devices/{token}` — remove one device (logout,
/// token rotation).
#[utoipa::path(
    delete,
    path = "/api/push/devices/{token}",
    tag = "push",
    params(("token" = String, Path, description = "The device token to remove")),
    responses(
        (status = 200, description = "Device removed", body = UnregisterDeviceResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn unregister_device(
    State(_st): State<AppState>,
    AuthUser(_uid): AuthUser,
    Path(token): Path<String>,
) -> Result<Json<UnregisterDeviceResponse>, AppError> {
    let deleted = crate::push::push().unregister_device(&token).await?;
    Ok(Json(UnregisterDeviceResponse { ok: true, deleted }))
}

/// Build the push-devices router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{delete, post};
    axum::Router::new()
        .route("/devices", post(register_device))
        .route("/devices/{token}", delete(unregister_device))
}

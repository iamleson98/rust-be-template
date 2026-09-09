//! DTOs for push-device registration (`/api/push/devices`).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Request body for `POST /api/push/devices`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterDeviceRequest {
    /// FCM (or APNs-bridged) registration token.
    pub token: String,
    /// `android` | `ios` | `web`.
    #[serde(default = "default_platform")]
    pub platform: String,
}

fn default_platform() -> String {
    "android".to_string()
}

/// Response of `POST /api/push/devices`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterDeviceResponse {
    pub ok: bool,
    /// Whether the FCM transport itself is configured server-side
    /// (`FCM_CREDENTIALS_JSON`). `false` = the token is stored but no
    /// push will be sent yet — clients may surface this to staff.
    pub push_enabled: bool,
}

/// Response of `DELETE /api/push/devices/{token}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnregisterDeviceResponse {
    pub ok: bool,
    /// Number of device rows removed (0 if unknown token).
    pub deleted: u64,
}

//! `GET /api/presence/staff` — staff presence snapshot.
//!
//! Returns the live online/busy/availability state of every staff
//! member (employees + admins) straight from the in-process presence
//! registry. Staff-only (the customer widgets receive the same data
//! via the `staff_presence` WS broadcast instead — no polling).

use axum::extract::State;
use axum::Json;

use crate::dto::chat::{StaffPresenceOut, StaffPresenceResponse};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::presence::presence;
use crate::state::AppState;

/// `GET /api/presence/staff` — current staff presence.
#[utoipa::path(
    get,
    path = "/api/presence/staff",
    tag = "presence",
    responses(
        (status = 200, description = "Staff presence snapshot", body = StaffPresenceResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — staff only"),
    )
)]
pub async fn get_staff_presence(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
) -> Result<Json<StaffPresenceResponse>, AppError> {
    // Staff-only: the queue roster (names + load) is internal data.
    let is_staff = st.chats.is_employee(uid).await?;
    if !is_staff {
        return Err(AppError::Forbidden("staff only".into()));
    }

    let snapshot = presence().snapshot(None);
    let mut staff: Vec<StaffPresenceOut> = snapshot
        .into_iter()
        .map(|s| {
            let online = s.online();
            let available = s.available();
            let busy = s.busy();
            StaffPresenceOut {
                user_id: s.user_id,
                name: s.name,
                role: s.role,
                brand_id: s.brand_id,
                online,
                available,
                busy,
                in_call: s.in_call,
                active_chats: s.active_chats,
            }
        })
        .collect();
    // Online first, then by name — stable for the dashboard list.
    staff.sort_by(|a, b| b.online.cmp(&a.online).then_with(|| a.name.cmp(&b.name)));

    Ok(Json(StaffPresenceResponse {
        online_count: staff.iter().filter(|s| s.online).count(),
        available_count: staff.iter().filter(|s| s.available).count(),
        bot_active: presence().bot_active(None),
        staff,
    }))
}

/// Build the presence router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new().route("/staff", get(get_staff_presence))
}

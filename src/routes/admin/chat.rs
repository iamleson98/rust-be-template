//! Admin — Chat support routes (`/api/admin/chat`).
//!
//! Aggregate stats for the admin chat workspace. The channel/message
//! CRUD itself lives in `crate::routes::chat` (user-facing
//! `/api/chat/*` — customers and employees share those endpoints);
//! this module only hosts the admin-only aggregates that the
//! `/admin/chat` page needs.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};

use crate::dto::chat::ChatStatsResponse;
use crate::error::AppResult;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/chat/stats` — aggregate chat stats for the admin
/// dashboard's top-row cards.
///
/// Returns counts of channels grouped by status (open / assigned /
/// closed / total) + the average first-response time in seconds.
///
/// Server-side aggregate so the counts are accurate even when there
/// are more channels than the channel list's page size (capped at 200).
#[utoipa::path(
    get,
    path = "/api/admin/chat/stats",
    tag = "admin",
    responses(
        (status = 200, description = "Chat stats", body = ChatStatsResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn chat_stats(
    State(st): State<AppState>,
    admin: AdminUser,
) -> AppResult<Json<ChatStatsResponse>> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;
    let stats = st.chats.chat_stats().await?;
    Ok(Json(stats))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/stats", get(chat_stats))
}

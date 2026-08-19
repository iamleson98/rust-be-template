//! Notification routes — `GET /api/notifications`, `POST /api/notifications/read`.

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::dto::notification::{
    MarkNotificationsReadRequest, MarkNotificationsReadResponse, NotificationListResponse,
};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/notifications` — list the authenticated user's notifications.
#[utoipa::path(
    get,
    path = "/api/notifications",
    tag = "notifications",
    params(ListQuery),
    responses(
        (status = 200, description = "Notification list", body = NotificationListResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<NotificationListResponse>, AppError> {
    Ok(Json(
        st.notifications
            .list(uid, q.limit.unwrap_or(20).min(200), q.offset.unwrap_or(0))
            .await?,
    ))
}

/// `POST /api/notifications/read` — mark notifications as read.
///
/// If the request body's `ids` array is empty, ALL of the user's unread
/// notifications are marked read. Otherwise only the listed ids are
/// marked (ownership-checked — ids not owned by the caller are ignored).
#[utoipa::path(
    post,
    path = "/api/notifications/read",
    tag = "notifications",
    request_body = MarkNotificationsReadRequest,
    responses(
        (status = 200, description = "Marked as read", body = MarkNotificationsReadResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn mark_read(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(body): Json<MarkNotificationsReadRequest>,
) -> Result<Json<MarkNotificationsReadResponse>, AppError> {
    Ok(Json(st.notifications.mark_read(uid, body.ids).await?))
}

/// Build the notifications router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/", get(list))
        .route("/read", post(mark_read))
}

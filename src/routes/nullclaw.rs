use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::dto::nullclaw::{
    NullclawExchangeListResponse, NullclawExchangeOut, NullclawStatusResponse,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::nullclaw;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/nullclaw/status` — get NullClaw provider status.
#[utoipa::path(
    get,
    path = "/api/nullclaw/status",
    tag = "nullclaw",
    responses(
        (status = 200, description = "NullClaw status", body = NullclawStatusResponse),
    )
)]
pub async fn status() -> Result<Json<NullclawStatusResponse>, AppError> {
    let p = nullclaw::provider();
    Ok(Json(NullclawStatusResponse {
        enabled: p.is_enabled(),
        provider: p.name(),
    }))
}

#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListExchangesQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/nullclaw/exchanges` — list NullClaw exchanges.
///
/// **Authorization**: requires the `ADMIN_NULLCLAW_READ` permission
/// (any employee/support role). The exchanges contain the customer's
/// original prompt + the AI's completion, which may include PII such
/// as phone numbers, booking codes, and travel plans. Exposing them
/// publicly would be a data-leak (OWASP API1:2023 BOLA / API2:2023
/// Excessive Data Exposure).
#[utoipa::path(
    get,
    path = "/api/nullclaw/exchanges",
    tag = "nullclaw",
    params(ListExchangesQuery),
    responses(
        (status = 200, description = "Exchange list", body = NullclawExchangeListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list_exchanges(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<ListExchangesQuery>,
) -> Result<Json<NullclawExchangeListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_NULLCLAW_READ)
        .await?;
    let rows = st
        .chats
        .list_nullclaw_exchanges(q.limit.unwrap_or(50), q.offset.unwrap_or(0))
        .await?;
    let items: Vec<NullclawExchangeOut> = rows.into_iter().map(NullclawExchangeOut::from).collect();
    Ok(Json(NullclawExchangeListResponse { items }))
}

/// Build the NullClaw router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/status", get(status))
        .route("/exchanges", get(list_exchanges))
}

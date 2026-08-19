use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::dto::zeroclaw::{
    ZeroclawExchangeListResponse, ZeroclawExchangeOut, ZeroclawStatusResponse,
};
use crate::error::AppError;
use crate::state::AppState;
use crate::zeroclaw;

/// `GET /api/zeroclaw/status` — get ZeroClaw provider status.
#[utoipa::path(
    get,
    path = "/api/zeroclaw/status",
    tag = "zeroclaw",
    responses(
        (status = 200, description = "ZeroClaw status", body = ZeroclawStatusResponse),
    )
)]
pub async fn status() -> Result<Json<ZeroclawStatusResponse>, AppError> {
    let p = zeroclaw::provider();
    Ok(Json(ZeroclawStatusResponse {
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

/// `GET /api/zeroclaw/exchanges` — list ZeroClaw exchanges.
#[utoipa::path(
    get,
    path = "/api/zeroclaw/exchanges",
    tag = "zeroclaw",
    params(ListExchangesQuery),
    responses(
        (status = 200, description = "Exchange list", body = ZeroclawExchangeListResponse),
    )
)]
pub async fn list_exchanges(
    State(st): State<AppState>,
    Query(q): Query<ListExchangesQuery>,
) -> Result<Json<ZeroclawExchangeListResponse>, AppError> {
    let rows = st
        .store
        .chat_store()
        .list_zeroclaw_exchanges(q.limit.unwrap_or(50).min(200), q.offset.unwrap_or(0))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let items: Vec<ZeroclawExchangeOut> = rows.into_iter().map(ZeroclawExchangeOut::from).collect();
    Ok(Json(ZeroclawExchangeListResponse { items }))
}

/// Build the ZeroClaw router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/status", get(status))
        .route("/exchanges", get(list_exchanges))
}

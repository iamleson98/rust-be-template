use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use utoipa::IntoParams;

use crate::error::AppError;
use crate::state::AppState;
use crate::zeroclaw;

/// `GET /api/zeroclaw/status` — get ZeroClaw provider status.
#[utoipa::path(
    get,
    path = "/api/zeroclaw/status",
    tag = "zeroclaw",
    responses(
        (status = 200, description = "ZeroClaw status", body = Value),
    )
)]
pub async fn status() -> Result<Json<Value>, AppError> {
    let p = zeroclaw::provider();
    Ok(Json(serde_json::json!({
        "enabled": p.is_enabled(),
        "provider": p.name(),
    })))
}

#[derive(Deserialize, IntoParams)]
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
        (status = 200, description = "Exchange list", body = Value),
    )
)]
pub async fn list_exchanges(
    State(st): State<AppState>,
    Query(q): Query<ListExchangesQuery>,
) -> Result<Json<Value>, AppError> {
    let rows = st
        .store
        .chat_store()
        .list_zeroclaw_exchanges(q.limit.unwrap_or(50), q.offset.unwrap_or(0))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(serde_json::to_value(&rows).unwrap_or_default()))
}

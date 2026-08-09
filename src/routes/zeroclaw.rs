use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;

use crate::error::AppError;
use crate::state::AppState;
use crate::zeroclaw;

pub async fn status() -> Result<Json<Value>, AppError> {
    let p = zeroclaw::provider();
    Ok(Json(serde_json::json!({
        "enabled": p.is_enabled(),
        "provider": p.name(),
    })))
}

#[derive(Deserialize)]
pub struct ListExchangesQuery { pub limit: Option<u64>, pub offset: Option<u64> }
pub async fn list_exchanges(State(st): State<AppState>, Query(q): Query<ListExchangesQuery>) -> Result<Json<Value>, AppError> {
    let rows = st.store.chat_store().list_zeroclaw_exchanges(q.limit.unwrap_or(50), q.offset.unwrap_or(0)).await.map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(serde_json::to_value(&rows).unwrap_or_default()))
}

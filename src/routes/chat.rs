use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListChannelsQuery { pub limit: Option<u64> }
pub async fn list_channels(State(st): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListChannelsQuery>) -> Result<Json<Value>, AppError> {
    let channels = st.store.chat_store().list_channels(&uid.to_string(), q.limit.unwrap_or(50)).await.map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(serde_json::to_value(&channels).unwrap_or_default()))
}

#[derive(Deserialize)]
pub struct ListMessagesQuery { pub limit: Option<u64>, pub offset: Option<u64> }
pub async fn list_messages(State(st): State<AppState>, Path(id): Path<Uuid>, Query(q): Query<ListMessagesQuery>) -> Result<Json<Value>, AppError> {
    let msgs = st.store.chat_store().list_messages(&id.to_string(), q.limit.unwrap_or(50), q.offset.unwrap_or(0)).await.map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(serde_json::to_value(&msgs).unwrap_or_default()))
}

pub async fn mark_read(State(st): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    let side = if uid.to_string().is_empty() { "user" } else { "user" };
    let _ = st.store.chat_store().clear_unread(&id.to_string(), side).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

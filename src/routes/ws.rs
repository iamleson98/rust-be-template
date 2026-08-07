use std::sync::Arc;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct WsAuth {
    /// JWT access token passed as a query param (since browsers can't set
    /// headers on WebSocket upgrades). In production you'd typically use a
    /// short-lived `?ticket=...` issued via a separate API call.
    pub token: String,
}

/// `GET /api/ws` — upgrade to a WebSocket connection.
/// The `token` query param is the JWT access token, used to authenticate
/// the connection (no cookies on WS upgrades in browsers).
pub async fn ws_upgrade(
    State(state): State<AppState>,
    Query(auth): Query<WsAuth>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let user_id = state
        .auth
        .verify_access_token(&auth.token)
        .await
        .map_err(|e| AppError::Unauthorized(format!("ws auth: {e}")))?;
    Ok(ws.on_upgrade(move |socket| {
        crate::ws::ws_handler(state.ws_hub.clone(), user_id, socket)
    }))
}

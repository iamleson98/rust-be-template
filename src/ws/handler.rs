//! WebSocket upgrade handler + socket.io-like message protocol.
//!
//! Wire format (JSON, one message per WS text frame):
//!
//! ```jsonc
//! // client → server
//! { "type": "join",    "channelId": "...", "clientMsgId": "..." }
//! { "type": "message", "channelId": "...", "text": "...", "clientMsgId": "..." }
//! { "type": "read",    "channelId": "..." }
//! { "type": "typing",  "channelId": "...", "isTyping": true }
//!
//! // server → client
//! { "type": "joined",    "channelId": "...", "userId": "...", "onlineEmployees": 3 }
//! { "type": "message",   "id": "...", "channelId": "...", "senderType": "user", "senderId": "...", "text": "...", "createdAt": "..." }
//! { "type": "presence",  "channelId": "...", "userId": "...", "online": true }
//! { "type": "typing",    "channelId": "...", "userId": "...", "isTyping": true }
//! { "type": "read",      "channelId": "...", "userId": "...", "lastReadAt": "..." }
//! { "type": "error",     "message": "..." }
//! ```
//!
//! ## Adaptation notes
//!
//! Ported from `booking-rs/ws/handler.rs`. The original used raw `sqlx`
//! against `AppState.pool`; this version uses the [`ChatStore`] from the
//! template's `CompositeStore` so it fits the layered store architecture
//! (no direct DB access in the handler). Auth uses the template's
//! `AuthService::verify_access_token_session` which returns a `SessionUser`.
//!
//! WS tuning knobs (max connections, heartbeat, idle timeout, etc.) are
//! read from the template's `Config` via the `WsConfig` section. When not
//! set, sensible defaults apply.

use std::net::SocketAddr;
use std::time::Duration;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;
use tracing::Instrument;

use crate::auth::SessionUser;
use crate::error::AppError;
use crate::state::AppState;
use crate::store::chat::NewChatMessage;

use super::hub::hub;

/// Build the `/ws` WebSocket router.
pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(ws_upgrade))
}

/// Query params for the WS handshake (`?token=<jwt>` — socket.io-style).
#[derive(Debug, Deserialize)]
pub struct WsQ {
    /// JWT access token (same as the `access_token` cookie value).
    pub token: Option<String>,
}

/// WS tuning knobs read from config at upgrade time. Kept as a small
/// struct so the socket loop doesn't reach back into `Config` repeatedly.
#[derive(Clone, Copy)]
pub struct WsLimits {
    pub channel_cap: usize,
    heartbeat_sec: u64,
    idle_timeout_sec: u64,
    max_per_ip: usize,
}

impl WsLimits {
    fn from_config(cfg: &crate::config::Config) -> Self {
        Self {
            channel_cap: cfg.ws.channel_capacity,
            heartbeat_sec: cfg.ws.heartbeat_sec,
            idle_timeout_sec: cfg.ws.idle_timeout_sec,
            max_per_ip: cfg.ws.max_per_ip,
        }
    }
}

/// HTTP→WS upgrade handler. Authenticates via `?token=` query param or
/// `access_token` cookie, applies the global + per-IP connection caps,
/// then hands off to [`handle_socket`].
pub async fn ws_upgrade(
    State(st): State<AppState>,
    Query(q): Query<WsQ>,
    jar: axum_extra::extract::CookieJar,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    // Resolve the session user via the auth service (verifies JWT + loads user).
    // Try query param first, then fall back to cookie (same as REST endpoints).
    let token = q
        .token
        .as_deref()
        .filter(|t| !t.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            let (access, _) = crate::auth::cookies::extract_tokens(&jar);
            access
        });
    let user = match token.as_deref() {
        Some(t) => st.auth.verify_access_token_session(t).await.ok(),
        None => None,
    };
    let user = user
        .ok_or_else(|| AppError::Unauthorized("ws handshake: missing or invalid token".into()))?;

    let ip = addr.ip().to_string();
    let limits = WsLimits::from_config(&st.config);

    // ── Global connection cap (checked FIRST — cheapest rejection) ────
    if !hub().try_acquire_global() {
        tracing::warn!(
            ip = %ip,
            connections = hub().connection_count(),
            max = hub().max_connections(),
            "WS upgrade rejected: global connection cap reached"
        );
        return Err(AppError::ServiceUnavailable(
            "ws connection cap reached".into(),
        ));
    }

    // ── Per-IP connection cap ───────────────────────────────────────────
    if !hub().try_acquire_ip(&ip, limits.max_per_ip) {
        hub().release_global();
        tracing::warn!(ip = %ip, max_per_ip = limits.max_per_ip, "WS upgrade rejected: per-IP cap reached");
        return Err(AppError::TooManyRequests("ws per-ip cap reached".into()));
    }

    let ws = ws
        .max_message_size(st.config.ws.max_message_bytes)
        .max_frame_size(st.config.ws.max_frame_bytes);

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, st, user, ip, limits)))
}

/// Main socket loop: split into read/write halves, register the session,
/// drive the read pump with heartbeat + idle-timeout, and tear down on
/// disconnect.
#[allow(clippy::too_many_arguments)]
pub async fn handle_socket(
    socket: WebSocket,
    st: AppState,
    user: SessionUser,
    ip: String,
    limits: WsLimits,
) {
    use futures::StreamExt as _;

    let (sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<bytes::Bytes>(limits.channel_cap.max(1));

    let sid = hub().register(user.clone(), ip.clone(), tx);

    // If this is an employee, add to the online-employee index.
    let user_id = user.id.to_string();
    let brand_id = user.brand_id.map(|id| id.to_string());
    if user.is_employee() {
        hub().add_online_employee(&user_id, brand_id.as_deref(), sid);
    }

    tracing::debug!(
        socket_id = sid,
        user_id = %user.id,
        connections = hub().connection_count(),
        "ws connected"
    );

    let (close_tx, mut close_rx) = mpsc::channel::<()>(1);

    // ── Write pump ──────────────────────────────────────────────────────
    let write_task = {
        let mut sink = sink;
        let mut heartbeat = tokio::time::interval(Duration::from_secs(limits.heartbeat_sec.max(1)));
        heartbeat.tick().await; // consume immediate tick
        tokio::spawn(async move {
            use futures::SinkExt;
            loop {
                tokio::select! {
                    Some(msg) = rx.recv() => {
                        // Empty Bytes = close sentinel from close_all().
                        // Non-empty = a pre-serialised JSON text frame.
                        if msg.is_empty() {
                            break;
                        }
                        // Convert Bytes → &str → Utf8Bytes (axum's ws Text
                        // type). This is a zero-copy deref, no allocation.
                        let text = std::str::from_utf8(&msg)
                            .unwrap_or("");
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    _ = heartbeat.tick() => {
                        if sink.send(Message::Ping(bytes::Bytes::new())).await.is_err() {
                            break;
                        }
                    }
                    _ = close_rx.recv() => {
                        let _ = sink.send(Message::Close(None)).await;
                        break;
                    }
                }
            }
        })
    };

    // ── Read pump ───────────────────────────────────────────────────────
    let idle = Duration::from_secs(limits.idle_timeout_sec.max(1));
    let idle_timer = tokio::time::sleep(idle);
    tokio::pin!(idle_timer);

    loop {
        tokio::select! {
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(txt))) => {
                        idle_timer.as_mut().reset(tokio::time::Instant::now() + idle);
                        if let Err(e) = handle_text(&st, sid, &user, txt.as_str()).await {
                            tracing::warn!(socket_id = sid, error = %e, "ws handler error");
                            hub().send_to(sid, &json!({ "type": "error", "message": e.to_string() }));
                        }
                    }
                    Some(Ok(Message::Binary(_))) | Some(Ok(Message::Ping(_))) => {
                        // Ignore binary + ping (axum auto-pongs).
                    }
                    Some(Ok(Message::Pong(_))) => {
                        // Pong received — the client is alive. Reset the
                        // idle timer so we don't disconnect a healthy
                        // connection just because the user hasn't sent a
                        // text message in the last 90s.
                        idle_timer.as_mut().reset(tokio::time::Instant::now() + idle);
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(e)) => {
                        tracing::warn!(socket_id = sid, error = %e, "ws recv error");
                        break;
                    }
                }
            }
            _ = &mut idle_timer => {
                tracing::warn!(socket_id = sid, "ws idle timeout — closing");
                break;
            }
        }
    }

    // ── Teardown ─────────────────────────────────────────────────────────
    let _ = close_tx.send(()).await;
    let _ = write_task.await;
    // Release global + per-IP slots and remove the session from the hub.
    hub().unregister(sid);
    hub().release_ip(&ip);
    hub().release_global();
    tracing::debug!(socket_id = sid, "ws disconnected");
}

/// Dispatch a text frame to the appropriate handler.
async fn handle_text(
    st: &AppState,
    sid: u64,
    user: &SessionUser,
    txt: &str,
) -> Result<(), AppError> {
    let msg: serde_json::Value =
        serde_json::from_str(txt).map_err(|_| AppError::BadRequest("invalid JSON".into()))?;
    let ty = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match ty {
        "join" => handle_join(st, sid, user, &msg).await,
        "message" => handle_message(st, sid, user, &msg).await,
        "read" => handle_read(st, user, &msg).await,
        "typing" => {
            handle_typing(sid, user, &msg);
            Ok(())
        }
        _ => {
            hub().send_to(
                sid,
                &json!({ "type": "error", "message": format!("unknown message type: {ty}") }),
            );
            Ok(())
        }
    }
}

/// `join` — attach the socket to a channel room, broadcast presence-online.
async fn handle_join(
    st: &AppState,
    sid: u64,
    user: &SessionUser,
    msg: &serde_json::Value,
) -> Result<(), AppError> {
    let channel_id = msg
        .get("channelId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("missing channelId".into()))?
        .to_string();

    // Cache short-circuit; fall back to the chat service on miss.
    if !hub().channel_exists_cached(&channel_id) {
        let exists = st.chats.channel_exists(&channel_id).await?;
        if !exists {
            return Err(AppError::NotFound("chat channel not found".into()));
        }
        hub().cache_channel_exists(&channel_id);
    }

    let prev = hub().set_channel(sid, channel_id.clone());
    hub().join_room(&channel_id, sid);

    if let Some(prev) = prev {
        if !hub().user_still_in_room(&prev, &user.id.to_string(), sid) {
            hub().broadcast_to_room(
                &prev,
                &json!({ "type": "presence", "channelId": prev, "userId": user.id, "online": false }),
            );
        }
    }

    hub().broadcast_to_room_except(
        &channel_id,
        &json!({ "type": "presence", "channelId": channel_id, "userId": user.id, "online": true }),
        sid,
    );

    let brand_id = user.brand_id.map(|id| id.to_string());

    let online_count = hub().count_online_employees(brand_id.as_deref());
    hub().send_to(
        sid,
        &json!({
            "type": "joined",
            "channelId": channel_id,
            "userId": user.id,
            "onlineEmployees": online_count,
        }),
    );
    Ok(())
}

/// `message` — store + broadcast a chat message (with idempotency).
async fn handle_message(
    st: &AppState,
    sid: u64,
    user: &SessionUser,
    msg: &serde_json::Value,
) -> Result<(), AppError> {
    let channel_id = msg
        .get("channelId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("missing channelId".into()))?
        .to_string();
    // Parsed form for DB inserts (`NewChatMessage.channel_id` is a `Uuid`
    // so SeaORM binds it as a blob matching `chat_channel.id` storage).
    let channel_uuid = uuid::Uuid::parse_str(&channel_id)
        .map_err(|e| AppError::BadRequest(format!("invalid channelId: {e}")))?;
    let text = msg
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("missing text".into()))?
        .to_string();
    let client_msg_id = msg
        .get("clientMsgId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // ── Abuse guard ────────────────────────────────────────────────
    // Inspect the message before storing/broadcasting. If the user is
    // already banned (or this message triggers a ban), reject the
    // message and notify the client. The verdict is also persisted to
    // the channel as a `system` message so the user can see why their
    // message was rejected (and the human staff can see the violation
    // when they pick up the channel).
    let guard = crate::guard::AbuseGuard::shared();
    let ip_for_guard = hub().session_ip(sid);
    let verdict = guard.check(Some(&user.id.to_string()), ip_for_guard.as_deref(), &text);
    match &verdict {
        crate::guard::AbuseVerdict::Ok => { /* proceed */ }
        crate::guard::AbuseVerdict::Warned { reason } => {
            // Persist a soft system notice so the human agent sees it.
            let now_warn = chrono::Utc::now().to_rfc3339();
            let _ = st
                .chats
                .insert_message(NewChatMessage {
                    channel_id: channel_uuid,
                    sender_type: "system".into(),
                    sender_id: None,
                    content: Some(format!("⚠️ Cảnh báo: {reason}")),
                    kind: "text".into(),
                    attachments: None,
                    client_msg_id: None,
                })
                .await;
            // Tell the sender why the message was flagged (still allow
            // the original message through — warnings don't block).
            hub().send_to(
                sid,
                &json!({
                    "type": "abuse:warned",
                    "channelId": channel_id,
                    "reason": reason,
                    "createdAt": now_warn,
                }),
            );
        }
        crate::guard::AbuseVerdict::Banned { reason, .. } => {
            // Record the ban in the channel as a system message.
            let now_ban = chrono::Utc::now().to_rfc3339();
            let _ = st
                .chats
                .insert_message(NewChatMessage {
                    channel_id: channel_uuid,
                    sender_type: "system".into(),
                    sender_id: None,
                    content: Some(format!("🚫 Tài khoản bị tạm khóa: {reason}")),
                    kind: "text".into(),
                    attachments: None,
                    client_msg_id: None,
                })
                .await;
            // Reject the user's message — send a ban notice to the client.
            hub().send_to(
                sid,
                &json!({
                    "type": "abuse:banned",
                    "channelId": channel_id,
                    "reason": reason,
                    "createdAt": now_ban,
                }),
            );
            // Broadcast the system message to the room (so any watching
            // employee sees the ban).
            hub().broadcast_to_room(
                &channel_id,
                &json!({
                    "type": "message",
                    "id": format!("ban:{}", now_ban),
                    "channelId": channel_id,
                    "senderType": "system",
                    "senderId": "abuse-guard",
                    "senderName": "Hệ thống",
                    "text": format!("🚫 Tài khoản bị tạm khóa: {reason}"),
                    "createdAt": now_ban,
                }),
            );
            return Ok(());
        }
    }

    // Idempotency: replay the stored id if the client retries.
    if !client_msg_id.is_empty() {
        if let Some(Some(stored_id)) = hub().idem_claim(&client_msg_id) {
            hub().send_to(
                sid,
                &json!({ "type": "ack", "clientMsgId": client_msg_id, "id": stored_id }),
            );
            return Ok(());
        }
    }

    let stored = st
        .chats
        .insert_message(NewChatMessage {
            channel_id: channel_uuid,
            sender_type: user.actor_type.clone(),
            sender_id: Some(user.id),
            content: Some(text.clone()),
            kind: "text".into(),
            attachments: None,
            client_msg_id: if client_msg_id.is_empty() {
                None
            } else {
                Some(client_msg_id.clone())
            },
        })
        .await?;
    let id = stored.id.to_string();
    let now = stored.created_at.clone();

    if !client_msg_id.is_empty() {
        hub().idem_store(&client_msg_id, &id);
    }

    let broadcast = json!({
        "type": "message",
        "id": id,
        "channelId": channel_id,
        "senderType": user.actor_type,
        "senderId": user.id,
        "senderName": user.name,
        "text": text,
        "createdAt": now,
    });
    hub().broadcast_to_room(&channel_id, &broadcast);

    hub().send_to(
        sid,
        &json!({ "type": "ack", "clientMsgId": client_msg_id, "id": id }),
    );

    // ── ZeroClaw AI assistant hook ────────────────────────────────
    // Goes through ChatService so the chat store stays encapsulated
    // in the service layer (clean architecture: API/WS → service → store).
    //
    // When ZeroClaw is about to reply (no humans online), we send a
    // `typing` indicator to the user so they know "someone is typing"
    // while the AI processes the request. After the reply (success or
    // failure), we send `typing: false` to clear the indicator.
    if user.actor_type == "user" {
        let brand_id = st
            .chats
            .get_channel(&channel_id)
            .await?
            .and_then(|c| c.brand_id);

        let online = hub().count_online_employees(brand_id.map(|id| id.to_string()).as_deref());
        let fallback_threshold = st.config.zeroclaw.fallback_online_employees;

        let chats = st.chats.clone();
        let channel_id2 = channel_id.clone();
        let brand_id2 = brand_id.map(|id| id.to_string());
        let user2 = user.clone();
        let user_msg_id = id.clone();
        let text2 = text.clone();
        let sid_for_typing = sid;
        // Capture the current tracing span so logs inside the spawned
        // task (an LLM HTTP call that can take 5-15s) stay correlated
        // to the WS handler that triggered them. Without `.instrument`
        // the span context is dropped at the `tokio::spawn` boundary.
        let span = tracing::Span::current();
        tokio::spawn(
            async move {
                // If ZeroClaw will handle this (no humans online), send
                // a typing indicator to the user so they see "someone
                // is replying" while the AI processes.
                let will_zeroclaw_reply = online < fallback_threshold;

                if will_zeroclaw_reply {
                    hub().send_to(
                        sid_for_typing,
                        &json!({
                            "type": "typing",
                            "channelId": channel_id2,
                            "name": "Nhân viên hỗ trợ",
                            "isTyping": true,
                        }),
                    );
                }

                match chats
                    .maybe_zeroclaw_reply(
                        &channel_id2,
                        brand_id2.as_deref(),
                        &user2,
                        &user_msg_id,
                        &text2,
                        online,
                        fallback_threshold,
                    )
                    .await
                {
                    Ok(Some(outcome)) => {
                        let assistant_broadcast = json!({
                            "type": "message",
                            "id": outcome.assistant_message_id,
                            "channelId": channel_id2,
                            "senderType": "assistant",
                            "senderId": format!("zeroclaw:{}", outcome.reply.model),
                            "senderName": "ZeroClaw AI",
                            "text": outcome.reply.reply,
                            "createdAt": outcome.created_at,
                            "meta": {
                                "confidence": outcome.reply.confidence,
                                "model": outcome.reply.model,
                                "handoffToHuman": outcome.reply.handoff_to_human,
                            }
                        });
                        hub().broadcast_to_room(&channel_id2, &assistant_broadcast);
                    }
                    Ok(None) => {}
                    Err(e) => {
                        tracing::warn!(error = ?e, channel_id = %channel_id2, "zeroclaw maybe_reply errored");
                    }
                }

                // Always clear the typing indicator after ZeroClaw
                // finishes (whether it replied, declined, or errored).
                if will_zeroclaw_reply {
                    hub().send_to(
                        sid_for_typing,
                        &json!({
                            "type": "typing",
                            "channelId": channel_id2,
                            "name": "Nhân viên hỗ trợ",
                            "isTyping": false,
                        }),
                    );
                }
            }
            .instrument(span),
        );
    }

    Ok(())
}

/// `read` — mark the channel as read by this user (clears unread badge).
async fn handle_read(
    st: &AppState,
    user: &SessionUser,
    msg: &serde_json::Value,
) -> Result<(), AppError> {
    let channel_id = msg
        .get("channelId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("missing channelId".into()))?
        .to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Best-effort: clear unread counter for the appropriate side.
    let side = if user.is_employee() {
        "employee"
    } else {
        "user"
    };
    let _ = st.chats.clear_unread(&channel_id, side).await;

    hub().broadcast_to_room(
        &channel_id,
        &json!({ "type": "read", "channelId": channel_id, "userId": user.id, "lastReadAt": now }),
    );
    Ok(())
}

/// `typing` — broadcast a typing indicator (no DB write).
fn handle_typing(sid: u64, user: &SessionUser, msg: &serde_json::Value) {
    let channel_id = msg
        .get("channelId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_typing = msg
        .get("isTyping")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    hub().broadcast_to_room_except(
        &channel_id,
        &json!({
            "type": "typing",
            "channelId": channel_id,
            "userId": user.id,
            "userName": user.name,
            "isTyping": is_typing,
        }),
        sid,
    );
}

// ── Graceful shutdown + background maintenance ─────────────────────

/// Drain all live WS connections on shutdown: send a `system:shutdown`
/// notice + Close frame, then give sockets a brief grace period.
pub async fn drain_all_connections(grace_ms: u64) {
    hub().broadcast_all(&json!({ "type": "system:shutdown" }).to_string());
    hub().close_all();
    tokio::time::sleep(Duration::from_millis(grace_ms)).await;
}

/// Periodic GC for the idempotency + channel-exists caches (every 60s).
pub fn spawn_idem_gc() {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            hub().idem_gc();
        }
    });
}

/// Periodic metrics logger (every 60s).
pub fn spawn_metrics_logger() {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let stats = hub().stats();
            tracing::info!(
                connections = stats.connections,
                rooms = stats.rooms,
                online_employee_brands = stats.online_employee_brands,
                "ws hub metrics"
            );
        }
    });
}

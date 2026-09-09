//! WebRTC signaling relay — `/ws-call` WebSocket endpoint.
//!
//! The server is **only a relay**: audio flows peer-to-peer over
//! `RTCPeerConnection` (no `webrtc-rs` dependency). This handler
//! authenticates the upgrade, then routes `offer`/`answer`/`ice`/`hangup`
//! signals between two peers.
//!
//! ## Adaptation notes
//!
//! Ported from `booking-rs/audio_call/handler.rs`. Auth now uses the
//! template's `AuthService::verify_access_token_session` (returns a
//! `SessionUser`). Config knobs come from the template's `WsConfig` +
//! `AudioCallConfig`.

use std::net::SocketAddr;
use std::time::Duration;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::HeaderMap,
    response::IntoResponse,
    routing::get,
    Router,
};
use axum_extra::extract::CookieJar;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::audio_call::hub::{call_hub, CallRole};
use crate::audio_call::session::{sessions, HangupOutcome, OfferOutcome};
use crate::auth::cookies::ACCESS_COOKIE;
use crate::auth::SessionUser;
use crate::error::AppError;
use crate::state::AppState;
// Reuse the Origin check from the chat WS handler — same CSWSH defense.
use crate::ws::handler::check_ws_origin;

/// Agent-picker closure for the session manager: best available agent
/// (presence: online, not in-call, lowest chat load) registered on this
/// hub, minus the exclusion set (already-rang agents + agents ringing
/// for someone else).
fn pick_agent(exclude: &std::collections::HashSet<String>) -> Option<String> {
    call_hub().pick_available_agent_id_excluding(exclude)
}

/// Session-ended cleanup: the agent is never "stuck busy" — their
/// in-call flag clears whenever a session they were in ends, no matter
/// which side hung up (this used to only run on agent-side hangups,
/// leaving zombie busy agents after customer hangups).
fn agent_session_cleanup(agent_id: &str) {
    call_hub().set_in_call(agent_id, false);
    call_hub().broadcast_presence();
}

/// Build the `/ws-call` WebSocket router.
pub fn router() -> Router<AppState> {
    Router::new().route("/ws-call", get(ws_upgrade))
}

/// Query params for the WS handshake. We accept `?token=<jwt>` for
/// backwards-compat, but the preferred auth method is the `access_token`
/// cookie — browsers send cookies automatically on the WS upgrade.
#[derive(Debug, Deserialize)]
pub struct WsQ {
    pub token: Option<String>,
}

/// HTTP→WS upgrade handler. Authenticates via (in order):
///   1. `?token=<jwt>` query param
///   2. `access_token` cookie (preferred — no token in URL)
pub async fn ws_upgrade(
    State(st): State<AppState>,
    Query(q): Query<WsQ>,
    jar: CookieJar,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    // ── Origin check FIRST — CSWSH defense, same as /ws ─────────────────
    // `token_auth` = the upgrade carries `?token=<jwt>` (mobile app /
    // programmatic clients) — those skip the browser-Origin requirement.
    let allowed_origins = st.config.cors.origin_list();
    let token_auth = q.token.as_deref().filter(|t| !t.is_empty()).is_some();
    check_ws_origin(&headers, &allowed_origins, token_auth)?;

    // ── Auth (JWT) — try query param first, then cookie ─────────────────
    let user = if let Some(t) = q.token.as_deref() {
        st.auth.verify_access_token_session(t).await.ok()
    } else if let Some(c) = jar.get(ACCESS_COOKIE) {
        st.auth.verify_access_token_session(c.value()).await.ok()
    } else {
        None
    };
    let user = user.ok_or_else(|| {
        AppError::Unauthorized("ws-call handshake: missing or invalid token".into())
    })?;

    let _ip = addr.ip().to_string();

    // ── Clamp frame/message sizes (defense vs. malicious SDP) ───────────
    let ws = ws
        .max_message_size(st.config.ws.max_message_bytes)
        .max_frame_size(st.config.ws.max_frame_bytes);

    let heartbeat_sec = st.config.ws.heartbeat_sec.max(5);
    let idle_timeout_sec = st.config.ws.idle_timeout_sec.max(heartbeat_sec * 2 + 1);

    // STUN/TURN servers pushed to the peer in the `registered` message.
    let ice_servers = st.config.audio_call.ice_servers_json();
    // Channel capacity from config — was previously hardcoded to 64.
    let channel_capacity = st.config.ws.channel_capacity.max(1);

    Ok(ws.on_upgrade(move |socket| {
        handle_socket(
            socket,
            user,
            heartbeat_sec,
            idle_timeout_sec,
            ice_servers,
            channel_capacity,
        )
    }))
}

/// Main socket loop: split into read/write halves and drive them.
pub async fn handle_socket(
    socket: WebSocket,
    user: SessionUser,
    heartbeat_sec: u64,
    idle_timeout_sec: u64,
    ice_servers: Value,
    channel_capacity: usize,
) {
    use futures::StreamExt as _;

    let sid = call_hub().next_socket_id();
    let (sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<bytes::Bytes>(channel_capacity);
    let (close_tx, mut close_rx) = mpsc::channel::<()>(1);

    tracing::debug!(
        socket_id = sid,
        user_id = %user.id,
        actor_type = %user.actor_type,
        "ws-call connected"
    );

    // ── Write pump ──────────────────────────────────────────────────────
    let mut write_task = tokio::spawn(async move {
        use futures::SinkExt;
        let mut sink = sink;
        let mut heartbeat = tokio::time::interval(Duration::from_secs(heartbeat_sec));
        heartbeat.tick().await;
        loop {
            tokio::select! {
                maybe_msg = rx.recv() => {
                    match maybe_msg {
                        Some(msg) => {
                            let text = std::str::from_utf8(&msg)
                                .unwrap_or("");
                            if sink.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                _ = heartbeat.tick() => {
                    let payload = chrono::Utc::now().timestamp_millis().to_be_bytes().to_vec();
                    if sink.send(Message::Ping(payload.into())).await.is_err() {
                        break;
                    }
                }
                _ = close_rx.recv() => {
                    let _ = sink.send(Message::Close(None)).await;
                    break;
                }
            }
        }
    });

    // ── Read pump ───────────────────────────────────────────────────────
    let user_r = user.clone();
    let read_task = tokio::spawn(async move {
        let idle = Duration::from_secs(idle_timeout_sec);
        let mut registered_role: Option<CallRole> = None;

        loop {
            let next = tokio::time::timeout(idle, stream.next());
            match next.await {
                Ok(Some(Ok(msg))) => match msg {
                    Message::Text(text) => {
                        let parsed: Result<Value, _> = serde_json::from_str(&text);
                        match parsed {
                            Ok(v) => {
                                let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

                                if ty == "heartbeat" {
                                    let _ = tx.try_send(bytes::Bytes::from(
                                        json!({ "type": "pong" }).to_string(),
                                    ));
                                    continue;
                                }

                                if ty == "register" {
                                    if registered_role.is_some() {
                                        let _ = tx.try_send(bytes::Bytes::from(
                                            json!({ "type": "error", "code": "already-registered",
                                                    "message": "Already registered" })
                                            .to_string(),
                                        ));
                                        continue;
                                    }
                                    match do_register(&user_r, &v, tx.clone(), sid) {
                                        Ok(role) => {
                                            registered_role = Some(role);
                                            let n = call_hub().online_agent_count();
                                            let _ = tx.try_send(bytes::Bytes::from(
                                                json!({
                                                    "type": "registered",
                                                    "role": role.as_str(),
                                                    "userId": user_r.id,
                                                    "onlineAgents": n,
                                                    "iceServers": &ice_servers,
                                                })
                                                .to_string(),
                                            ));
                                            call_hub().broadcast_presence();
                                        }
                                        Err(msg) => {
                                            let _ = tx.try_send(
                                                bytes::Bytes::from(json!({ "type": "error", "code": "bad-register", "message": msg }).to_string()),
                                            );
                                        }
                                    }
                                    continue;
                                }

                                if registered_role.is_none() {
                                    let _ = tx.try_send(bytes::Bytes::from(
                                        json!({ "type": "error", "code": "not-registered",
                                                "message": "Send a register message first" })
                                        .to_string(),
                                    ));
                                    continue;
                                }

                                if let Err(e) = handle_post_register_signal(
                                    &user_r,
                                    registered_role.unwrap(),
                                    &v,
                                ) {
                                    let _ = tx.try_send(bytes::Bytes::from(
                                        json!({ "type": "error", "message": e }).to_string(),
                                    ));
                                }
                            }
                            Err(e) => {
                                let _ = tx.try_send(bytes::Bytes::from(
                                    json!({ "type": "error", "code": "bad-json",
                                            "message": format!("invalid JSON: {e}") })
                                    .to_string(),
                                ));
                            }
                        }
                    }
                    Message::Binary(_) => {
                        let _ = tx.try_send(bytes::Bytes::from(
                            json!({ "type": "error", "code": "binary-unsupported",
                                    "message": "Binary frames are not supported" })
                            .to_string(),
                        ));
                    }
                    Message::Ping(_) | Message::Pong(_) => {}
                    Message::Close(_) => break,
                },
                Ok(Some(Err(e))) => {
                    tracing::debug!(error = ?e, user_id = %user_r.id, "ws-call read error");
                    break;
                }
                Ok(None) => break,
                Err(_) => {
                    tracing::info!(
                        user_id = %user_r.id,
                        idle_sec = idle.as_secs(),
                        "ws-call idle timeout — closing half-open socket"
                    );
                    break;
                }
            }
        }
        user_r.id
    });

    let user_id = read_task.await.unwrap_or(user.id);

    let _ = close_tx.send(()).await;

    // ── Session cleanup for the disconnecting user ───────────────────
    // A dropped socket ends every call the user was part of: the other
    // side is notified, the agent's in-call flag clears, and a ringing
    // customer-initiated call re-routes (ring escalation) to the next
    // available agent instead of dying with the socket.
    let uid = user_id.to_string();
    let role = call_hub().unregister(&uid, sid);
    if let Some(role) = role {
        match role {
            CallRole::Agent => {
                tracing::info!(user_id = %uid, "agent went offline");
                // Multi-agent: only pull customers' calls when the LAST
                // agent left; otherwise other agents keep serving.
                if call_hub().online_agent_count() == 0 {
                    call_hub().broadcast_agent_offline();
                }
                // Drain the agent's sessions: active ones notify the
                // customer, ringing customer-initiated ones re-route.
                for _ in 0..100 {
                    match sessions().on_agent_hangup(&uid, "agent-offline", pick_agent) {
                        HangupOutcome::NoSession => break,
                        HangupOutcome::ReRouted { customer_id, agent_id } => {
                            relay_offer(&customer_id, &agent_id);
                            continue;
                        }
                        HangupOutcome::Notify { customer_id, reason } => {
                            agent_session_cleanup(&uid);
                            let _ = call_hub().send_to(
                                &customer_id,
                                &json!({
                                    "type": "hangup",
                                    "from": "system",
                                    "reason": reason,
                                }),
                            );
                        }
                    }
                }
                agent_session_cleanup(&uid);
            }
            CallRole::Customer => {
                // Customer socket dropped — tell the agent the call is
                // over and free them from in-call.
                if let crate::audio_call::session::CustomerHangup::NotifyAgent { agent_id } =
                    sessions().on_customer_hangup(&uid)
                {
                    agent_session_cleanup(&agent_id);
                    let _ = call_hub().send_to(
                        &agent_id,
                        &json!({
                            "type": "hangup",
                            "from": "system",
                            "reason": "peer-offline",
                        }),
                    );
                }
            }
        }
    }
    call_hub().broadcast_presence();

    tokio::select! {
        _ = &mut write_task => { }
        _ = tokio::time::sleep(Duration::from_millis(500)) => {
            write_task.abort();
        }
    }

    tracing::debug!(user_id = %user_id, "ws-call disconnected");
}

/// Process a `register` message: parse role + channelId, enforce RBAC,
/// and insert the peer into the hub.
fn do_register(
    user: &SessionUser,
    msg: &Value,
    tx: mpsc::Sender<bytes::Bytes>,
    sid: u64,
) -> Result<CallRole, String> {
    let role_str = msg
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("customer");
    let channel_id = msg
        .get("channelId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // RBAC: only staff (employees OR admins) may register as agents.
    let role = match role_str {
        "agent" => {
            if !user.is_staff() {
                return Err("Only staff may register as agents".into());
            }
            CallRole::Agent
        }
        _ => CallRole::Customer,
    };

    let booted = call_hub().register(user.clone(), role, channel_id, tx, sid);
    if !booted.is_empty() {
        tracing::info!(
            user_id = %user.id,
            booted = ?booted,
            "register booted previous peers"
        );
    }
    Ok(role)
}

/// Dispatch a post-registration signal (`call` / `hangup`).
fn handle_post_register_signal(
    user: &SessionUser,
    role: CallRole,
    msg: &Value,
) -> Result<(), String> {
    let ty = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match ty {
        "call" => handle_call(user, role, msg),
        "hangup" => handle_hangup(user, role, msg),
        _ => Err(format!("unknown message type: {ty}")),
    }
}

/// `call` — route an SDP offer / answer / ICE candidate through the
/// session state machine (see `audio_call::session`).
fn handle_call(user: &SessionUser, role: CallRole, msg: &Value) -> Result<(), String> {
    let to = msg.get("to").and_then(|v| v.as_str()).unwrap_or("");
    let kind = msg.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    let sdp = msg.get("sdp");
    let candidate = msg.get("candidate");
    let channel_id = msg.get("channelId").and_then(|v| v.as_str());

    match kind {
        // ── Offer: the session manager owns routing + busy guards ────
        "offer" => {
            let offer = sdp.cloned().unwrap_or_else(|| serde_json::json!(null));
            match role {
                CallRole::Customer => {
                    let uid = user.id.to_string();
                    match sessions().begin_customer_offer(&uid, offer, channel_id.map(str::to_string), pick_agent) {
                        OfferOutcome::Ringing { agent_id } => relay_offer(&uid, &agent_id),
                        OfferOutcome::CustomerBusy => send_error(
                            &uid,
                            "customer-busy",
                            "You are already in a call",
                        ),
                        // No agent / all busy — same split as before:
                        // zero agents online vs. everyone busy.
                        OfferOutcome::NoAgent => {
                            let code = if call_hub().online_agent_count() == 0 {
                                "no-agent"
                            } else {
                                "agents-busy"
                            };
                            let message = if code == "no-agent" {
                                "No agent online right now"
                            } else {
                                "All agents are busy right now — please try again shortly"
                            };
                            send_error(&uid, code, message);
                        }
                        // PeerBusy / AgentBusy can't happen for a customer.
                        OfferOutcome::PeerBusy | OfferOutcome::AgentBusy => {}
                    }
                }
                CallRole::Agent => {
                    if to.is_empty() {
                        return Err("Missing `to` field".into());
                    }
                    // The customer must be online on this hub to receive
                    // the offer.
                    if call_hub().role_of(to) != Some(CallRole::Customer) {
                        send_error(&user.id.to_string(), "peer-unavailable", "Peer not online or invalid");
                        return Ok(());
                    }
                    let uid = user.id.to_string();
                    match sessions().begin_agent_offer(&uid, to, offer, channel_id.map(str::to_string)) {
                        // The session is keyed by the CUSTOMER id (`to`).
                        OfferOutcome::Ringing { agent_id } => relay_offer(to, &agent_id),
                        OfferOutcome::PeerBusy => send_error(
                            &uid,
                            "peer-busy",
                            "Customer is already in a call",
                        ),
                        OfferOutcome::AgentBusy => send_error(
                            &uid,
                            "agent-busy",
                            "You are already in a call",
                        ),
                        _ => {}
                    }
                }
            }
        }
        // ── Answer: validate the session, promote to Active ──────────
        "answer" => {
            if to.is_empty() {
                return Err("Missing `to` field".into());
            }
            // The answerer is `user`; `to` is the offerer. The session
            // is keyed by customer id and pairs the two.
            let (agent_id, customer_id) = match role {
                CallRole::Agent => (user.id.to_string(), to.to_string()),
                CallRole::Customer => (to.to_string(), user.id.to_string()),
            };
            match sessions().on_answer(&agent_id, &customer_id) {
                Some(_) => {
                    // The agent of the session is now in a call — other
                    // customers' offers route elsewhere.
                    call_hub().set_in_call(&agent_id, true);
                    call_hub().broadcast_presence();
                    // The answer goes to the OFFERER (`to`): the customer
                    // for customer-initiated calls, the agent for
                    // agent-initiated ones.
                    let _ = call_hub().send_to(
                        to,
                        &json!({
                            "type": "answer",
                            "from": user.id,
                            "sdp": sdp,
                        }),
                    );
                }
                None => {
                    // Stale answer (re-routed away, already answered, or
                    // no session) — drop it so a late/dup answer can't
                    // fabricate a call.
                    send_error(
                        &user.id.to_string(),
                        "no-session",
                        "No ringing call to answer",
                    );
                }
            }
        }
        // ── ICE: route to the session counterpart ────────────────────
        "ice" => {
            let target_id: Option<String> = match role {
                // Customers may address `to: 'agent'` (web legacy) — the
                // SESSION decides the real target, never a re-pick.
                CallRole::Customer => sessions().agent_for(&user.id.to_string()),
                CallRole::Agent => {
                    if to.is_empty() {
                        return Err("Missing `to` field".into());
                    }
                    sessions().agent_target(&user.id.to_string(), to)
                }
            };
            if let Some(tid) = target_id {
                let _ = call_hub().send_to(
                    &tid,
                    &json!({
                        "type": "ice",
                        "from": user.id,
                        "candidate": candidate,
                    }),
                );
            }
        }
        _ => return Err(format!("Unknown call kind: {kind}")),
    }
    Ok(())
}

/// Relay a stored (or fresh) offer to `agent_id` as an `incoming` frame.
/// `from` is the customer's user id. If the agent's queue is full / they
/// vanished between pick + send, a customer-initiated session is aborted
/// with `peer-unavailable` (the next offer attempt will re-pick).
fn relay_offer(customer_id: &str, agent_id: &str) {
    let Some(s) = sessions().get(customer_id) else { return };
    let sent = call_hub().send_to(
        agent_id,
        &json!({
            "type": "incoming",
            "from": s.customer_id,
            "channelId": s.channel_id,
            "sdp": s.offer,
            "kind": "offer",
        }),
    );
    if !sent {
        // Roll the session back so the customer isn't stuck "ringing"
        // against a dead socket.
        let _ = sessions().on_customer_hangup(customer_id);
        send_error(
            customer_id,
            "peer-unavailable",
            "Peer not online or unavailable",
        );
    }
}

/// Send an error frame to a peer (best-effort).
fn send_error(to: &str, code: &str, message: &str) {
    let _ = call_hub().send_to(
        to,
        &json!({
            "type": "error",
            "code": code,
            "message": message,
        }),
    );
}

/// `hangup` — end (or re-route) the session.
fn handle_hangup(user: &SessionUser, role: CallRole, msg: &Value) -> Result<(), String> {
    // NOTE: the routing target is implied by the live session (validated
    // there) — the client's `to` field is advisory only.
    let reason = msg
        .get("reason")
        .and_then(|v| v.as_str())
        .filter(|r| matches!(*r, "busy" | "declined" | "timeout"))
        .unwrap_or("remote");

    match role {
        CallRole::Customer => {
            // Customer ends the call: the agent learns + their in-call
            // flag clears (they are NOT stuck busy).
            let uid = user.id.to_string();
            if let crate::audio_call::session::CustomerHangup::NotifyAgent { agent_id } =
                sessions().on_customer_hangup(&uid)
            {
                agent_session_cleanup(&agent_id);
                let _ = call_hub().send_to(
                    &agent_id,
                    &json!({
                        "type": "hangup",
                        "from": user.id,
                        "reason": reason,
                    }),
                );
            }
            Ok(())
        }
        CallRole::Agent => {
            // Agent declines / ends. A ringing customer-initiated call
            // escalates to the NEXT free agent instead of dying; an
            // active call (or the agent's own outbound offer) just ends.
            let uid = user.id.to_string();
            // Keep draining sessions this agent holds (paranoia: at
            // most a couple — one active call + ringing leftovers).
            for _ in 0..100 {
                match sessions().on_agent_hangup(&uid, reason, pick_agent) {
                    HangupOutcome::NoSession => break,
                    HangupOutcome::ReRouted { customer_id, agent_id } => {
                        relay_offer(&customer_id, &agent_id);
                        // Continue: the agent may hold more sessions.
                        continue;
                    }
                    HangupOutcome::Notify { customer_id, reason } => {
                        agent_session_cleanup(&uid);
                        let _ = call_hub().send_to(
                            &customer_id,
                            &json!({
                                "type": "hangup",
                                "from": user.id,
                                "reason": reason,
                            }),
                        );
                    }
                }
            }
            // Agent hanging up also clears their own in-call status +
            // broadcasts presence so customers see "employees available".
            agent_session_cleanup(&uid);
            Ok(())
        }
    }
}

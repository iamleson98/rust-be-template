use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use uuid::Uuid;

use super::hub::{Hub, OutboundMessage};

/// Run a single WebSocket connection. Called from the route handler after
/// the upgrade. Owns the read/write loop until the socket closes.
pub async fn run_socket(hub: Arc<Hub>, user_id: Uuid, mut socket: WebSocket) {
    let (handle, mut rx) = hub.register(user_id);

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(txt))) => {
                        let cmd = txt.trim();
                        if let Some(topic) = cmd.strip_prefix("subscribe ") {
                            hub.subscribe(user_id, topic.trim());
                        } else if let Some(topic) = cmd.strip_prefix("unsubscribe ") {
                            hub.unsubscribe(user_id, topic.trim());
                        } else if let Some(target) = cmd.strip_prefix("send ") {
                            if let Some((uid_str, body)) = target.split_once(' ') {
                                if let Ok(target_uid) = Uuid::parse_str(uid_str) {
                                    hub.send_to_user(target_uid, OutboundMessage {
                                        from: Some(user_id),
                                        topic: format!("dm:{user_id}"),
                                        body: body.to_string(),
                                    });
                                }
                            }
                        } else {
                            hub.broadcast(&format!("user:{user_id}"), OutboundMessage {
                                from: Some(user_id),
                                topic: format!("user:{user_id}"),
                                body: cmd.to_string(),
                            });
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => {
                        tracing::warn!(%user_id, error = %e, "ws recv error");
                        break;
                    }
                }
            }
            msg = rx.recv() => {
                match msg {
                    Some(out) => {
                        let text = format!("[{}] {}", out.topic, out.body);
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    hub.unregister(user_id, &handle.sender);
}

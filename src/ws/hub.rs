use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Maximum messages buffered per WebSocket client before we drop the
/// connection. A slow client that can't keep up gets disconnected rather
/// than causing the hub to use unbounded memory.
const WS_CHANNEL_CAPACITY: usize = 64;

/// A handle to a live connection. Cheap to clone.
#[derive(Clone)]
pub struct ClientHandle {
    pub user_id: Uuid,
    pub sender: mpsc::Sender<OutboundMessage>,
}

/// Message the hub hands off to a single client.
#[derive(Debug, Clone)]
pub struct OutboundMessage {
    pub from: Option<Uuid>,
    pub topic: String,
    pub body: String,
}

/// Hub: multiplexes messages across all live connections, with topic
/// subscriptions per user. Designed so a Redis-backed fan-out can be
/// dropped in later — the public API stays the same.
#[derive(Default)]
pub struct Hub {
    /// user_id -> set of topics they subscribe to
    subscriptions: RwLock<HashMap<Uuid, HashSet<String>>>,
    /// user_id -> all open channels for that user (one user may have
    /// multiple connections across devices)
    connections: RwLock<HashMap<Uuid, Vec<ClientHandle>>>,
}

impl Hub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Register a new connection. Returns the handle (for the hub) and
    /// the receiver (for the WS handler task to drain).
    ///
    /// Uses a **bounded** channel so a slow client can't cause unbounded
    /// memory growth. When the buffer fills, `send_to_user` will drop the
    /// message (logged at debug) rather than blocking the hub.
    pub fn register(
        &self,
        user_id: Uuid,
    ) -> (ClientHandle, mpsc::Receiver<OutboundMessage>) {
        let (tx, rx) = mpsc::channel(WS_CHANNEL_CAPACITY);
        let handle = ClientHandle {
            user_id,
            sender: tx,
        };
        self.connections
            .write()
            .entry(user_id)
            .or_default()
            .push(handle.clone());
        (handle, rx)
    }

    pub fn unregister(&self, user_id: Uuid, sender: &mpsc::Sender<OutboundMessage>) {
        let mut conns = self.connections.write();
        if let Some(list) = conns.get_mut(&user_id) {
            // Compare sender identity by raw pointer.
            let sender_ptr = sender as *const _ as usize;
            list.retain(|c| (&c.sender as *const _ as usize) != sender_ptr);
            if list.is_empty() {
                conns.remove(&user_id);
                // Also clean up subscriptions for this user.
                self.subscriptions.write().remove(&user_id);
            }
        }
    }

    pub fn subscribe(&self, user_id: Uuid, topic: impl Into<String>) {
        self.subscriptions
            .write()
            .entry(user_id)
            .or_default()
            .insert(topic.into());
    }

    pub fn unsubscribe(&self, user_id: Uuid, topic: &str) {
        if let Some(set) = self.subscriptions.write().get_mut(&user_id) {
            set.remove(topic);
        }
    }

    /// Broadcast a message to every connection of a single user.
    ///
    /// Uses `try_send` (non-blocking) so a slow client doesn't block the
    /// hub. If the channel is full, the message is dropped for THAT client
    /// only — other clients still receive it.
    pub fn send_to_user(&self, user_id: Uuid, msg: OutboundMessage) {
        if let Some(list) = self.connections.read().get(&user_id) {
            for c in list {
                match c.sender.try_send(msg.clone()) {
                    Ok(()) => {}
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        tracing::warn!(
                            user_id = %user_id,
                            "ws client buffer full; dropping message (slow client?)"
                        );
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => {
                        // Client disconnected; will be cleaned up by `unregister`.
                    }
                }
            }
        }
    }

    /// Broadcast a message to every user subscribed to `topic`.
    pub fn broadcast(&self, topic: &str, msg: OutboundMessage) {
        let subs = self.subscriptions.read();
        let targets: Vec<Uuid> = subs
            .iter()
            .filter_map(|(uid, topics)| topics.contains(topic).then_some(*uid))
            .collect();
        drop(subs);
        for uid in targets {
            self.send_to_user(uid, msg.clone());
        }
    }

    /// Number of currently live connections (across all users).
    pub fn connection_count(&self) -> usize {
        self.connections.read().values().map(|v| v.len()).sum()
    }
}

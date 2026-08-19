//! In-memory presence registry for the WebRTC audio-call signaling server.
//!
//! Built on [`DashMap`] for lock-free concurrent reads/writes — same
//! pattern as `ws/hub.rs` but far simpler: there are no rooms, no
//! broadcast fan-out, no idempotency cache. Just `userId → Peer` and a
//! monotonic socket-id counter.
//!
//! ## Concurrency
//!
//! * Each peer holds a **bounded** `mpsc::Sender<bytes::Bytes>` (capacity 64) —
//!   a slow consumer fills its queue, then `try_send` drops further
//!   messages; the heartbeat sweep eventually reaps the socket. No
//!   unbounded memory growth per client.
//! * `DashMap` shards internally — `insert`/`remove`/`get` are all O(1)
//!   and lock-free for readers.
//! * The hub is a process-local singleton (`OnceLock`); for horizontal
//!   scaling behind multiple instances, swap this for Redis Pub/Sub.
//!
//! ## Single-agent rule
//!
//! For v1 we run a single-operator deployment (one support agent = the
//! site owner). If a second agent connects, the first is force-closed
//! with reason `"replaced"`. Customers can register freely; they're
//! keyed by their user id.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use dashmap::DashMap;
use serde_json::json;
use tokio::sync::mpsc;

use crate::auth::SessionUser;

/// Pre-serialised JSON outbound channel — same model as the chat hub.
/// We serialise once on produce and clone the `String` to the recipient.
pub type PeerTx = mpsc::Sender<bytes::Bytes>;

/// Role a peer registered as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallRole {
    Customer,
    Agent,
}

impl CallRole {
    pub fn as_str(self) -> &'static str {
        match self {
            CallRole::Customer => "customer",
            CallRole::Agent => "agent",
        }
    }
}

/// Everything we need to know about a live signaling peer.
pub struct Peer {
    pub user: SessionUser,
    pub role: CallRole,
    /// Optional chat channel id (used for context — "supporting ticket X").
    pub channel_id: Option<String>,
    pub tx: PeerTx,
    pub connected_at: Instant,
    /// Socket generation id (from `next_socket_id`). Used to guard
    /// `unregister`: when a stale socket finally times out, it must NOT
    /// delete the hub entry of the same user's newer socket (e.g. after a
    /// mobile network switch or a multi-tab "replaced" boot).
    pub sid: u64,
}

impl Peer {
    /// Send a pre-serialised JSON string to this peer. Returns `false` if
    /// the peer's outbound queue is full or the socket has been dropped —
    /// caller should treat that as "peer gone" and clean up.
    pub fn send_raw(&self, payload: &str) -> bool {
        self.tx
            .try_send(bytes::Bytes::copy_from_slice(payload.as_bytes()))
            .is_ok()
    }

    /// Convenience: serialise a `serde_json::Value` and send it.
    pub fn send(&self, msg: &serde_json::Value) -> bool {
        self.send_raw(&msg.to_string())
    }
}

/// The process-local singleton hub.
static HUB: OnceLock<CallHub> = OnceLock::new();

/// Fetch the global hub (initialised lazily on first call).
pub fn call_hub() -> &'static CallHub {
    HUB.get_or_init(CallHub::new)
}

/// The audio-call presence registry.
pub struct CallHub {
    /// `userId → Peer`. For agents the key is the user id (NOT the literal
    /// `"agent"` — that would let two employees fight over the slot; we
    /// instead enforce single-agent-per-brand in `register`).
    peers: DashMap<String, Peer>,
    /// Monotonic socket id (used for logging/tracing only).
    next_sid: AtomicU64,
    /// Total connections accepted (for metrics).
    total_accepted: AtomicU64,
}

impl CallHub {
    fn new() -> Self {
        Self {
            peers: DashMap::new(),
            next_sid: AtomicU64::new(1),
            total_accepted: AtomicU64::new(0),
        }
    }

    /// Allocate a fresh socket id (for logging).
    pub fn next_socket_id(&self) -> u64 {
        self.next_sid.fetch_add(1, Ordering::Relaxed)
    }

    /// Total peers currently registered (customers + agents).
    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    /// Number of agents currently online.
    pub fn online_agent_count(&self) -> usize {
        self.peers
            .iter()
            .filter(|p| p.role == CallRole::Agent)
            .count()
    }

    /// Total connections accepted since boot (for metrics).
    pub fn total_accepted(&self) -> u64 {
        self.total_accepted.load(Ordering::Relaxed)
    }

    /// Register a peer. Returns the previous peer for the same user id
    /// (if any) so the caller can boot them — multiple tabs from the same
    /// user are NOT allowed for v1 (it'd race the single-agent rule and
    /// confuse the relay logic).
    ///
    /// Also enforces the single-agent rule: if this is an agent
    /// registration and another agent is already online, that previous
    /// agent is force-closed with reason `"replaced"` and we return the
    /// list of booted agent user-ids so the caller can broadcast.
    pub fn register(
        &self,
        user: SessionUser,
        role: CallRole,
        channel_id: Option<String>,
        tx: PeerTx,
        sid: u64,
    ) -> Vec<String> {
        self.total_accepted.fetch_add(1, Ordering::Relaxed);
        let mut booted = Vec::new();

        // Single-agent rule: boot any other agents first.
        if role == CallRole::Agent {
            for entry in self.peers.iter_mut() {
                if entry.value().role == CallRole::Agent && entry.key() != &user.id {
                    let booted_id = entry.key().clone();
                    let _ = entry.value().send(&json!({
                        "type": "hangup",
                        "from": "agent",
                        "reason": "replaced",
                    }));
                    booted.push(booted_id);
                }
            }
            for id in &booted {
                self.peers.remove(id);
            }
        }

        // Boot a previous session of the SAME user (multi-tab guard).
        if let Some((_, prev)) = self.peers.remove(&user.id) {
            let _ = prev.send(&json!({
                "type": "hangup",
                "from": "system",
                "reason": "replaced",
            }));
        }

        self.peers.insert(
            user.id.clone(),
            Peer {
                user,
                role,
                channel_id,
                tx,
                connected_at: Instant::now(),
                sid,
            },
        );

        booted
    }

    /// Remove a peer — guarded by socket generation id `sid`.
    ///
    /// Returns the role if (and only if) the hub entry still belongs to
    /// THIS socket. A stale socket that finally times out must not delete
    /// a NEWER entry for the same user (created by a reconnect / multi-tab
    /// boot while the old socket was still lingering) — otherwise the live
    /// socket would become unreachable ("zombie peer"). The `sid` check is
    /// what makes that safe.
    ///
    /// Returning `Some(Agent)` tells the caller to broadcast agent-offline
    /// to all waiting customers.
    pub fn unregister(&self, user_id: &str, sid: u64) -> Option<CallRole> {
        self.peers
            .remove_if(user_id, |_, p| p.sid == sid)
            .map(|(_, p)| p.role)
    }

    /// Send a pre-serialised JSON string to a specific peer by user id.
    /// Returns `false` if the peer isn't online or their queue is full.
    pub fn send_raw_to(&self, user_id: &str, payload: &str) -> bool {
        if let Some(p) = self.peers.get(user_id) {
            p.send_raw(payload)
        } else {
            false
        }
    }

    /// Serialise + send a `serde_json::Value` to a specific peer.
    pub fn send_to(&self, user_id: &str, msg: &serde_json::Value) -> bool {
        self.send_raw_to(user_id, &msg.to_string())
    }

    /// Broadcast a presence update (`{ onlineAgents: N }`) to every
    /// connected peer. Called whenever an agent registers/unregisters.
    pub fn broadcast_presence(&self) {
        let n = self.online_agent_count();
        let payload = serde_json::json!({ "type": "presence", "onlineAgents": n }).to_string();
        for entry in self.peers.iter() {
            let _ = entry.value().send_raw(&payload);
        }
    }

    /// Broadcast a hangup to every customer (used when the sole agent
    /// goes offline — every in-flight call dies).
    pub fn broadcast_agent_offline(&self) {
        let payload = serde_json::json!({
            "type": "hangup",
            "from": "agent",
            "reason": "agent-offline",
        })
        .to_string();
        for entry in self.peers.iter() {
            if entry.value().role == CallRole::Customer {
                let _ = entry.value().send_raw(&payload);
            }
        }
    }

    /// Snapshot of online agent names (for the `/health` endpoint + logs).
    pub fn online_agent_names(&self) -> Vec<String> {
        self.peers
            .iter()
            .filter(|p| p.role == CallRole::Agent)
            .map(|p| p.user.name.clone())
            .collect()
    }

    /// Look up the role of a registered peer. Used by the handler to
    /// route `call` messages correctly (customer → agent vs. agent → customer).
    pub fn role_of(&self, user_id: &str) -> Option<CallRole> {
        self.peers.get(user_id).map(|p| p.role)
    }

    /// Find any online agent's user id. Used to route customer → "agent"
    /// offers when the customer doesn't know which specific agent is online
    /// (single-operator deployment → there's at most one).
    pub fn any_online_agent_id(&self) -> Option<String> {
        self.peers
            .iter()
            .find(|p| p.role == CallRole::Agent)
            .map(|p| p.key().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::SessionUser;

    /// All these tests run against the SAME global singleton hub, and some
    /// make absolute assertions about global agent counts. Rust runs tests
    /// in parallel threads, so without serialisation they race each other
    /// (e.g. one test's live agent breaks another test's `count == 0`
    /// assertion). Locking this mutex at the top of each test serialises
    /// them without needing an external `serial_test` dependency.
    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn fake_user(id: &str, actor: &str) -> SessionUser {
        SessionUser {
            id: id.into(),
            actor_type: actor.into(),
            role: "customer".into(),
            name: id.into(),
            email: None,
            phone: None,
            avatar_url: None,
            brand_id: None,
            brand_name: None,
            employee_role: None,
        }
    }

    fn hub() -> &'static CallHub {
        // Each test gets a fresh hub via a per-test local — but `call_hub()`
        // returns the global singleton, so we test against that. Tests must
        // use unique user ids to avoid colliding with each other.
        call_hub()
    }

    #[tokio::test]
    async fn register_and_unregister() {
        let _guard = TEST_LOCK.lock().unwrap();
        let id = format!("test-reg-{}", uuid::Uuid::new_v4());
        let (tx, _rx) = mpsc::channel::<bytes::Bytes>(8);
        let h = hub();
        let sid = h.next_socket_id();
        // Registering a CUSTOMER must not change the global agent count
        // (assert relative to a baseline, not absolute zero — the hub is a
        // process-wide singleton).
        let agents_before = h.online_agent_count();
        let booted = h.register(fake_user(&id, "user"), CallRole::Customer, None, tx, sid);
        assert!(booted.is_empty());
        assert!(h.peer_count() >= 1);
        assert_eq!(h.online_agent_count(), agents_before);

        let role = h.unregister(&id, sid);
        assert_eq!(role, Some(CallRole::Customer));
        assert_eq!(h.online_agent_count(), agents_before);
    }

    #[tokio::test]
    async fn single_agent_rule_boots_previous() {
        let _guard = TEST_LOCK.lock().unwrap();
        let id1 = format!("test-agent1-{}", uuid::Uuid::new_v4());
        let id2 = format!("test-agent2-{}", uuid::Uuid::new_v4());
        let (tx1, _rx1) = mpsc::channel::<bytes::Bytes>(8);
        let (tx2, _rx2) = mpsc::channel::<bytes::Bytes>(8);
        let h = hub();

        // Baseline so we don't depend on the global singleton being empty.
        let agents_before = h.online_agent_count();

        let sid1 = h.next_socket_id();
        h.register(
            fake_user(&id1, "employee"),
            CallRole::Agent,
            None,
            tx1,
            sid1,
        );
        let sid2 = h.next_socket_id();
        let booted = h.register(
            fake_user(&id2, "employee"),
            CallRole::Agent,
            None,
            tx2,
            sid2,
        );
        assert_eq!(booted, vec![id1.clone()]);
        // The single-agent rule keeps exactly ONE of our two agents alive,
        // so the count grows by exactly 1 relative to the baseline.
        assert_eq!(h.online_agent_count(), agents_before + 1);

        // Clean up.
        h.unregister(&id2, sid2);
        assert_eq!(h.online_agent_count(), agents_before);
    }

    /// A stale socket timing out must NOT delete a newer entry for the same
    /// user (reconnect / multi-tab boot). The sid guard prevents the zombie.
    #[tokio::test]
    async fn stale_unregister_does_not_evict_newer_socket() {
        let _guard = TEST_LOCK.lock().unwrap();
        let id = format!("test-zombie-{}", uuid::Uuid::new_v4());
        let h = hub();

        // Old socket registers.
        let (tx_old, _rx_old) = mpsc::channel::<bytes::Bytes>(8);
        let sid_old = h.next_socket_id();
        h.register(
            fake_user(&id, "user"),
            CallRole::Customer,
            None,
            tx_old,
            sid_old,
        );

        // Same user reconnects with a NEW socket (boots the old entry).
        let (tx_new, _rx_new) = mpsc::channel::<bytes::Bytes>(8);
        let sid_new = h.next_socket_id();
        h.register(
            fake_user(&id, "user"),
            CallRole::Customer,
            None,
            tx_new,
            sid_new,
        );

        // The OLD socket now times out and tries to unregister — this must
        // be a no-op because the hub entry belongs to sid_new, not sid_old.
        let removed = h.unregister(&id, sid_old);
        assert_eq!(removed, None, "stale sid must not evict the live entry");
        assert_eq!(h.role_of(&id), Some(CallRole::Customer));

        // The NEW socket unregistering does remove the entry.
        let removed = h.unregister(&id, sid_new);
        assert_eq!(removed, Some(CallRole::Customer));
        assert_eq!(h.role_of(&id), None);
    }

    #[tokio::test]
    async fn send_to_offline_returns_false() {
        let h = hub();
        let ok = h.send_to("does-not-exist", &serde_json::json!({ "type": "ping" }));
        assert!(!ok);
    }
}

//! In-memory presence registry for the WebRTC audio-call signaling server.
//!
//! Built on [`DashMap`] for lock-free concurrent reads/writes — same
//! pattern as `ws/hub.rs`.
//!
//! ## Multi-session peers (one user, many devices)
//!
//! A user may hold SEVERAL live sockets at once — e.g. logged in on the
//! web console AND on the phone app. Every frame routed "to a user" is
//! fanned out to ALL of that user's sockets, so an inbound call rings on
//! every device simultaneously. Sessions are keyed per-user in
//! [`crate::audio_call::session`]; which socket actually picked up is
//! remembered there (`agent_sid` / `customer_sid`) so a socket drop only
//! ends the call when the socket that carried it disappears, and a call
//! answered on one device sends `answered-elsewhere` to the others so
//! they stop ringing.
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
//!   scaling across instances, swap this for Redis Pub/Sub.
//!
//! ## Multi-agent routing
//!
//! Every staff member (employee OR admin) may register as an agent
//! simultaneously. Customers' calls are routed by the session manager
//! (`crate::audio_call::session`) to the agent that is logged in but
//! NOT busy — availability comes from the shared presence registry
//! (`crate::presence`) so chat load + call state are considered
//! together. The session manager OWNS the call lifecycle (ringing →
//! active → ended); this hub is only the peer/socket registry.
//!
//! ## In-call tracking
//!
//! When an agent accepts a call (`answer` kind), they're marked as
//! `in_call=true`. The presence broadcast now includes `agentInCall`
//! so customers can see "employees are busy" and their call buttons
//! are disabled. Session end — EITHER side hanging up, a socket drop,
//! or the ring queue exhausting — clears `in_call` via the session
//! manager's handler hooks (a customer-side hangup used to leave the
//! agent stuck busy forever).

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use dashmap::DashMap;

use crate::presence::presence;
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
    /// mobile network switch), and multi-session routing uses it to
    /// exclude the answering device from `answered-elsewhere` fan-out.
    pub sid: u64,
    /// Whether this peer is currently in an active audio call.
    /// For agents: when `true`, customers see "employees are busy" +
    /// their call buttons are disabled. Set to `true` when the agent
    /// sends an `answer` (accepting the call), `false` on `hangup`.
    pub in_call: bool,
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
///
/// Peers are keyed by socket id (`sid`); a secondary index maps
/// `user_id → Vec<sid>` so every user-level operation fans out to all
/// of that user's devices (web + phone + extra tabs all ring at once).
pub struct CallHub {
    /// `sid → Peer` (the authoritative registry).
    peers: DashMap<u64, Peer>,
    /// `userId → socket ids` — the multi-device index. Kept in lock-step
    /// with `peers` by `register` / `unregister` (both O(1) amortised;
    /// the vec is tiny — one entry per connected device).
    by_user: DashMap<String, Vec<u64>>,
    /// Monotonic socket id (used for logging/tracing only).
    next_sid: AtomicU64,
    /// Total connections accepted (for metrics).
    total_accepted: AtomicU64,
}

impl CallHub {
    fn new() -> Self {
        Self {
            peers: DashMap::new(),
            by_user: DashMap::new(),
            next_sid: AtomicU64::new(1),
            total_accepted: AtomicU64::new(0),
        }
    }

    /// Allocate a fresh socket id (for logging).
    pub fn next_socket_id(&self) -> u64 {
        self.next_sid.fetch_add(1, Ordering::Relaxed)
    }

    /// Total peers currently registered (customers + agents, one entry
    /// per SOCKET — a user with web + phone counts twice).
    pub fn peer_count(&self) -> usize {
        self.peers.len()
    }

    /// Number of distinct users with at least one socket connected.
    pub fn user_count(&self) -> usize {
        self.by_user.len()
    }

    /// Number of sockets a user currently holds (web + phone + …).
    pub fn user_socket_count(&self, user_id: &str) -> usize {
        self.by_user.get(user_id).map(|v| v.len()).unwrap_or(0)
    }

    /// Number of agents currently online (sockets, one per device —
    /// an agent on two devices counts once per device for presence
    /// gauges; availability routing de-dupes by user id).
    pub fn online_agent_count(&self) -> usize {
        self.peers
            .iter()
            .filter(|p| p.role == CallRole::Agent)
            .count()
    }

    /// Whether any agent is currently in an active call.
    pub fn is_agent_in_call(&self) -> bool {
        self.peers
            .iter()
            .any(|p| p.role == CallRole::Agent && p.in_call)
    }

    /// Total connections accepted since boot (for metrics).
    pub fn total_accepted(&self) -> u64 {
        self.total_accepted.load(Ordering::Relaxed)
    }

    /// Register a peer. Multi-agent: every staff member may be an agent
    /// at once, and ONE user may hold several sockets simultaneously
    /// (web console + phone app) — a new socket never boots the user's
    /// other devices; inbound calls ring on all of them.
    ///
    /// Agent registrations also feed the shared presence registry so
    /// chat routing sees the same person as online.
    pub fn register(
        &self,
        user: SessionUser,
        role: CallRole,
        channel_id: Option<String>,
        tx: PeerTx,
        sid: u64,
    ) -> usize {
        self.total_accepted.fetch_add(1, Ordering::Relaxed);
        let user_id = user.id.to_string();

        if role == CallRole::Agent {
            presence().call_socket_connected(&user, sid);
        }

        self.peers.insert(
            sid,
            Peer {
                user,
                role,
                channel_id,
                tx,
                connected_at: Instant::now(),
                sid,
                in_call: false,
            },
        );
        let socket_count = {
            let mut entry = self.by_user.entry(user_id).or_default();
            entry.push(sid);
            entry.len()
        };
        socket_count
    }

    /// Remove a peer — keyed by socket generation id `sid`.
    ///
    /// Returns `Some(role)` when this was the user's LAST socket (the
    /// user as a whole went offline — the caller should run session
    /// cleanup / agent-offline handling), and `None` when the user still
    /// has other live sockets (e.g. the phone dropped but the web
    /// console stays online — their sessions must survive).
    ///
    /// A stale socket that finally times out can never delete a NEWER
    /// entry for the same user (the sid key makes that impossible).
    pub fn unregister(&self, user_id: &str, sid: u64) -> Option<CallRole> {
        let removed = self.peers.remove(&sid).map(|(_, p)| p.role);

        // Maintain the user index: drop the sid; remove the whole index
        // entry when the vec is empty (avoids leaking empty vecs).
        let mut user_has_sockets = false;
        if let Some(mut v) = self.by_user.get_mut(user_id) {
            v.retain(|s| *s != sid);
            let now_empty = v.is_empty();
            user_has_sockets = !now_empty;
            drop(v);
            if now_empty {
                self.by_user.remove(user_id);
            }
        }

        if removed.is_some() {
            presence().call_socket_disconnected(user_id, sid);
            // Only the LAST socket reports the user as offline — earlier
            // sockets dropping leave the user reachable on their other
            // devices, so their sessions must survive.
            if user_has_sockets {
                return None;
            }
        }
        removed
    }

    /// Mark a peer as in-call (or not). Used when an agent accepts a call
    /// (`answer` kind → `in_call=true`) or hangs up (`hangup` → `in_call=false`).
    /// Applies to every socket of the user (their availability is a
    /// per-USER property, not per-device).
    ///
    /// Returns `true` if at least one peer was found and updated. After
    /// updating, the caller should broadcast presence so all customers
    /// see the new state.
    pub fn set_in_call(&self, user_id: &str, in_call: bool) -> bool {
        let sids: Vec<u64> = self
            .by_user
            .get(user_id)
            .map(|v| v.clone())
            .unwrap_or_default();
        let mut updated = false;
        for sid in sids {
            if let Some(mut p) = self.peers.get_mut(&sid) {
                p.in_call = in_call;
                updated = true;
            }
        }
        if updated {
            // Mirror into the shared presence registry (chat routing
            // must see this agent as busy/unavailable).
            presence().set_in_call(user_id, in_call);
        }
        updated
    }

    /// Send a pre-serialised JSON string to EVERY socket of a user
    /// (web + phone ring / hang up together). Returns `true` if at
    /// least one socket accepted the message.
    pub fn send_raw_to(&self, user_id: &str, payload: &str) -> bool {
        let sids: Vec<u64> = self
            .by_user
            .get(user_id)
            .map(|v| v.clone())
            .unwrap_or_default();
        let mut sent = false;
        for sid in sids {
            if let Some(p) = self.peers.get(&sid) {
                if p.send_raw(payload) {
                    sent = true;
                }
            }
        }
        sent
    }

    /// Serialise + send a `serde_json::Value` to every socket of a user.
    pub fn send_to(&self, user_id: &str, msg: &serde_json::Value) -> bool {
        self.send_raw_to(user_id, &msg.to_string())
    }

    /// Send to every socket of a user EXCEPT one (e.g. the socket that
    /// just answered the call — the agent's OTHER devices get a
    /// `answered-elsewhere` hangup so they stop ringing without killing
    /// the live call on the answering device).
    pub fn send_to_except(&self, user_id: &str, except_sid: u64, msg: &serde_json::Value) -> bool {
        let payload = msg.to_string();
        let sids: Vec<u64> = self
            .by_user
            .get(user_id)
            .map(|v| v.clone())
            .unwrap_or_default();
        let mut sent = false;
        for sid in sids {
            if sid == except_sid {
                continue;
            }
            if let Some(p) = self.peers.get(&sid) {
                if p.send_raw(&payload) {
                    sent = true;
                }
            }
        }
        sent
    }

    /// Broadcast a presence update to every connected peer. Called whenever
    /// an agent registers/unregisters or their in-call status changes.
    ///
    /// The payload includes:
    /// - `onlineAgents`: number of agents currently online
    /// - `agentInCall`: whether any agent is in an active call (customers
    ///   use this to show "employees are busy" + disable their call buttons)
    pub fn broadcast_presence(&self) {
        let n = self.online_agent_count();
        let in_call = self.is_agent_in_call();
        // Availability from the shared presence registry — customers'
        // call buttons enable when at least one agent is free.
        let available = self.pick_available_agent_id().is_some();
        let payload = serde_json::json!({
            "type": "presence",
            "onlineAgents": n,
            "agentInCall": in_call,
            "agentsAvailable": available,
        })
        .to_string();
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

    /// Look up the role of a registered peer (any of their sockets).
    /// Used by the handler to route `call` messages correctly
    /// (customer → agent vs. agent → customer).
    pub fn role_of(&self, user_id: &str) -> Option<CallRole> {
        let sids: Vec<u64> = self
            .by_user
            .get(user_id)
            .map(|v| v.clone())
            .unwrap_or_default();
        let first = sids.first()?;
        self.peers.get(first).map(|p| p.role)
    }

    /// Pick the best agent for a NEW customer call: the staff member
    /// the presence registry considers most available (online, not in
    /// a call, lowest chat load) who is ALSO registered on this call
    /// hub. Falls back to `None` when every agent is busy.
    pub fn pick_available_agent_id(&self) -> Option<String> {
        self.pick_available_agent_id_excluding(&HashSet::new())
    }

    /// Same as [`pick_available_agent_id`], but never picks a member of
    /// `exclude` — the session manager passes the agents a call already
    /// rang (ring escalation) + agents currently ringing for someone
    /// else so one phone is never stacked with two callers.
    pub fn pick_available_agent_id_excluding(&self, exclude: &HashSet<String>) -> Option<String> {
        // Candidate = registered HERE as an agent + available in the
        // shared presence registry + not excluded. Ranked with the SAME
        // ordering the chat router uses (chat load → recency → employees
        // first). De-duped per user (a user on two devices is one agent).
        // Collect the agent user ids FIRST (no nested same-map access —
        // DashMap guards don't nest across an `iter()`).
        let mut agent_ids: Vec<String> = Vec::new();
        for p in self.peers.iter() {
            if p.value().role == CallRole::Agent {
                let uid = p.value().user.id.to_string();
                if !agent_ids.contains(&uid) && !exclude.contains(&uid) {
                    agent_ids.push(uid);
                }
            }
        }
        let mut candidates: Vec<(String, crate::presence::StaffEntry)> = agent_ids
            .into_iter()
            .filter_map(|id| presence().get(&id).map(|s| (id, s)))
            .filter(|(_, s)| s.available())
            .collect();
        candidates.sort_by(|a, b| crate::presence::StaffEntry::availability_cmp(&a.1, &b.1));
        candidates.into_iter().next().map(|(id, _)| id)
    }

    /// Pick with fallback: prefer the most-available agent, but if all
    /// are busy fall back to any online agent (call waiting) — used by
    /// callers that prefer a busy agent over a hard "no-agent" error.
    pub fn pick_available_agent_id_or_any(&self) -> Option<String> {
        self.pick_available_agent_id()
            .or_else(|| self.any_online_agent_id())
    }

    /// Find any online agent's user id (busy or not).
    pub fn any_online_agent_id(&self) -> Option<String> {
        for p in self.peers.iter() {
            if p.value().role == CallRole::Agent {
                return Some(p.value().user.id.to_string());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

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
            // The hub keys peers by `user.id.to_string()`, so a test id
            // MUST be a valid UUID string — parse strictly (a silent
            // random-uuid fallback would decouple the hub key from the
            // id the test later looks up).
            id: Uuid::parse_str(id).expect("test user id must be a UUID string"),
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
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, _rx) = mpsc::channel::<bytes::Bytes>(8);
        let h = hub();
        let sid = h.next_socket_id();
        // Registering a CUSTOMER must not change the global agent count
        // (assert relative to a baseline, not absolute zero — the hub is a
        // process-wide singleton).
        let agents_before = h.online_agent_count();
        h.register(fake_user(&id, "user"), CallRole::Customer, None, tx, sid);
        assert!(h.peer_count() >= 1);
        assert_eq!(h.online_agent_count(), agents_before);

        let role = h.unregister(&id, sid);
        assert_eq!(role, Some(CallRole::Customer));
        assert_eq!(h.online_agent_count(), agents_before);
        assert_eq!(h.user_socket_count(&id), 0);
    }

    #[tokio::test]
    async fn multiple_agents_register_simultaneously() {
        let _guard = TEST_LOCK.lock().unwrap();
        let id1 = uuid::Uuid::new_v4().to_string();
        let id2 = uuid::Uuid::new_v4().to_string();
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
        h.register(
            fake_user(&id2, "employee"),
            CallRole::Agent,
            None,
            tx2,
            sid2,
        );
        // Multi-agent: the second registration does NOT disturb the first.
        assert_eq!(h.online_agent_count(), agents_before + 2);

        // Clean up.
        h.unregister(&id1, sid1);
        h.unregister(&id2, sid2);
        assert_eq!(h.online_agent_count(), agents_before);
    }

    /// The core multi-session behaviour: the SAME user registers TWO
    /// sockets (web + phone). Neither boots the other; sends fan out to
    /// both; only the LAST unregister reports the user offline.
    #[tokio::test]
    async fn same_user_two_sockets_both_live() {
        let _guard = TEST_LOCK.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let (tx_web, mut rx_web) = mpsc::channel::<bytes::Bytes>(8);
        let (tx_phone, mut rx_phone) = mpsc::channel::<bytes::Bytes>(8);
        let h = hub();
        let sid_web = h.next_socket_id();
        h.register(
            fake_user(&id, "employee"),
            CallRole::Agent,
            None,
            tx_web,
            sid_web,
        );
        let sid_phone = h.next_socket_id();
        h.register(
            fake_user(&id, "employee"),
            CallRole::Agent,
            None,
            tx_phone,
            sid_phone,
        );
        assert_eq!(h.user_socket_count(&id), 2);
        assert_eq!(h.role_of(&id), Some(CallRole::Agent));

        // A frame to the user reaches BOTH devices.
        let sent = h.send_to(&id, &serde_json::json!({ "type": "incoming" }));
        assert!(sent);
        assert!(rx_web.try_recv().is_ok());
        assert!(rx_phone.try_recv().is_ok());

        // The phone socket dropping does NOT report the user offline
        // (the web console is still connected).
        let role = h.unregister(&id, sid_phone);
        assert_eq!(role, None, "user still has a live web socket");
        assert_eq!(h.user_socket_count(&id), 1);
        assert_eq!(h.role_of(&id), Some(CallRole::Agent));

        // The LAST socket dropping reports the user offline.
        let role = h.unregister(&id, sid_web);
        assert_eq!(role, Some(CallRole::Agent));
        assert_eq!(h.role_of(&id), None);
    }

    /// `send_to_except` — the answered-elsewhere fan-out skips the
    /// answering device but reaches the rest.
    #[tokio::test]
    async fn send_to_except_skips_one_socket() {
        let _guard = TEST_LOCK.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let (tx_a, mut rx_a) = mpsc::channel::<bytes::Bytes>(8);
        let (tx_b, mut rx_b) = mpsc::channel::<bytes::Bytes>(8);
        let h = hub();
        let sid_a = h.next_socket_id();
        h.register(
            fake_user(&id, "user"),
            CallRole::Customer,
            None,
            tx_a,
            sid_a,
        );
        let sid_b = h.next_socket_id();
        h.register(
            fake_user(&id, "user"),
            CallRole::Customer,
            None,
            tx_b,
            sid_b,
        );

        let sent = h.send_to_except(
            &id,
            sid_a,
            &serde_json::json!({ "type": "hangup", "reason": "answered-elsewhere" }),
        );
        assert!(sent);
        assert!(
            rx_a.try_recv().is_err(),
            "the answering socket must be skipped"
        );
        assert!(rx_b.try_recv().is_ok());

        h.unregister(&id, sid_a);
        h.unregister(&id, sid_b);
    }

    #[tokio::test]
    async fn pick_available_excludes_agents() {
        let _guard = TEST_LOCK.lock().unwrap();
        let agent = uuid::Uuid::new_v4().to_string();
        let (tx_a, _rx_a) = mpsc::channel::<bytes::Bytes>(8);
        let h = hub();
        let sid = h.next_socket_id();
        h.register(
            fake_user(&agent, "employee"),
            CallRole::Agent,
            None,
            tx_a,
            sid,
        );
        // The agent is online + available → picked normally.
        assert_eq!(
            h.pick_available_agent_id_excluding(&HashSet::new()),
            Some(agent.clone())
        );
        // …but excluded (already rang for this call / ringing for
        // someone else) → no candidate.
        let mut exclude = HashSet::new();
        exclude.insert(agent.clone());
        assert_eq!(h.pick_available_agent_id_excluding(&exclude), None);

        // Agent leaving drops them from candidacy entirely.
        h.unregister(&agent, sid);
        assert_eq!(h.pick_available_agent_id(), None);
    }

    /// A stale socket timing out must NOT delete a newer entry for the same
    /// user (reconnect). The sid key prevents the zombie.
    #[tokio::test]
    async fn stale_unregister_does_not_evict_newer_socket() {
        let _guard = TEST_LOCK.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
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

        // Same user reconnects with a NEW socket.
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
        // not take the user offline (the newer socket still lives).
        let removed = h.unregister(&id, sid_old);
        assert_eq!(removed, None, "stale sid must not evict the live entry");
        assert_eq!(h.role_of(&id), Some(CallRole::Customer));
        assert_eq!(h.user_socket_count(&id), 1);

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

    #[tokio::test]
    async fn in_call_tracking() {
        let _guard = TEST_LOCK.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, _rx) = mpsc::channel::<bytes::Bytes>(8);
        let h = hub();
        let sid = h.next_socket_id();
        h.register(fake_user(&id, "employee"), CallRole::Agent, None, tx, sid);

        // Initially not in call.
        assert!(!h.is_agent_in_call());

        // Mark as in call.
        assert!(h.set_in_call(&id, true));
        assert!(h.is_agent_in_call());

        // Mark as not in call.
        assert!(h.set_in_call(&id, false));
        assert!(!h.is_agent_in_call());

        // Clean up.
        h.unregister(&id, sid);
    }
}

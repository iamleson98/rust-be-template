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
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use dashmap::{DashMap, DashSet};

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
static HUB_CFG: OnceLock<(usize, usize)> = OnceLock::new();

// ── presence-broadcast coalescing state (see broadcast_presence) ────
// Process-global (the hub is a process singleton in production; test
// instances share the throttle, which only ever DELAYS a duplicate
// broadcast — it never redirects one to the wrong hub).
/// Min gap between real presence fan-outs (250 ms ⇒ ≤ 4 Hz).
static PRESENCE_COALESCE: Duration = Duration::from_millis(250);
/// A change landed inside the window; the trailing broadcast must fire.
static PRESENCE_DIRTY: AtomicBool = AtomicBool::new(false);
/// A trailing broadcast task is scheduled (guards against stacking one
/// task per event during a burst).
static PRESENCE_TRAILING: AtomicBool = AtomicBool::new(false);
/// Last real fan-out timestamp.
static PRESENCE_LAST: Mutex<Option<Instant>> = Mutex::new(None);

/// Fetch the global hub (initialised lazily on first call).
pub fn call_hub() -> &'static CallHub {
    HUB.get_or_init(|| {
        // Same fallback shape as the chat hub: a generous default until
        // `init_with_config` wires the real `WsConfig` values in.
        let (max, per_ip) = *HUB_CFG.get().unwrap_or(&(50_000, 20));
        CallHub::with_limits(max, per_ip)
    })
}

/// Why [`admit`] turned a socket away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// `WS_MAX_CONNECTIONS` call sockets are open.
    Full,
    /// `WS_MAX_PER_IP` call sockets are open from this address.
    IpFull,
}

/// The connection slots (global + per-IP) one `/ws-call` socket holds,
/// given back when dropped: at the end of the socket task, on a panic, or
/// when the HTTP upgrade fails and the socket task never runs (axum then
/// drops the upgrade callback holding this — before, those slots leaked).
#[must_use = "dropping an Admission gives its slots back"]
#[derive(Debug)]
pub struct Admission {
    ip: String,
}

impl Drop for Admission {
    fn drop(&mut self) {
        call_hub().release_ip(&self.ip);
        call_hub().release_global();
    }
}

/// Take a global and a per-IP slot for a socket from `ip` (global first:
/// the cheapest refusal), or neither.
pub fn admit(ip: &str) -> Result<Admission, Refusal> {
    let hub = call_hub();
    if !hub.try_acquire_global() {
        return Err(Refusal::Full);
    }
    if !hub.try_acquire_ip(ip) {
        hub.release_global();
        return Err(Refusal::IpFull);
    }
    Ok(Admission { ip: ip.to_string() })
}

/// Wire `WsConfig.max_connections` / `WsConfig.max_per_ip` into the
/// call hub. MUST be called before the first `call_hub()` call (the
/// boot order in `server.rs::bootstrap` guarantees that). Second call
/// is a no-op (`OnceLock`).
///
/// `/ws-call` previously had NO admission control at all — every
/// authenticated account could hold unlimited signaling sockets (each
/// = 2 spawned tasks + a channel + hub entries); a botnet of valid
/// accounts could exhaust memory/threads with the chat hub none the
/// wiser (its caps only counted `/ws`).
pub fn init_with_config(max_global: usize, max_per_ip: usize) {
    let _ = HUB_CFG.set((max_global, max_per_ip));
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
    /// Global connection cap (0 = unlimited) — mirrors the chat hub.
    max_global_conns: usize,
    /// Live call-WS connections (acquired on upgrade, released in
    /// `unregister`).
    global_conns: AtomicUsize,
    /// Per-IP connection cap (0 = unlimited).
    max_per_ip: usize,
    /// Per-IP live connection counts — mirrors the chat hub.
    ip_conns: DashMap<String, AtomicUsize>,
    /// Agent user ids currently online (one entry per user, regardless
    /// of how many devices they hold). Every presence question
    /// (`online_agent_count`, `is_agent_in_call`, agent picking, agent
    /// names) used to answer by scanning ALL peers — O(customers) on a
    /// hub whose population is overwhelmingly customers. The index is
    /// O(agents) and maintained in `register`/`unregister`.
    agent_ids: DashSet<String>,
}

impl CallHub {
    /// Construct with explicit connection caps (used by `call_hub()` and
    /// by tests that want isolated limits).
    pub fn with_limits(max_global: usize, max_per_ip: usize) -> Self {
        Self {
            peers: DashMap::new(),
            by_user: DashMap::new(),
            next_sid: AtomicU64::new(1),
            total_accepted: AtomicU64::new(0),
            max_global_conns: max_global,
            global_conns: AtomicUsize::new(0),
            max_per_ip,
            ip_conns: DashMap::new(),
            agent_ids: DashSet::new(),
        }
    }

    // ── connection admission (mirrors the chat hub) ──────────────

    /// Atomically try to acquire a GLOBAL call-WS slot. Returns `false`
    /// when the cap is exceeded (caller rejects the upgrade).
    pub fn try_acquire_global(&self) -> bool {
        if self.max_global_conns == 0 {
            self.global_conns.fetch_add(1, Ordering::AcqRel);
            return true;
        }
        loop {
            let cur = self.global_conns.load(Ordering::Acquire);
            if cur >= self.max_global_conns {
                return false;
            }
            if self
                .global_conns
                .compare_exchange(cur, cur + 1, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                return true;
            }
        }
    }

    /// Release a global slot. Saturates at zero in one atomic step: a
    /// double release must neither wrap to usize::MAX for another thread
    /// to see nor, by "undoing" it, erase a concurrent acquire.
    pub fn release_global(&self) {
        let _ = self
            .global_conns
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_sub(1));
    }

    /// Live call-WS connection count (metrics / caps logging).
    pub fn connection_count(&self) -> usize {
        self.global_conns.load(Ordering::Acquire)
    }

    /// Try to acquire a per-IP slot against the configured cap
    /// (`WsConfig.max_per_ip`, same value the chat hub enforces).
    /// `max_per_ip == 0` means UNLIMITED (default — hardware-bounded
    /// admission via `middleware::resource_guard`); connections are still
    /// counted per-IP, the check just never denies.
    pub fn try_acquire_ip(&self, ip: &str) -> bool {
        let entry = self.ip_conns.entry(ip.to_string()).or_default();
        loop {
            let cur = entry.load(Ordering::Acquire);
            if self.max_per_ip > 0 && cur >= self.max_per_ip {
                return false;
            }
            if entry
                .compare_exchange(cur, cur + 1, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                return true;
            }
        }
    }

    /// Release a per-IP slot; removes the map entry when it hits zero
    /// (so `ip_conns` cannot grow one-entry-per-IP-seen forever).
    pub fn release_ip(&self, ip: &str) {
        if let Some(entry) = self.ip_conns.get(ip) {
            // Saturating, like `release_global`: an extra release leaves 0.
            let prev = entry
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_sub(1))
                .unwrap_or(0);
            let hit_zero = prev <= 1;
            drop(entry);
            if hit_zero {
                // `remove_if` re-checks under the shard write lock: the
                // old unconditional `remove(ip)` raced a concurrent
                // `try_acquire_ip` (T2 CASes 0→1 on the same entry; T1's
                // remove then deletes T2's slot — the per-IP cap silently
                // erodes and `ip_conns` undercounts). Same fix as the chat
                // hub's `release_ip`.
                self.ip_conns
                    .remove_if(ip, |_, v| v.load(Ordering::Acquire) == 0);
            }
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
    ///
    /// O(agents) via the `agent_ids` index (was: a full scan of every
    /// peer — customers included — on each presence broadcast, and the
    /// broadcast fired on every customer register too).
    pub fn online_agent_count(&self) -> usize {
        let mut sockets = 0;
        for uid in self.agent_ids.iter() {
            sockets += self.user_socket_count(uid.key());
        }
        sockets
    }

    /// Whether any agent is currently in an active call.
    /// O(agents): `in_call` is a per-USER property (`set_in_call` stamps
    /// every socket of the user), so checking one socket per agent is
    /// sufficient.
    pub fn is_agent_in_call(&self) -> bool {
        for uid in self.agent_ids.iter() {
            if let Some(sids) = self.by_user.get(uid.key()) {
                if let Some(first) = sids.iter().next() {
                    if let Some(p) = self.peers.get(first) {
                        if p.in_call {
                            return true;
                        }
                    }
                }
            }
        }
        false
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
            self.agent_ids.insert(user_id.clone());
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
    ///
    /// NOTE: admission-slot release deliberately does NOT live here —
    /// `handle_socket`'s teardown is the ONE release site (a socket
    /// that never sent `register` has no peer here, so a release in
    /// this method would leak its slots).
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
                // Re-checked under the shard lock: the user's other device
                // may have registered since `drop(v)`, and a plain
                // `remove` would delete its socket from the index.
                self.by_user.remove_if(user_id, |_, v| v.is_empty());
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
            // Last socket gone → the AGENT index entry goes with it.
            if removed == Some(CallRole::Agent) {
                self.agent_ids.remove(user_id);
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

    /// Serialise + send to ONE socket (by session id). Used by the
    /// missed-offer re-delivery on register: the frame must land on the
    /// socket that JUST registered — the user's other sockets already
    /// have it (or don't need it), and a user-wide fan-out would make
    /// every reconnect re-ring the agent's web console too.
    pub fn send_to_sid(&self, sid: u64, msg: &serde_json::Value) -> bool {
        let payload = msg.to_string();
        match self.peers.get(&sid) {
            Some(p) => p.send_raw(&payload),
            None => false,
        }
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
    ///
    /// ## Coalescing (≤ 4 Hz)
    ///
    /// Each broadcast used to cost FOUR O(all-peers) scans
    /// (`broadcast_staff_presence`'s session filter, `online_agent_count`,
    /// `is_agent_in_call`, `pick_available_agent_id`) plus an O(N) chat-hub
    /// fan-out — and it fired on EVERY customer `register`, which is the
    /// one event that changes NOTHING in the payload (customers are not in
    /// it). Under a customer connect storm that is O(customers × peers)
    /// pure waste. Two fixes, in order of impact:
    ///   1. call sites gate on AGENT state changes (handler.rs);
    ///   2. this method coalesces bursts: a leading broadcast goes out
    ///      immediately (single events — and every test — stay
    ///      synchronous), and anything arriving within the following
    ///      250 ms only marks a dirty flag + schedules ONE trailing
    ///      broadcast — max 4 broadcasts/sec no matter the event rate.
    ///      When no tokio runtime is available (sync unit tests), the
    ///      trailing path degrades to an immediate inline broadcast.
    pub fn broadcast_presence(&self) {
        let mut last = PRESENCE_LAST
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let since = last.map(|t| t.elapsed()).unwrap_or(Duration::MAX);
        if since >= PRESENCE_COALESCE {
            *last = Some(Instant::now());
            drop(last);
            self.broadcast_presence_now();
            return;
        }
        drop(last);
        // Inside the coalescing window — a trailing broadcast will cover
        // this change (and every other one that lands before it fires).
        PRESENCE_DIRTY.store(true, Ordering::Release);
        if PRESENCE_TRAILING.swap(true, Ordering::AcqRel) {
            return; // trailing broadcast already scheduled
        }
        let wait = PRESENCE_COALESCE.saturating_sub(since);
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                handle.spawn(async move {
                    tokio::time::sleep(wait).await;
                    PRESENCE_TRAILING.store(false, Ordering::Release);
                    if PRESENCE_DIRTY.swap(false, Ordering::AcqRel) {
                        let hub = call_hub();
                        let mut last = PRESENCE_LAST
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        *last = Some(Instant::now());
                        drop(last);
                        hub.broadcast_presence_now();
                    }
                });
            }
            Err(_) => {
                // No tokio runtime (sync tests / off-runtime callers) —
                // broadcast inline instead of arming a flag nothing will
                // ever consume (the "half-armed dirty flag": broadcasts
                // silently stop happening).
                PRESENCE_TRAILING.store(false, Ordering::Release);
                if PRESENCE_DIRTY.swap(false, Ordering::AcqRel) {
                    self.broadcast_presence_now();
                }
            }
        }
    }

    /// The actual fan-out (leading + trailing paths converge here).
    fn broadcast_presence_now(&self) {
        // CHAT-HUB FAN-OUT (production staleness bug): call events used
        // to update the shared presence registry + this hub's own
        // `presence` frames, but NEVER re-broadcast `staff_presence` on
        // the chat WS. The web admin chat roster + the mobile team
        // board listen on `/ws` — so an agent joining a call stayed
        // "available" there until some unrelated chat event happened.
        // One choke point covers every call-side presence change
        // (register, unregister, socket drop, answer → in_call).
        crate::ws::hub::hub().broadcast_staff_presence(None);
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
    /// O(agents) via the index, de-duped per user (a staff member on two
    /// devices is one name, not two).
    pub fn online_agent_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        for uid in self.agent_ids.iter() {
            if let Some(sids) = self.by_user.get(uid.key()) {
                if let Some(first) = sids.iter().next() {
                    if let Some(p) = self.peers.get(first) {
                        names.push(p.user.name.clone());
                    }
                }
            }
        }
        names
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

    /// Same as `pick_available_agent_id`, but never picks a member of
    /// `exclude` — the session manager passes the agents a call already
    /// rang (ring escalation) + agents currently ringing for someone
    /// else so one phone is never stacked with two callers.
    pub fn pick_available_agent_id_excluding(&self, exclude: &HashSet<String>) -> Option<String> {
        // Candidate = registered HERE as an agent + available in the
        // shared presence registry + not excluded. Ranked with the SAME
        // ordering the chat router uses (chat load → recency → employees
        // first). De-duped per user (a user on two devices is one agent).
        //
        // O(agents) straight off the `agent_ids` index: the previous full
        // peers scan allocated a fresh UUID String for EVERY session
        // (customers included) on every customer call attempt + every
        // presence broadcast (which also calls this to compute
        // `agentsAvailable`).
        let mut candidates: Vec<(String, crate::presence::StaffEntry)> = self
            .agent_ids
            .iter()
            .map(|uid| uid.key().clone())
            .filter(|uid| !exclude.contains(uid))
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

    /// Find any online agent's user id (busy or not). O(agents).
    pub fn any_online_agent_id(&self) -> Option<String> {
        self.agent_ids.iter().next().map(|uid| uid.key().clone())
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;
    use crate::auth::SessionUser;

    /// An upgrade that fails drops the callback holding the admission:
    /// its slots must come back, leaving no stale per-IP entry.
    #[test]
    fn a_dropped_admission_gives_its_slots_back() {
        let ip = "192.0.2.211";
        let slots = || {
            call_hub()
                .ip_conns
                .get(ip)
                .map(|n| n.load(Ordering::Acquire))
                .unwrap_or(0)
        };
        let admission = admit(ip).unwrap();
        assert_eq!(slots(), 1);
        drop(admission);
        assert_eq!(slots(), 0);
        assert!(call_hub().ip_conns.get(ip).is_none());
    }

    /// All these tests run against the SAME global singleton hub, and some
    /// make absolute assertions about global agent counts. Rust runs tests
    /// in parallel threads, so without serialisation they race each other
    /// (e.g. one test's live agent breaks another test's `count == 0`
    /// assertion). Locking this mutex at the top of each test serialises
    /// them without needing an external `serial_test` dependency.
    ///
    /// The lock is SHARED with the session + handler test modules via
    /// `crate::audio_call::TEST_LOCK` — private per-module locks used to
    /// let cross-module tests interleave on the same singletons.
    use crate::audio_call::TEST_LOCK;

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

    // ── admission caps (the /ws-call no-limits regression) ─────────

    /// Isolated hub (NOT the global singleton) with tight caps, so the
    /// assertions don't depend on whatever the other singleton tests did.
    fn capped_hub() -> CallHub {
        CallHub::with_limits(2, 2)
    }

    #[test]
    fn global_cap_rejects_beyond_limit() {
        let h = capped_hub();
        assert!(h.try_acquire_global(), "1st slot");
        assert!(h.try_acquire_global(), "2nd slot");
        assert!(
            !h.try_acquire_global(),
            "3rd socket must be rejected at the cap"
        );
        h.release_global();
        assert!(
            h.try_acquire_global(),
            "release must free the slot for the next socket"
        );
        assert_eq!(h.connection_count(), 2);
    }

    #[test]
    fn per_ip_cap_rejects_beyond_limit() {
        let h = capped_hub();
        let ip = "203.0.113.7";
        assert!(h.try_acquire_ip(ip), "1st socket from ip");
        assert!(h.try_acquire_ip(ip), "2nd socket from ip");
        assert!(
            !h.try_acquire_ip(ip),
            "3rd socket from the same ip must be rejected"
        );
        // A different IP is unaffected.
        assert!(h.try_acquire_ip("198.51.100.9"));
        // Releasing to zero REMOVES the map entry — ip_conns must not
        // accumulate one entry per IP ever seen.
        h.release_ip(ip);
        h.release_ip(ip);
        assert!(h.try_acquire_ip(ip), "released ip acquires again");
    }

    #[test]
    fn zero_global_cap_means_unlimited() {
        // Global cap 0 = unlimited. Per-IP caps are symmetric since the
        // caps became hardware-bounded (see `middleware::resource_guard`):
        // 0 = unlimited there too — this test pins the real-cap path (1).
        let h = CallHub::with_limits(0, 1);
        for _ in 0..100 {
            assert!(h.try_acquire_global(), "unlimited mode never rejects");
        }
        assert!(
            h.try_acquire_ip("192.0.2.1"),
            "first socket under per-ip cap 1"
        );
        assert!(
            !h.try_acquire_ip("192.0.2.1"),
            "per-ip cap 1 rejects the second socket"
        );
    }

    #[test]
    fn zero_per_ip_cap_means_unlimited() {
        // Per-IP cap 0 = disabled (the default): connections are still
        // counted per-IP for stats, the check just never denies.
        let h = CallHub::with_limits(0, 0);
        for _ in 0..100 {
            assert!(h.try_acquire_ip("203.0.113.7"), "cap 0 must never deny");
        }
        assert!(
            h.ip_conns.get("203.0.113.7").is_some(),
            "unlimited mode still counts per-IP for stats"
        );
    }

    #[test]
    fn release_without_acquire_clamps_at_zero() {
        // Defensive: a release path racing a missing acquire (or a test
        // that skips the acquire) must not underflow the counter.
        let h = capped_hub();
        h.release_global();
        assert_eq!(h.connection_count(), 0, "must clamp, not wrap");
        h.release_ip("192.0.2.50");
        assert!(h.try_acquire_ip("192.0.2.50"));
    }
}

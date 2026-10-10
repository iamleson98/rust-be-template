//! In-memory connection registry for the WebSocket chat.
//!
//! Built on [`DashMap`] for lock-free concurrent reads/writes — every
//! connected client is indexed by a `u64` socket id (atomic counter) so
//! lookups, room membership and presence broadcasts are all O(1).
//!
//! The hub is a process-local singleton (`OnceLock`); for horizontal
//! scaling behind multiple instances, swap this for a Redis Pub/Sub fan-out
//! (the `broadcast_to_room` call site is the only place that needs changing).

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use dashmap::{DashMap, DashSet};
use tokio::sync::mpsc;

use crate::auth::SessionUser;
use crate::presence::presence;

/// A connected client's outbound channel. We send **pre-serialised JSON
/// as `bytes::Bytes`** so a broadcast serialises once and shares the
/// underlying buffer via refcount (`Bytes::clone` is a single atomic
/// increment — zero per-recipient heap allocation or memcpy).
///
/// **Bounded** (capacity `ws_channel_capacity`, default 256) so a slow
/// consumer cannot grow the queue without bound. When the channel is full,
/// `try_send` fails and we drop the message; if the queue stays saturated
/// past `ws_slow_consumer_threshold`, the heartbeat sweep force-closes the
/// socket — protecting server memory under broadcast storms.
pub type ClientTx = mpsc::Sender<bytes::Bytes>;

/// Everything we need to know about a live socket.
pub struct Session {
    pub user: SessionUser,
    pub channel_id: Option<String>,
    pub tx: ClientTx,
    /// IP for per-IP accounting (released on disconnect).
    pub ip: String,
    /// Dropped-delivery counter for the slow-consumer reaper: incremented
    /// every time a broadcast `try_send` hits a FULL queue. Reset every
    /// 60 s window; ≥ `slow_consumer_threshold` drops in one window → the
    /// reaper sends a close sentinel (see `reap_slow_consumers`).
    pub dropped: AtomicUsize,
    /// Start of the current 60 s accounting window for `dropped`.
    dropped_window: Instant,
    /// Best-effort priority close channel (the handler's `close_tx`): a
    /// dedicated 1-slot channel so the reaper can close a socket EVEN
    /// when the bounded outbound queue is completely full (an empty-Bytes
    /// sentinel could not be queued then). `None` for sessions registered
    /// without one (tests).
    close: Option<mpsc::Sender<()>>,
}

/// A newly registered socket.
pub struct Registered {
    pub id: u64,
    /// `Some(seq)` when this is the user's first socket: they just came online.
    pub online_seq: Option<u64>,
}

/// A socket that just closed.
pub struct Departed {
    pub user: SessionUser,
    /// The room it was in.
    pub channel_id: Option<String>,
    /// `Some(seq)` when this was the user's last socket: they just went offline.
    pub offline_seq: Option<u64>,
}

/// The shared chat hub. Cheap to clone (`&'static` via [`hub()`]).
///
/// Staff presence (online / busy / load) lives in [`crate::presence`] —
/// the hub no longer keeps its own employee index.
pub struct ChatHub {
    sessions: DashMap<u64, Session>,
    rooms: DashMap<String, DashSet<u64>>,
    /// `userId → socket ids` — the routing index. Every user-targeted
    /// fan-out (`send_to_user`, `sockets_of_user`) used to scan ALL
    /// sessions and `to_string()` every UUID per candidate — O(N) per
    /// message on the hot chat-send path.
    by_user: DashMap<String, DashSet<u64>>,
    /// `userId → socket ids` for STAFF sockets (employees + admins).
    /// `broadcast_to_staff_raw` used to filter the full session map per
    /// call; with thousands of customers online that turned every
    /// staff-presence change into an O(N) scan.
    staff_sockets: DashMap<String, DashSet<u64>>,
    /// `userId → socket ids` for ADMIN sockets — same story for
    /// `broadcast_to_admins`.
    admin_sockets: DashMap<String, DashSet<u64>>,
    ip_conns: DashMap<String, std::sync::atomic::AtomicUsize>,
    idempotency: DashMap<String, (Instant, Option<String>)>, // (stored_at, value)
    next_id: std::sync::atomic::AtomicU64,
    /// Bumped on every online/offline transition of a user (first socket
    /// opened, last socket closed). Presence events carry it so clients
    /// apply them in order — a page refresh closes one socket and opens
    /// another within milliseconds, and the two events may arrive swapped.
    presence_seq: AtomicU64,
    /// Total live sessions across all IPs (atomic for O(1) admission checks).
    global_conns: AtomicUsize,
    /// Hard cap on `global_conns` (read once at init from config; 0 = unlimited).
    max_global_conns: usize,
    /// Slow-consumer reaping threshold for the 60 s window (0 = disabled).
    /// Wired from `WS_SLOW_CONSUMER_THRESHOLD` via `init_with_config`.
    slow_consumer_threshold: usize,
    /// Cumulative count of sockets reaped for slow consuming (exposed in
    /// `stats()` — a non-zero, growing number is the ops signal that
    /// clients are not draining their queues fast enough).
    slow_reaped: AtomicU64,
    /// Cache of "channel_id exists" lookups — short-circuits the
    /// `SELECT * FROM ChatChannel WHERE id = ?` on every `join`.
    /// Maps `channel_id → inserted_at`; entries older than
    /// `channel_cache_ttl` are treated as misses (and purged by `idem_gc`).
    channel_exists_cache: DashMap<String, Instant>,
    /// TTL for `channel_exists_cache` entries.
    channel_cache_ttl: Duration,
}

static HUB: OnceLock<ChatHub> = OnceLock::new();
static HUB_CFG: OnceLock<(usize, u64, usize)> = OnceLock::new();

/// Process-global hub accessor (lazily initialised on first call).
///
/// If `init_with_config` was called BEFORE the first `hub()` call (the
/// normal boot order in `server.rs::bootstrap`), the configured
/// `WsConfig.max_connections` is used. Otherwise the hardcoded fallback
/// (50_000 connections, 60s channel-cache TTL, 128-msg slow-consumer
/// threshold) applies — useful for tests that don't go through the full
/// bootstrap.
pub fn hub() -> &'static ChatHub {
    HUB.get_or_init(|| {
        let (max, ttl, slow) = *HUB_CFG.get().unwrap_or(&(50_000, 60, 128));
        ChatHub::with_limits(max, ttl, slow)
    })
}

/// Why [`admit`] turned a socket away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// `WS_MAX_CONNECTIONS` chat sockets are open.
    Full,
    /// `WS_MAX_PER_IP` chat sockets are open from this address.
    IpFull,
}

/// The connection slots (global + per-IP) a chat socket holds until its
/// session is registered — from then on `unregister` gives them back.
/// Dropping an `Admission` that never became a session releases them, so
/// an HTTP upgrade that fails (axum drops the callback holding this
/// without running the socket task) no longer leaks its slots.
#[must_use = "dropping an Admission gives its slots back"]
#[derive(Debug)]
pub struct Admission {
    ip: Option<String>,
}

impl Admission {
    /// Hand the slots to the session being registered for this socket;
    /// returns the IP whose slot `unregister` will release.
    pub(crate) fn into_session(mut self) -> String {
        self.ip.take().unwrap_or_default()
    }
}

impl Drop for Admission {
    fn drop(&mut self) {
        if let Some(ip) = self.ip.take() {
            hub().release_ip(&ip);
            hub().release_global();
        }
    }
}

/// Take a global and a per-IP slot for a socket from `ip` (global first:
/// the cheapest refusal), or neither.
pub fn admit(ip: &str, max_per_ip: usize) -> Result<Admission, Refusal> {
    let hub = hub();
    if !hub.try_acquire_global() {
        return Err(Refusal::Full);
    }
    if !hub.try_acquire_ip(ip, max_per_ip) {
        hub.release_global();
        return Err(Refusal::IpFull);
    }
    Ok(Admission {
        ip: Some(ip.to_string()),
    })
}

/// Initialise the hub with config-derived limits. MUST be called before
/// the first `hub()` call (which happens on the first WS upgrade). Safe
/// to call multiple times — second call is a no-op (the config is locked
/// in `OnceLock`).
///
/// Wires `WsConfig.max_connections` (env-driven) into the hub — previously
/// the hub was hardcoded to 50_000 and an operator setting
/// `WS__MAX_CONNECTIONS=10000` to match a memory-constrained deploy had no
/// effect on the actual cap.
pub fn init_with_config(
    max_global: usize,
    channel_cache_ttl_sec: u64,
    slow_consumer_threshold: usize,
) {
    let _ = HUB_CFG.set((max_global, channel_cache_ttl_sec, slow_consumer_threshold));
}

impl ChatHub {
    /// Construct with explicit global-connection cap, channel-cache TTL
    /// and slow-consumer threshold. Called from `hub()` (defaults) and
    /// from tests that want isolated limits.
    pub fn with_limits(
        max_global: usize,
        channel_cache_ttl_sec: u64,
        slow_consumer_threshold: usize,
    ) -> Self {
        Self {
            sessions: DashMap::new(),
            rooms: DashMap::new(),
            by_user: DashMap::new(),
            staff_sockets: DashMap::new(),
            admin_sockets: DashMap::new(),
            ip_conns: DashMap::new(),
            idempotency: DashMap::new(),
            next_id: std::sync::atomic::AtomicU64::new(1),
            presence_seq: AtomicU64::new(0),
            global_conns: AtomicUsize::new(0),
            max_global_conns: max_global,
            slow_consumer_threshold,
            slow_reaped: AtomicU64::new(0),
            channel_exists_cache: DashMap::new(),
            channel_cache_ttl: Duration::from_secs(channel_cache_ttl_sec.max(1)),
        }
    }

    // ── global connection admission ───────────────────────────

    /// Atomically try to acquire a GLOBAL connection slot. Returns `false`
    /// if the server-wide cap is exceeded (caller should reject the upgrade
    /// with a 1013 close code so the client backs off).
    pub fn try_acquire_global(&self) -> bool {
        if self.max_global_conns == 0 {
            // Unlimited mode — just count.
            self.global_conns.fetch_add(1, Ordering::AcqRel);
            return true;
        }
        // CAS loop: only increment if below cap.
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

    /// Release a global connection slot (called on disconnect).
    pub fn release_global(&self) {
        // Saturating at 0 in one atomic step (acquire/release are balanced,
        // but a double release must neither wrap to usize::MAX for another
        // thread to see nor, by "undoing" it, erase a concurrent acquire).
        super::saturating_decrement(&self.global_conns);
    }

    /// Current live session count (O(1) atomic read).
    pub fn connection_count(&self) -> usize {
        self.global_conns.load(Ordering::Acquire)
    }

    /// Configured global cap (0 = unlimited).
    pub fn max_connections(&self) -> usize {
        self.max_global_conns
    }

    /// Atomically try to acquire a connection slot for `ip`.
    /// Returns `false` if the per-IP cap is exceeded.
    ///
    /// `cap == 0` means UNLIMITED (the default since the caps became
    /// hardware-bounded — see `middleware::resource_guard`): the connection
    /// is still counted per-IP (the map feeds `distinct_ips` stats), it
    /// just never denies.
    /// NOTE: this does NOT touch the global counter — call `try_acquire_global`
    /// first, then `try_acquire_ip`, and roll back the global acquire if the
    /// IP check fails.
    pub fn try_acquire_ip(&self, ip: &str, cap: usize) -> bool {
        use std::sync::atomic::Ordering;
        let entry = self.ip_conns.entry(ip.to_string()).or_default();
        // CAS loop: only increment if below cap.
        loop {
            let cur = entry.load(Ordering::Acquire);
            if cap > 0 && cur >= cap {
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

    /// Release a connection slot for `ip` (called on disconnect).
    pub fn release_ip(&self, ip: &str) {
        use std::sync::atomic::Ordering;
        if let Some(entry) = self.ip_conns.get(ip) {
            // Saturating, like `release_global`: an extra release leaves 0.
            let prev = super::saturating_decrement(&entry);
            let hit_zero = prev <= 1;
            drop(entry);
            if hit_zero {
                // `remove_if` re-checks emptiness under the shard write
                // lock. The previous unconditional `remove(ip)` raced a
                // concurrent `try_acquire_ip`: T2 grabs the same entry's
                // read guard, CASes 0 → 1 (its slot!), and T1's remove
                // then DELETES that entry — T2's slot evaporates (the
                // next acquire sees a fresh 0-entry and the per-IP cap
                // silently erodes; `distinct_ips` undercounts too).
                // `remove_if(v == 0)` either sees T2's 1 and keeps the
                // entry, or removes before T2 lands (T2 then re-creates
                // via `entry().or_default()`) — both orderings correct.
                self.ip_conns
                    .remove_if(ip, |_, v| v.load(Ordering::Acquire) == 0);
            }
        }
    }

    /// Register a new connection.
    /// Precondition: the caller has ALREADY acquired a global slot via
    /// `try_acquire_global` and a per-IP slot via `try_acquire_ip`.
    /// `unregister` releases both.
    pub fn register(&self, user: SessionUser, ip: String, tx: ClientTx) -> Registered {
        use std::sync::atomic::Ordering;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let user_id = user.id.to_string();
        let is_staff = user.is_staff();
        let is_admin = user.is_admin();
        self.sessions.insert(
            id,
            Session {
                user,
                channel_id: None,
                tx,
                ip,
                dropped: AtomicUsize::new(0),
                dropped_window: Instant::now(),
                close: None,
            },
        );
        // Maintain the routing indexes (lock-step with `unregister`):
        // user-targeted + staff/admin fan-outs become O(recipients)
        // instead of O(all sessions) — with a UUID `to_string()` per
        // scanned session on the old path.
        // The entry guard holds the shard lock, so "first socket" and its
        // sequence number are decided atomically with `unregister`'s
        // "last socket".
        let online_seq = {
            let set = self.by_user.entry(user_id.clone()).or_default();
            set.insert(id);
            (set.len() == 1).then(|| self.presence_seq.fetch_add(1, Ordering::AcqRel) + 1)
        };
        if is_staff {
            self.staff_sockets
                .entry(user_id.clone())
                .or_default()
                .insert(id);
        }
        if is_admin {
            self.admin_sockets.entry(user_id).or_default().insert(id);
        }
        Registered { id, online_seq }
    }

    /// Attach a priority close channel to a session (the handler's
    /// `close_tx`, cloned before the write pump takes ownership of the
    /// original). Enables the slow-consumer reaper to close a socket even
    /// when its outbound queue is completely full. Called right after
    /// `register` in `handle_socket`; a no-op for unknown/already-closed
    /// sessions.
    pub fn set_closer(&self, id: u64, close: mpsc::Sender<()>) {
        if let Some(mut sess) = self.sessions.get_mut(&id) {
            if sess.close.is_none() {
                sess.close = Some(close);
            }
        }
    }

    /// Tear down a connection: leave any joined room, remove the staff
    /// presence socket, release the IP slot, release the global slot,
    /// and drop the session. Returns who left, from which room, and
    /// whether that was their last socket, so the caller can broadcast
    /// the right presence updates.
    pub fn unregister(&self, id: u64) -> Option<Departed> {
        let (_, sess) = self.sessions.remove(&id)?;
        // Leave the current channel room (presence broadcast is done by caller).
        if let Some(cid) = &sess.channel_id {
            self.leave_room(cid, id);
        }
        // Maintain the routing indexes (lock-step with `register`):
        // drop this sid from the user/staff/admin sets and reclaim the
        // index entries when they go empty (an empty DashSet per user ever
        // seen would be the same permanent-RSS leak `leave_room` fixed for
        // rooms).
        let user_id = sess.user.id.to_string();
        let offline_seq = self.drop_user_socket(&user_id, id);
        if sess.user.is_staff() {
            self.drop_index(&self.staff_sockets, &user_id, id);
        }
        if sess.user.is_admin() {
            self.drop_index(&self.admin_sockets, &user_id, id);
        }
        // Remove the presence socket (whole entry drops when the staff
        // member's last socket of either family goes away).
        if sess.user.is_staff() {
            presence().chat_socket_disconnected(&sess.user.id.to_string(), id);
        }
        self.release_ip(&sess.ip);
        self.release_global();
        Some(Departed {
            user: sess.user,
            channel_id: sess.channel_id,
            offline_seq,
        })
    }

    /// Drop `id` from the user's socket set under the shard write lock,
    /// so "last socket" and its sequence number are decided atomically
    /// with `register`'s "first socket". Returns the sequence number when
    /// the user just went offline.
    fn drop_user_socket(&self, user_id: &str, id: u64) -> Option<u64> {
        let offline_seq = {
            let set = self.by_user.get_mut(user_id)?;
            set.remove(&id);
            set.is_empty()
                .then(|| self.presence_seq.fetch_add(1, Ordering::AcqRel) + 1)
        };
        if offline_seq.is_some() {
            self.by_user.remove_if(user_id, |_, s| s.is_empty());
        }
        offline_seq
    }

    /// Customers (not staff) online right now, with the presence sequence
    /// number the list is at least as new as. The number is read first, so
    /// any transition the list misses carries a higher one and still gets
    /// applied by clients.
    pub fn online_customers(&self) -> (u64, Vec<String>) {
        let seq = self.presence_seq.load(Ordering::Acquire);
        let users = self
            .by_user
            .iter()
            // A set can sit empty for an instant between its last socket
            // leaving and the entry being reclaimed.
            .filter(|e| !e.value().is_empty() && !self.staff_sockets.contains_key(e.key()))
            .map(|e| e.key().clone())
            .collect();
        (seq, users)
    }

    /// Detach a socket from its room (the customer closed the support
    /// panel but stays signed in). Returns the room it left.
    pub fn clear_channel(&self, id: u64) -> Option<String> {
        let prev = self.sessions.get_mut(&id)?.channel_id.take();
        if let Some(prev) = &prev {
            self.leave_room(prev, id);
        }
        prev
    }

    /// Remove `id` from `index[user_id]`'s set and reclaim the whole
    /// index entry when it goes empty. Shared by the three routing
    /// indexes (DashMap shards differ per map, so passing the map as an
    /// argument keeps one implementation).
    fn drop_index(&self, index: &DashMap<String, DashSet<u64>>, user_id: &str, id: u64) {
        if let Some(set) = index.get(user_id) {
            set.remove(&id);
            let now_empty = set.is_empty();
            drop(set);
            if now_empty {
                index.remove_if(user_id, |_, s| s.is_empty());
            }
        }
    }

    /// Attach (or re-attach) a socket to a channel room, leaving the previous
    /// room first. Returns the previous channel id (if any).
    pub fn set_channel(&self, id: u64, new_channel: String) -> Option<String> {
        let mut sess = self.sessions.get_mut(&id)?;
        let prev = sess.channel_id.replace(new_channel);
        drop(sess);
        if let Some(prev) = &prev {
            self.leave_room(prev, id);
        }
        prev
    }

    pub fn join_room(&self, channel_id: &str, id: u64) {
        self.rooms
            .entry(channel_id.to_string())
            .or_default()
            .insert(id);
    }

    pub fn leave_room(&self, channel_id: &str, id: u64) {
        if let Some(set) = self.rooms.get(channel_id) {
            set.remove(&id);
        }
        // Drop the read guard BEFORE touching the map again (the
        // idem_gc deadlock discipline: never hold one `rooms` guard
        // across another `rooms` operation). Then reclaim the entry
        // when the room went empty: without this, every channel id
        // ever joined leaves a `String → empty DashSet` entry in the
        // map FOREVER — thousands of support channels later that is
        // an unbounded, permanent RSS leak (`stats().rooms` reported
        // the inflated count too).
        //
        // `remove_if` re-checks emptiness under the write lock, so a
        // concurrent `join_room` for the same channel that lands
        // between our remove and this call simply keeps the entry
        // alive (or re-creates it in `join_room`'s `entry` call) —
        // membership, not entry lifetime, is what correctness needs.
        self.rooms.remove_if(channel_id, |_, s| s.is_empty());
    }

    /// Push a pre-serialised JSON string to every socket in a room.
    /// Serialisation is done once by the caller; we only clone the `String`.
    /// Uses **non-blocking `try_send`** so a single slow consumer cannot stall
    /// the broadcast for everyone else — a full channel drops the message
    /// (and counts it on the session's slow-consumer meter; the reaper
    /// sweep force-closes the socket once the 60 s threshold is exceeded).
    ///
    /// Returns the number of recipients the message was delivered to.
    pub fn broadcast_to_room_raw(&self, channel_id: &str, payload: &str) -> usize {
        // Pre-serialise once; `Bytes::clone()` per recipient is just an
        // atomic refcount bump — no heap allocation, no memcpy.
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        self.broadcast_bytes_to_room(channel_id, &bytes)
    }

    /// Shared-`Bytes` fan-out core (the payload buffer is refcounted by
    /// every recipient — one allocation total per broadcast).
    fn broadcast_bytes_to_room(&self, channel_id: &str, bytes: &bytes::Bytes) -> usize {
        let mut delivered = 0;
        if let Some(set) = self.rooms.get(channel_id) {
            for sid in set.iter() {
                if let Some(sess) = self.sessions.get(&sid) {
                    // try_send: non-blocking. On Full, drop the message +
                    // count it (slow-consumer meter). On Closed, the read
                    // loop will reap it.
                    match sess.tx.try_send(bytes.clone()) {
                        Ok(()) => delivered += 1,
                        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                            sess.dropped.fetch_add(1, Ordering::Relaxed);
                        }
                        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {}
                    }
                }
            }
        }
        delivered
    }

    /// Convenience: serialise a `serde_json::Value` once and fan-out.
    pub fn broadcast_to_room(&self, channel_id: &str, msg: &serde_json::Value) {
        let payload = serde_json::to_string(msg).unwrap_or_default();
        self.broadcast_to_room_raw(channel_id, &payload);
    }

    /// Push a message to every socket in a room **except** `except_id`.
    /// Non-blocking: slow consumers are skipped (their queue stays bounded).
    pub fn broadcast_to_room_except(
        &self,
        channel_id: &str,
        msg: &serde_json::Value,
        except_id: u64,
    ) {
        let payload = serde_json::to_string(msg).unwrap_or_default();
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        if let Some(set) = self.rooms.get(channel_id) {
            for sid in set.iter() {
                if *sid == except_id {
                    continue;
                }
                if let Some(sess) = self.sessions.get(&sid) {
                    self.try_send_counted(&sess, bytes.clone());
                }
            }
        }
    }

    /// Push an already-serialised payload to every socket in a room
    /// **except** `except_id`, sharing ONE `Bytes` allocation across all
    /// recipients (serialise once at the call site). Slow consumers are
    /// counted, never blocked. Used by the chat-message hot path, where
    /// the same broadcast also feeds a `send_to_user` targeted copy —
    /// one serialisation, zero per-recipient allocation.
    pub fn broadcast_to_room_except_bytes(
        &self,
        channel_id: &str,
        bytes: &bytes::Bytes,
        except_id: u64,
    ) {
        if let Some(set) = self.rooms.get(channel_id) {
            for sid in set.iter() {
                if *sid == except_id {
                    continue;
                }
                if let Some(sess) = self.sessions.get(&sid) {
                    self.try_send_counted(&sess, bytes.clone());
                }
            }
        }
    }

    /// `try_send` + slow-consumer accounting (shared by every fan-out
    /// path — a Full queue is the one signal the reaper acts on).
    fn try_send_counted(&self, sess: &Session, bytes: bytes::Bytes) -> bool {
        match sess.tx.try_send(bytes) {
            Ok(()) => true,
            Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                sess.dropped.fetch_add(1, Ordering::Relaxed);
                false
            }
            Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => false,
        }
    }

    /// Send to a single socket. Non-blocking; a full queue drops the message
    /// (the client will eventually be reaped by the heartbeat sweep).
    pub fn send_to(&self, id: u64, msg: &serde_json::Value) {
        if let Some(sess) = self.sessions.get(&id) {
            if let Ok(s) = serde_json::to_string(msg) {
                let _ = sess.tx.try_send(bytes::Bytes::from(s));
            }
        }
    }

    /// Broadcast a raw pre-serialised payload to EVERY live socket. Used by
    /// the graceful-shutdown path to deliver a `system:shutdown` notice.
    pub fn broadcast_all(&self, payload: &str) {
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        for entry in self.sessions.iter() {
            self.try_send_counted(entry.value(), bytes.clone());
        }
    }

    /// Broadcast a JSON message to ALL online STAFF sockets (employees
    /// AND admins, across every brand). Used for:
    ///   - the "new message arrived in another channel" attention signal,
    ///   - `staff_presence` fan-out when availability changes.
    ///
    /// Routes through the `staff_sockets` index — O(staff) instead of the
    /// previous O(all sessions) filter scan. Each socket gets one delivery
    /// (multiple tabs = multiple deliveries, intentional so every tab
    /// updates its UI).
    pub fn broadcast_to_staff(&self, msg: &serde_json::Value) {
        let payload = serde_json::to_string(msg).unwrap_or_default();
        self.broadcast_to_staff_raw(&payload);
    }

    /// Raw-payload variant of `broadcast_to_staff` (payload is
    /// pre-serialised by the caller).
    pub fn broadcast_to_staff_raw(&self, payload: &str) {
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        self.fanout_indexed(&self.staff_sockets, &bytes);
    }

    /// Send a JSON message to EVERY live socket of one user (all their
    /// tabs). Used for targeted routing — e.g. a new message in a
    /// channel assigned to employee X goes to X's sockets, not to all
    /// staff. Returns the number of sockets it was queued to.
    ///
    /// Routes through the `by_user` index — O(the user's sockets)
    /// instead of the previous O(all sessions) scan with a UUID
    /// `to_string()` per candidate (that allocation-per-candidate was
    /// the chat hot path's hidden cost at every send).
    pub fn send_to_user(&self, user_id: &str, msg: &serde_json::Value) -> usize {
        let payload = serde_json::to_string(msg).unwrap_or_default();
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        self.fanout_user(user_id, &bytes)
    }

    /// Shared fan-out over one of the routing indexes. Returns the number
    /// of sockets the payload was queued to.
    fn fanout_indexed(&self, index: &DashMap<String, DashSet<u64>>, bytes: &bytes::Bytes) -> usize {
        let mut delivered = 0;
        for entry in index.iter() {
            for sid in entry.value().iter() {
                if let Some(sess) = self.sessions.get(&sid) {
                    if self.try_send_counted(&sess, bytes.clone()) {
                        delivered += 1;
                    }
                }
            }
        }
        delivered
    }

    /// Send an already-serialised payload to every socket of one user
    /// (see [`Self::send_to_user`] — this variant shares ONE `Bytes`
    /// allocation with other fan-outs in the same send path).
    pub fn send_to_user_bytes(&self, user_id: &str, bytes: &bytes::Bytes) -> usize {
        self.fanout_user(user_id, bytes)
    }

    /// Broadcast an already-serialised payload to every ADMIN socket,
    /// sharing ONE `Bytes` allocation with other fan-outs in the same
    /// send path (the `channel_message` notify goes to BOTH the assignee
    /// and the admins — serialise once, refcount everywhere).
    pub fn broadcast_to_admins_bytes(&self, bytes: &bytes::Bytes) {
        self.fanout_indexed(&self.admin_sockets, bytes);
    }

    /// Shared fan-out to one user's sockets via the `by_user` index.
    fn fanout_user(&self, user_id: &str, bytes: &bytes::Bytes) -> usize {
        let mut delivered = 0;
        if let Some(set) = self.by_user.get(user_id) {
            for sid in set.iter() {
                if let Some(sess) = self.sessions.get(&sid) {
                    if self.try_send_counted(&sess, bytes.clone()) {
                        delivered += 1;
                    }
                }
            }
        }
        delivered
    }

    /// Send a JSON message to every live ADMIN socket (regardless of
    /// brand). Admins monitor the whole support queue, so they keep
    /// receiving channel notifications even for channels assigned to
    /// a specific employee.
    ///
    /// Routes through the `admin_sockets` index — O(admins).
    pub fn broadcast_to_admins(&self, msg: &serde_json::Value) {
        let payload = serde_json::to_string(msg).unwrap_or_default();
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        self.fanout_indexed(&self.admin_sockets, &bytes);
    }

    /// Collect the socket ids of a user's live sessions (used for
    /// targeted sends from the assignment logic).
    pub fn sockets_of_user(&self, user_id: &str) -> Vec<u64> {
        self.by_user
            .get(user_id)
            .map(|set| set.iter().map(|sid| *sid).collect())
            .unwrap_or_default()
    }

    /// Request every live socket to close. The actual close happens when
    /// each socket's write pump drains (see `handler::drain_all_connections`).
    pub fn close_all(&self) {
        for entry in self.sessions.iter() {
            // A close sentinel is sent by pushing an empty payload; the
            // write pump treats an empty Bytes as a close trigger.
            let _ = entry.tx.try_send(bytes::Bytes::new());
        }
    }

    /// Check whether any other socket for the same user is still in `channel_id`.
    pub fn user_still_in_room(&self, channel_id: &str, user_id: &str, except: u64) -> bool {
        if let Some(set) = self.rooms.get(channel_id) {
            for sid in set.iter() {
                if *sid == except {
                    continue;
                }
                if let Some(sess) = self.sessions.get(&sid) {
                    if sess.user.id.to_string() == user_id {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Check whether a specific user has at least one live socket joined
    /// to `channel_id`. Used by the NullClaw trigger to decide whether
    /// the customer is still waiting on the chat (typing indicator
    /// makes sense) or has navigated away (skip the AI reply).
    pub fn is_user_online_in_channel(&self, channel_id: &str, user_id: &str) -> bool {
        if let Some(set) = self.rooms.get(channel_id) {
            for sid in set.iter() {
                if let Some(sess) = self.sessions.get(&sid) {
                    if sess.user.id.to_string() == user_id && sess.user.actor_type == "user" {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Get a snapshot of the user for a socket (clones the SessionUser).
    pub fn user_of(&self, id: u64) -> Option<SessionUser> {
        self.sessions.get(&id).map(|s| s.user.clone())
    }

    /// Which channel is this socket currently joined to?
    pub fn channel_of(&self, id: u64) -> Option<String> {
        self.sessions.get(&id).and_then(|s| s.channel_id.clone())
    }

    /// What IP did this socket connect from? Used by the abuse guard
    /// to attribute violations to the source IP (so a banned user can't
    /// dodge the ban by re-registering a new account from the same IP).
    pub fn session_ip(&self, id: u64) -> Option<String> {
        self.sessions.get(&id).map(|s| s.ip.clone())
    }

    // ── staff presence (delegates to crate::presence) ─────────

    /// Count online staff (employees + admins) for a brand scope.
    pub fn count_online_staff(&self, brand_id: Option<&str>) -> usize {
        presence().online_count(brand_id)
    }

    /// Broadcast the current staff-presence snapshot to every STAFF
    /// socket in brand scope. Called whenever availability changes
    /// (staff connect/disconnect, call start/end, assignment change) so
    /// dashboards + routing UIs stay live.
    pub fn broadcast_staff_presence(&self, brand_id: Option<&str>) {
        self.broadcast_to_staff(&presence().staff_json(brand_id));
    }

    // ── idempotency (clientMsgId → stored message id) ─────────
    //
    // We use `dashmap::DashMap::entry()` for atomic check-and-insert —
    // closing the TOCTOU window of the previous `contains_key` + `insert`
    // pair (two concurrent sends with the same `clientMsgId` both used to
    // claim and both proceeded to insert a message row).
    // A separate background `idem_gc` task periodically drops entries older
    // than `IDEM_TTL` (5 min) so the map can't grow unbounded.

    /// TTL for idempotency entries — a `clientMsgId` older than this is
    /// treated as "fresh" again (covers the case where a client retries
    /// after a long delay).
    const IDEM_TTL: Duration = Duration::from_secs(5 * 60);

    /// Try to claim a `clientMsgId`. Returns:
    /// - `Some(Some(msg_id))` if this id was already stored → replay that message
    /// - `Some(None)` if it's in-flight (claimed but not yet stored) → drop duplicate
    /// - `None` if this is a fresh claim (caller should proceed + call `idem_store`)
    pub fn idem_claim(&self, client_msg_id: &str) -> Option<Option<String>> {
        use dashmap::mapref::entry::Entry;
        match self.idempotency.entry(client_msg_id.to_string()) {
            Entry::Occupied(mut e) => {
                // Already claimed/stored — check TTL.
                let (stored_at, val) = e.get().clone();
                if stored_at.elapsed() > Self::IDEM_TTL {
                    // Stale — overwrite IN PLACE, still holding the shard
                    // write lock. The previous drop(e) + insert() pair
                    // released the lock in between: a concurrent fresh
                    // claim landing in that gap got silently clobbered by
                    // our insert, and BOTH senders then proceeded to
                    // insert the message row (the exact duplicate the
                    // idempotency map exists to prevent).
                    e.insert((Instant::now(), None));
                    None
                } else {
                    Some(val)
                }
            }
            Entry::Vacant(v) => {
                v.insert((Instant::now(), None));
                None
            }
        }
    }

    /// Record the final message id for a previously-claimed `clientMsgId`.
    pub fn idem_store(&self, client_msg_id: &str, msg_id: &str) {
        self.idempotency.insert(
            client_msg_id.to_string(),
            (Instant::now(), Some(msg_id.to_string())),
        );
    }

    /// Garbage-collect idempotency entries older than `IDEM_TTL`.
    /// Runs every 60s from a background task.
    ///
    /// Uses `DashMap::retain`, which takes each shard's write lock once and
    /// erases expired buckets in place. **Never** do `remove()` while
    /// holding an `iter()` guard on the same map: `Iter` keeps the current
    /// shard's read lock alive across the loop body, so a `remove()` inside
    /// the loop blocks the same thread forever (write waits on the read lock
    /// that only this thread can release). That self-deadlock took down the
    /// whole runtime in production (2026-09-10 "dies after a call"
    /// incidents): the GC task blocked its worker thread, that worker was
    /// the one holding the tokio I/O driver, and without `tokio_unstable`
    /// eager driver handoff no other worker ever polled epoll again —
    /// `/health` stopped answering and Swarm killed the container.
    pub fn idem_gc(&self) {
        let now = Instant::now();
        let before = self.idempotency.len();
        self.idempotency
            .retain(|_, (stored_at, _)| now.duration_since(*stored_at) <= Self::IDEM_TTL);
        let removed = before - self.idempotency.len();
        if removed > 0 {
            tracing::debug!(
                removed,
                remaining = self.idempotency.len(),
                "idem_gc swept expired entries"
            );
        }
    }

    // ── channel-exists cache (short-circuits DB SELECT on join) ──

    /// Record that `channel_id` exists (negative results are NOT cached —
    /// a later insert would be invisible until TTL expiry).
    pub fn cache_channel_exists(&self, channel_id: &str) {
        self.channel_exists_cache
            .insert(channel_id.to_string(), Instant::now());
    }

    /// Returns `true` if the channel is cached as existing AND the entry is
    /// still within its TTL. Expired entries are lazily purged on access.
    pub fn channel_exists_cached(&self, channel_id: &str) -> bool {
        if let Some(entry) = self.channel_exists_cache.get(channel_id) {
            if entry.elapsed() < self.channel_cache_ttl {
                return true;
            }
            // Expired — drop the entry (drop the guard first to avoid a
            // deadlock with DashMap's shard lock during remove).
            drop(entry);
            self.channel_exists_cache.remove(channel_id);
        }
        false
    }

    /// Purge expired channel-cache entries. Called from the idem_gc sweep.
    ///
    /// Same `retain` discipline as `idem_gc` — never `remove()` under an
    /// `iter()` guard on the same map (self-deadlock; see `idem_gc`).
    pub fn channel_cache_gc(&self) {
        let now = Instant::now();
        let ttl = self.channel_cache_ttl;
        let before = self.channel_exists_cache.len();
        self.channel_exists_cache
            .retain(|_, stored_at| now.duration_since(*stored_at) < ttl);
        let purged = before - self.channel_exists_cache.len();
        if purged > 0 {
            tracing::debug!(
                purged,
                remaining = self.channel_exists_cache.len(),
                "channel-exists cache GC"
            );
        }
    }

    // ── slow-consumer reaping ────────────────────────────

    /// Length of one slow-consumer accounting window.
    const SLOW_WINDOW: Duration = Duration::from_secs(60);

    /// Force-close sockets whose outbound queue dropped ≥ `threshold`
    /// messages within the last 60 s window. Runs from the supervised
    /// `idem_gc` tick (every 60 s).
    ///
    /// This is the reaper the bounded-queue design always promised but
    /// never shipped: `try_send`-on-Full drops messages but nothing ever
    /// acted on the count, so a live-but-never-reading client (throttled
    /// mobile WebView, backgrounded tab under GC pressure) pinned its
    /// full 256-message queue + write-pump task + hub session in RAM
    /// for the socket's whole (heartbeat-answered) lifetime.
    ///
    /// Closing goes through the NORMAL teardown path — the write pump
    /// gets a Close frame out, the read loop observes the socket close,
    /// and `handle_socket` unregisters the session (rooms, presence,
    /// per-IP + global slots all released). Returns the number of sockets
    /// reaped; also bumps the cumulative `stats().slow_consumers_reaped`
    /// counter.
    pub fn reap_slow_consumers(&self) -> usize {
        let threshold = self.slow_consumer_threshold;
        if threshold == 0 {
            return 0; // disabled via WS_SLOW_CONSUMER_THRESHOLD=0
        }
        let now = Instant::now();
        // First pass under one iter_mut: collect victims + roll windows.
        // (Victim actions happen AFTER the loop — never call back into
        // `sessions` while an iter_mut guard is live on it.)
        let mut victims: Vec<(u64, usize, Option<mpsc::Sender<()>>, ClientTx)> = Vec::new();
        for mut entry in self.sessions.iter_mut() {
            let dropped = entry.dropped.load(Ordering::Acquire);
            if now.duration_since(entry.dropped_window) >= Self::SLOW_WINDOW {
                // Window rolled — reset the meter (a slow consumer from
                // the PREVIOUS window starts fresh in this one).
                entry.dropped.store(0, Ordering::Release);
                entry.dropped_window = now;
            } else if dropped >= threshold {
                victims.push((*entry.key(), dropped, entry.close.clone(), entry.tx.clone()));
            }
        }
        let mut reaped = 0;
        for (sid, dropped, closer, tx) in victims {
            // Prefer the dedicated close channel (works even when the
            // outbound queue is full — the reaping condition itself);
            // fall back to the empty-Bytes sentinel (tests register
            // without a closer).
            let sentinel_queued = match closer {
                Some(c) => c.try_send(()).is_ok(),
                None => tx.try_send(bytes::Bytes::new()).is_ok(),
            };
            // Reset the meter so we don't re-log the same victim every
            // sweep while teardown lands (and retry later if it couldn't).
            if let Some(mut sess) = self.sessions.get_mut(&sid) {
                sess.dropped.store(0, Ordering::Release);
                sess.dropped_window = Instant::now();
            }
            if sentinel_queued {
                reaped += 1;
                self.slow_reaped.fetch_add(1, Ordering::Relaxed);
                tracing::warn!(
                    socket_id = sid,
                    dropped,
                    threshold,
                    "slow consumer reaped — close sentinel queued \
                     (client not draining its outbound queue)"
                );
            } else {
                tracing::warn!(
                    socket_id = sid,
                    dropped,
                    threshold,
                    "slow consumer identified but close sentinel undeliverable \
                     (queue full + close channel exhausted) — retrying next sweep"
                );
            }
        }
        reaped
    }

    /// Cumulative slow-consumer reaps since boot (for `stats()`).
    pub fn slow_reaped_total(&self) -> u64 {
        self.slow_reaped.load(Ordering::Acquire)
    }

    // ── stats / observability ──────────────────────────────────

    /// Snapshot of hub state for the `/health` endpoint + periodic log.
    pub fn stats(&self) -> HubStats {
        HubStats {
            connections: self.global_conns.load(Ordering::Acquire),
            max_connections: self.max_global_conns,
            rooms: self.rooms.len(),
            idempotency_entries: self.idempotency.len(),
            online_staff: presence().len(),
            distinct_ips: self.ip_conns.len(),
            slow_consumers_reaped: self.slow_reaped.load(Ordering::Acquire),
        }
    }

    /// Total online staff (employees + admins) across all brands. Used
    /// by `/api/admin/system` to show "how many support staff are
    /// online?" on the dashboard. Each staff member counts ONCE even
    /// with multiple sockets open (presence aggregates).
    pub fn count_online_staff_total(&self) -> usize {
        presence().online_count(None)
    }

    // ── graceful shutdown ──────────────────────────────────────

    /// Collect every live session id (used by the drain-on-shutdown path).
    /// Returns a Vec to avoid holding a read-guard across an await boundary.
    pub fn all_session_ids(&self) -> Vec<u64> {
        self.sessions.iter().map(|r| *r.key()).collect()
    }

    /// Send a pre-serialised payload to a single socket by id (non-blocking).
    /// Used by the drain path to push a `system: shutting down` notice.
    pub fn send_raw_to(&self, id: u64, payload: &str) {
        if let Some(sess) = self.sessions.get(&id) {
            let _ = sess
                .tx
                .try_send(bytes::Bytes::copy_from_slice(payload.as_bytes()));
        }
    }
}

/// Point-in-time hub snapshot (cheap to produce, safe to serialise).
#[derive(Debug, Clone, serde::Serialize)]
pub struct HubStats {
    pub connections: usize,
    pub max_connections: usize,
    pub rooms: usize,
    pub idempotency_entries: usize,
    pub online_staff: usize,
    pub distinct_ips: usize,
    /// Cumulative sockets force-closed for slow consuming since boot.
    /// Steadily growing under load = clients that cannot keep up with
    /// their room's message rate (see `WS_SLOW_CONSUMER_THRESHOLD`).
    pub slow_consumers_reaped: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::SessionUser;
    use uuid::Uuid;

    fn slots_of(ip: &str) -> usize {
        hub()
            .ip_conns
            .get(ip)
            .map(|n| n.load(std::sync::atomic::Ordering::Acquire))
            .unwrap_or(0)
    }

    /// An upgrade that fails drops the callback holding the admission:
    /// its slots must come back, leaving no stale per-IP entry.
    #[test]
    fn an_admission_that_never_became_a_session_gives_its_slots_back() {
        let ip = "192.0.2.201";
        let admission = admit(ip, 0).unwrap();
        assert_eq!(slots_of(ip), 1);
        drop(admission);
        assert_eq!(slots_of(ip), 0);
        assert!(hub().ip_conns.get(ip).is_none());

        // Handed to a session, the slot stays until `unregister`.
        let ip = "192.0.2.202";
        let held = admit(ip, 0).unwrap().into_session();
        assert_eq!((held.as_str(), slots_of(ip)), (ip, 1));
        hub().release_ip(&held);
        hub().release_global();
    }

    /// Build a fresh (non-singleton) hub for testing. The global hub() is a
    /// `OnceLock`-cached singleton, so to test concurrent operations in
    /// isolation we instantiate `ChatHub::new()` directly.
    fn fresh_hub() -> ChatHub {
        // Use a small global cap so the cap-rejection tests are meaningful
        // without each test needing to spin up 50_000 connections. Slow-
        // consumer threshold 128 keeps the normal tests away from the
        // reaper; the reaper test builds its own hub with a tiny one.
        ChatHub::with_limits(3, 60, 128)
    }

    fn sample_user(id: &str, actor: &str) -> SessionUser {
        // Generate a deterministic UUID from the string for testing
        let mut bytes = [0u8; 16];
        let id_bytes = id.as_bytes();
        for (i, b) in id_bytes.iter().enumerate().take(16) {
            bytes[i] = *b;
        }
        let uuid = Uuid::from_bytes(bytes);
        SessionUser {
            id: uuid,
            actor_type: actor.into(),
            role: "user".into(),
            name: format!("User-{id}"),
            email: None,
            phone: None,
            avatar_url: None,
            brand_id: None,
            brand_name: None,
            employee_role: None,
        }
    }

    fn make_tx() -> (ClientTx, tokio::sync::mpsc::Receiver<bytes::Bytes>) {
        // Bounded channel (matches production `ClientTx`). Capacity 64 is
        // ample for tests — the broadcast tests only send a handful of msgs.
        mpsc::channel(64)
    }

    // ── try_acquire_ip / release_ip ─────────────────────────────

    #[test]
    fn try_acquire_ip_first_n_succeed_then_fail() {
        let h = fresh_hub();
        let ip = "1.2.3.4";
        let cap = 3;
        assert!(h.try_acquire_ip(ip, cap));
        assert!(h.try_acquire_ip(ip, cap));
        assert!(h.try_acquire_ip(ip, cap));
        // 4th → fails (cap exceeded).
        assert!(!h.try_acquire_ip(ip, cap));
    }

    #[test]
    fn try_acquire_ip_independent_per_ip() {
        let h = fresh_hub();
        let cap = 1;
        assert!(h.try_acquire_ip("1.1.1.1", cap));
        assert!(h.try_acquire_ip("2.2.2.2", cap));
        assert!(!h.try_acquire_ip("1.1.1.1", cap));
        assert!(!h.try_acquire_ip("2.2.2.2", cap));
    }

    #[test]
    fn release_ip_frees_slot() {
        let h = fresh_hub();
        let ip = "9.9.9.9";
        let cap = 1;
        assert!(h.try_acquire_ip(ip, cap));
        assert!(!h.try_acquire_ip(ip, cap));
        h.release_ip(ip);
        assert!(h.try_acquire_ip(ip, cap), "release must free the slot");
    }

    #[test]
    fn try_acquire_ip_zero_cap_is_unlimited() {
        // 0 = disabled (the hardware-bounded default — see
        // `middleware::resource_guard`): never denies, but STILL counts
        // per-IP so `distinct_ips` stats stay accurate.
        let h = fresh_hub();
        for _ in 0..100 {
            assert!(h.try_acquire_ip("203.0.113.7", 0), "cap 0 must never deny");
        }
        assert!(
            h.ip_conns.get("203.0.113.7").is_some(),
            "unlimited mode still counts the ip"
        );
    }

    // ── register / unregister ───────────────────────────────────

    #[test]
    fn register_returns_incrementing_ids() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id1 = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        let (tx, _rx) = make_tx();
        let id2 = h
            .register(sample_user("u2", "user"), "1.1.1.1".into(), tx)
            .id;
        let (tx, _rx) = make_tx();
        let id3 = h
            .register(sample_user("u3", "user"), "1.1.1.1".into(), tx)
            .id;
        assert!(id2 > id1, "ids must be monotonic: {id1} {id2}");
        assert!(id3 > id2, "ids must be monotonic: {id2} {id3}");
    }

    #[test]
    fn register_then_unregister_removes_session() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        assert!(h.user_of(id).is_some());
        let departed = h
            .unregister(id)
            .expect("unregister should return the session");
        assert_eq!(departed.user.name, "User-u1");
        assert!(departed.channel_id.is_none(), "no channel was set");
        assert!(
            h.user_of(id).is_none(),
            "session must be gone after unregister"
        );
    }

    #[test]
    fn unregister_releases_ip_slot() {
        let h = fresh_hub();
        let ip = "8.8.8.8";
        // NOTE: `register` does NOT call try_acquire_ip — the caller (handler.rs)
        // does that explicitly. So we simulate the real flow here: acquire
        // global, acquire IP, register, unregister, then BOTH slots must be
        // free again.
        assert!(h.try_acquire_global(), "global acquire must succeed first");
        assert!(h.try_acquire_ip(ip, 1), "acquire must succeed first");
        let (tx, _rx) = make_tx();
        let id = h.register(sample_user("u1", "user"), ip.into(), tx).id;
        // Both slots busy.
        assert!(
            !h.try_acquire_ip(ip, 1),
            "IP slot should be busy after acquire"
        );
        h.unregister(id);
        // After unregister, BOTH slots must be released.
        assert!(
            h.try_acquire_ip(ip, 1),
            "unregister must release the IP slot"
        );
        // Global counter must also be back to 0 (release_global called).
        assert_eq!(
            h.connection_count(),
            0,
            "global count must be 0 after unregister"
        );
    }

    #[test]
    fn unregister_unknown_id_returns_none() {
        let h = fresh_hub();
        assert!(h.unregister(99999).is_none());
    }

    // ── set_channel / join_room / leave_room ────────────────────

    #[test]
    fn set_channel_returns_previous() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        assert_eq!(h.channel_of(id), None);
        let prev = h.set_channel(id, "ch1".into());
        assert_eq!(prev, None);
        assert_eq!(h.channel_of(id).as_deref(), Some("ch1"));
        let prev2 = h.set_channel(id, "ch2".into());
        assert_eq!(prev2.as_deref(), Some("ch1"));
        assert_eq!(h.channel_of(id).as_deref(), Some("ch2"));
    }

    /// The hub compares `sess.user.id.to_string()` (UUID) against the
    /// `user_id` argument, so tests must pass the UUID string the
    /// registered user actually carries — not the display name the
    /// sample user was built from.
    fn sample_user_id(name: &str) -> String {
        sample_user(name, "user").id.to_string()
    }

    #[test]
    fn set_channel_leaves_old_room() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        h.set_channel(id, "ch1".into());
        h.join_room("ch1", id);
        // Sanity: in ch1.
        h.set_channel(id, "ch2".into());
        // Now ch1 should have no member `id`.
        // Use `user_still_in_room` to confirm `id` left ch1.
        assert!(!h.user_still_in_room("ch1", &sample_user_id("u1"), id));
    }

    #[test]
    fn join_and_leave_room() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        h.join_room("room-a", id);
        // user_still_in_room excludes `except` from the search, so checking
        // the user's only socket against itself returns false. We use a
        // second socket to verify membership instead.
        let (tx2, _rx2) = make_tx();
        let id2 = h
            .register(sample_user("u2", "user"), "2.2.2.2".into(), tx2)
            .id;
        h.join_room("room-a", id2);
        let u1_id = sample_user_id("u1");
        // id is in the room; checking from id2's perspective (except=id2) sees id.
        assert!(
            h.user_still_in_room("room-a", &u1_id, id2),
            "u1 must be in room (visible from u2's perspective)"
        );
        h.leave_room("room-a", id);
        assert!(
            !h.user_still_in_room("room-a", &u1_id, id2),
            "u1 must be gone after leave_room"
        );
    }

    // ── room-entry reclamation (the unbounded-growth regression) ──

    #[test]
    fn leave_room_reclaims_empty_room_entry() {
        // The last member leaving must drop the whole room entry:
        // leaving an empty `String → DashSet` behind leaked one map
        // entry per channel ever joined (permanent RSS growth).
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        h.join_room("room-a", id);
        assert_eq!(h.stats().rooms, 1, "room entry exists while occupied");
        h.leave_room("room-a", id);
        assert_eq!(
            h.stats().rooms,
            0,
            "empty room entry must be reclaimed after the last member leaves"
        );
        // Leaving an already-empty (or never-existing) room is a no-op.
        h.leave_room("room-a", id);
        assert_eq!(h.stats().rooms, 0);
    }

    #[test]
    fn leave_room_keeps_entry_with_remaining_member() {
        let h = fresh_hub();
        let (tx1, _rx1) = make_tx();
        let (tx2, mut rx2) = make_tx();
        let id1 = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx1)
            .id;
        let id2 = h
            .register(sample_user("u2", "user"), "2.2.2.2".into(), tx2)
            .id;
        h.join_room("room", id1);
        h.join_room("room", id2);
        h.leave_room("room", id1);
        assert_eq!(
            h.stats().rooms,
            1,
            "room with a remaining member must stay alive"
        );
        // The remaining member still receives broadcasts.
        h.broadcast_to_room("room", &serde_json::json!({ "type": "ping" }));
        let m2 = rx2.try_recv().expect("remaining member must receive");
        assert!(std::str::from_utf8(&m2).unwrap_or("").contains("ping"));
    }

    // ── broadcast_to_room / broadcast_to_room_except ────────────

    #[test]
    fn broadcast_to_room_delivers_to_all_members() {
        let h = fresh_hub();
        let (tx1, mut rx1) = make_tx();
        let (tx2, mut rx2) = make_tx();
        let id1 = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx1)
            .id;
        let id2 = h
            .register(sample_user("u2", "user"), "2.2.2.2".into(), tx2)
            .id;
        h.join_room("room", id1);
        h.join_room("room", id2);

        h.broadcast_to_room("room", &serde_json::json!({ "type": "ping" }));

        let m1 = rx1.try_recv().expect("u1 must receive");
        let m2 = rx2.try_recv().expect("u2 must receive");
        assert!(std::str::from_utf8(&m1).unwrap_or("").contains("ping"));
        assert!(std::str::from_utf8(&m2).unwrap_or("").contains("ping"));
    }

    #[test]
    fn broadcast_to_room_skips_unknown_room() {
        let h = fresh_hub();
        // No panic when room doesn't exist.
        h.broadcast_to_room("nope", &serde_json::json!({ "type": "ping" }));
    }

    #[test]
    fn broadcast_to_room_except_skips_excluded_socket() {
        let h = fresh_hub();
        let (tx1, mut rx1) = make_tx();
        let (tx2, mut rx2) = make_tx();
        let id1 = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx1)
            .id;
        let id2 = h
            .register(sample_user("u2", "user"), "2.2.2.2".into(), tx2)
            .id;
        h.join_room("room", id1);
        h.join_room("room", id2);

        h.broadcast_to_room_except("room", &serde_json::json!({ "type": "ping" }), id1);

        // id1 must NOT receive; id2 must receive.
        assert!(rx1.try_recv().is_err(), "excluded socket must not receive");
        let m2 = rx2.try_recv().expect("u2 must receive");
        assert!(std::str::from_utf8(&m2).unwrap_or("").contains("ping"));
    }

    #[test]
    fn send_to_delivers_to_single_socket() {
        let h = fresh_hub();
        let (tx, mut rx) = make_tx();
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        h.send_to(id, &serde_json::json!({ "type": "hello" }));
        let m = rx.try_recv().expect("must receive");
        assert!(std::str::from_utf8(&m).unwrap_or("").contains("hello"));
    }

    // ── user_still_in_room ──────────────────────────────────────

    #[test]
    fn user_still_in_room_distinguishes_same_user_other_socket() {
        let h = fresh_hub();
        let (tx1, _rx1) = make_tx();
        let (tx2, _rx2) = make_tx();
        let id1 = h
            .register(sample_user("uA", "user"), "1.1.1.1".into(), tx1)
            .id;
        let id2 = h
            .register(sample_user("uA", "user"), "1.1.1.1".into(), tx2)
            .id;
        h.join_room("room", id1);
        h.join_room("room", id2);
        let ua_id = sample_user_id("uA");
        // Even when excluding id1, id2 (same user) keeps the user "in room".
        assert!(h.user_still_in_room("room", &ua_id, id1));
        h.leave_room("room", id1);
        assert!(
            h.user_still_in_room("room", &ua_id, id1),
            "id2 still in room"
        );
        h.leave_room("room", id2);
        assert!(!h.user_still_in_room("room", &ua_id, id1));
    }

    // ── staff broadcasts + targeted sends ───────────────────────

    #[test]
    fn broadcast_to_staff_delivers_to_staff_only() {
        let h = fresh_hub();
        let (tx_c, mut rx_c) = make_tx();
        let (tx_e, mut rx_e) = make_tx();
        let (tx_a, mut rx_a) = make_tx();
        h.register(sample_user("uc", "user"), "1.1.1.1".into(), tx_c);
        h.register(sample_user("ue", "employee"), "2.2.2.2".into(), tx_e);
        h.register(sample_user("ua", "admin"), "3.3.3.3".into(), tx_a);

        h.broadcast_to_staff(&serde_json::json!({ "type": "staff_ping" }));

        assert!(
            rx_c.try_recv().is_err(),
            "customers must NOT receive staff broadcasts"
        );
        let me = rx_e.try_recv().expect("employee must receive");
        let ma = rx_a.try_recv().expect("admin must receive");
        assert!(std::str::from_utf8(&me)
            .unwrap_or("")
            .contains("staff_ping"));
        assert!(std::str::from_utf8(&ma)
            .unwrap_or("")
            .contains("staff_ping"));
    }

    #[test]
    fn broadcast_to_admins_targets_admins_only() {
        let h = fresh_hub();
        let (tx_e, mut rx_e) = make_tx();
        let (tx_a, mut rx_a) = make_tx();
        h.register(sample_user("ue", "employee"), "1.1.1.1".into(), tx_e);
        h.register(sample_user("ua", "admin"), "2.2.2.2".into(), tx_a);

        h.broadcast_to_admins(&serde_json::json!({ "type": "admin_ping" }));

        assert!(
            rx_e.try_recv().is_err(),
            "employees must NOT receive admin broadcasts"
        );
        let ma = rx_a.try_recv().expect("admin must receive");
        assert!(std::str::from_utf8(&ma)
            .unwrap_or("")
            .contains("admin_ping"));
    }

    #[test]
    fn send_to_user_delivers_to_all_their_sockets() {
        let h = fresh_hub();
        let (tx1, mut rx1) = make_tx();
        let (tx2, mut rx2) = make_tx();
        let (tx3, mut rx3) = make_tx();
        // Two sockets for the same user, one for someone else.
        h.register(sample_user("uT", "employee"), "1.1.1.1".into(), tx1);
        h.register(sample_user("uT", "employee"), "1.1.1.1".into(), tx2);
        h.register(sample_user("uX", "employee"), "2.2.2.2".into(), tx3);

        let target_id = sample_user_id("uT").to_string();
        let delivered = h.send_to_user(&target_id, &serde_json::json!({ "type": "dm" }));

        assert_eq!(delivered, 2, "both tabs of the user receive");
        assert!(rx1.try_recv().is_ok(), "tab 1 receives");
        assert!(rx2.try_recv().is_ok(), "tab 2 receives");
        assert!(rx3.try_recv().is_err(), "other users do not");
    }

    #[test]
    fn unregister_removes_staff_presence_socket() {
        use crate::presence::presence;
        let h = fresh_hub();
        let user = sample_user("uP", "employee");
        let uid = user.id.to_string();
        let (tx, _rx) = make_tx();
        let id = h.register(user, "1.1.1.1".into(), tx).id;
        presence().chat_socket_connected(&sample_user("uP", "employee"), id);
        assert!(presence().is_online(&uid));
        h.unregister(id);
        assert!(
            !presence().is_online(&uid),
            "presence entry must drop with the last socket"
        );
    }

    // ── idempotency ─────────────────────────────────────────────

    #[test]
    fn idem_claim_first_call_returns_none() {
        let h = fresh_hub();
        assert!(
            h.idem_claim("msg-1").is_none(),
            "first claim must return None"
        );
    }

    #[test]
    fn idem_claim_second_call_returns_in_flight_some_none() {
        let h = fresh_hub();
        h.idem_claim("msg-1");
        let r = h
            .idem_claim("msg-1")
            .expect("Some must be returned on second call");
        assert!(r.is_none(), "in-flight → Some(None)");
    }

    #[test]
    fn idem_store_then_claim_returns_some_some() {
        let h = fresh_hub();
        h.idem_claim("msg-1");
        h.idem_store("msg-1", "real-id-123");
        let r = h.idem_claim("msg-1").expect("Some");
        let r = r.expect("Some(Some) after store");
        assert_eq!(r, "real-id-123".to_string());
    }

    #[test]
    fn idem_store_without_claim_works() {
        // Storing without claiming first is allowed (defensive).
        let h = fresh_hub();
        h.idem_store("msg-x", "id-x");
        let r = h.idem_claim("msg-x").expect("Some");
        assert_eq!(r, Some("id-x".to_string()));
    }

    #[test]
    fn idem_gc_noop_when_nothing_expired() {
        // With the new TTL-based GC, calling idem_gc immediately after
        // claims is a no-op (entries are all younger than IDEM_TTL).
        let h = fresh_hub();
        for i in 0..100 {
            h.idem_claim(&format!("m{i}"));
        }
        h.idem_gc();
        // All claims are still in-flight (idem_claim returns None for
        // entries that exist but haven't been stored yet).
        let r = h.idem_claim("m0").expect("Some");
        assert!(r.is_none(), "in-flight");
    }

    /// Backdate an idempotency entry past IDEM_TTL so the next GC sweep
    /// sees it as expired — without sleeping for 5 real minutes.
    fn insert_backdated_idem(h: &ChatHub, key: &str, age: Duration) {
        let stored_at = Instant::now()
            .checked_sub(age)
            .expect("CI host uptime exceeds the backdate age");
        h.idempotency.insert(key.to_string(), (stored_at, None));
    }

    /// Run `f` on a helper thread and fail fast (instead of hanging the
    /// whole test binary) if it doesn't complete within 5s. The pre-retain
    /// `idem_gc` self-deadlocked (remove under an iter read-guard) and
    /// would otherwise stall CI until the job timeout.
    fn run_with_deadlock_watchdog<F: FnOnce() + Send + 'static>(ctx: &str, f: F) {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            f();
            let _ = tx.send(());
        });
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(()) => {}
            Err(_) => panic!("{ctx} deadlocked (blocked > 5s) — remove() under iter() guard?"),
        }
    }

    #[test]
    fn idem_gc_sweeps_expired_entries_without_deadlocking() {
        // Regression (2026-09-10 "dies after a call"): idem_gc used to
        // `remove()` while iterating, self-deadlocking the GC task's
        // worker thread. The worker held the tokio I/O driver, so the
        // runtime stopped polling epoll entirely and /health timed out
        // until Swarm killed the container.
        let h = std::sync::Arc::new(fresh_hub());
        h.idem_claim("fresh-claim");
        h.idem_store("fresh-store", "srv-1");
        insert_backdated_idem(&h, "expired-1", ChatHub::IDEM_TTL + Duration::from_secs(1));
        insert_backdated_idem(&h, "expired-2", ChatHub::IDEM_TTL + Duration::from_secs(60));

        let h2 = h.clone();
        run_with_deadlock_watchdog("idem_gc", move || h2.idem_gc());

        assert!(
            h.idem_claim("expired-1").is_none(),
            "expired entry must be swept (a new claim returns None)"
        );
        assert!(!h.idempotency.contains_key("expired-2"));
        let stored = h.idem_claim("fresh-claim").expect("Some");
        assert!(stored.is_none(), "in-flight entry must survive the sweep");
        assert_eq!(
            h.idem_claim("fresh-store"),
            Some(Some("srv-1".to_string())),
            "stored entry must survive the sweep"
        );
    }

    #[test]
    fn channel_cache_gc_sweeps_expired_entries_without_deadlocking() {
        // fresh_hub uses channel_cache_ttl = 60s.
        let h = std::sync::Arc::new(fresh_hub());
        h.cache_channel_exists("fresh-channel");
        let stale_at = Instant::now()
            .checked_sub(Duration::from_secs(61))
            .expect("CI host uptime exceeds 61s");
        h.channel_exists_cache
            .insert("stale-channel".into(), stale_at);
        h.channel_exists_cache
            .insert("stale-channel-2".into(), stale_at);

        let h2 = h.clone();
        run_with_deadlock_watchdog("channel_cache_gc", move || h2.channel_cache_gc());

        assert!(h.channel_exists_cached("fresh-channel"));
        assert!(!h.channel_exists_cached("stale-channel"));
        assert!(!h.channel_exists_cache.contains_key("stale-channel-2"));
    }

    // ── user_of / channel_of /    // ── user_of / channel_of ────────────────────────────────────

    #[test]
    fn user_of_returns_user_for_known_id() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h
            .register(sample_user("u7", "user"), "1.1.1.1".into(), tx)
            .id;
        let u = h.user_of(id).expect("must be Some");
        assert_eq!(u.name, "User-u7");
    }

    #[test]
    fn user_of_returns_none_for_unknown_id() {
        let h = fresh_hub();
        assert!(h.user_of(999999).is_none());
    }

    #[test]
    fn channel_of_returns_none_for_unknown_id() {
        let h = fresh_hub();
        assert!(h.channel_of(999999).is_none());
    }

    // ── global connection cap ───────────────────────────────────

    #[test]
    fn try_acquire_global_under_cap_succeeds() {
        // fresh_hub uses cap=3.
        let h = fresh_hub();
        assert!(h.try_acquire_global());
        assert!(h.try_acquire_global());
        assert!(h.try_acquire_global());
        assert_eq!(h.connection_count(), 3);
        // 4th exceeds cap.
        assert!(!h.try_acquire_global(), "4th acquire must be rejected");
    }

    #[test]
    fn try_acquire_global_zero_means_unlimited() {
        // cap=0 = unlimited (counter still increments).
        let h = ChatHub::with_limits(0, 60, 128);
        assert!(h.try_acquire_global());
        assert!(h.try_acquire_global());
        assert!(h.try_acquire_global());
        assert_eq!(h.connection_count(), 3, "unlimited mode still counts");
        assert_eq!(h.max_connections(), 0);
    }

    #[test]
    fn release_global_releases_slot() {
        let h = fresh_hub(); // cap=3
        assert!(h.try_acquire_global());
        assert!(h.try_acquire_global());
        assert!(h.try_acquire_global());
        assert!(!h.try_acquire_global());
        h.release_global();
        // One slot freed.
        assert!(h.try_acquire_global(), "freed slot must be re-acquirable");
    }

    #[test]
    fn release_global_underflow_is_safe() {
        // Releasing without acquiring must NOT panic (defensive saturation).
        let h = fresh_hub();
        h.release_global();
        h.release_global();
        assert_eq!(h.connection_count(), 0, "underflow must saturate at 0");
        // Hub still usable afterwards.
        assert!(h.try_acquire_global());
        assert_eq!(h.connection_count(), 1);
    }

    #[test]
    fn connection_count_is_atomic_and_accurate() {
        let h = fresh_hub();
        for _ in 0..3 {
            assert!(h.try_acquire_global());
        }
        assert_eq!(h.connection_count(), 3);
        h.release_global();
        assert_eq!(h.connection_count(), 2);
    }

    // ── channel-exists cache ────────────────────────────────────

    #[test]
    fn channel_cache_round_trip() {
        let h = fresh_hub();
        assert!(!h.channel_exists_cached("ch-1"), "uncached → false");
        h.cache_channel_exists("ch-1");
        assert!(h.channel_exists_cached("ch-1"), "after insert → true");
        assert!(
            !h.channel_exists_cached("ch-2"),
            "other channel still false"
        );
    }

    // ── stats / observability ───────────────────────────────────

    #[test]
    fn stats_reflects_state() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id1 = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        h.join_room("room-x", id1);
        let s = h.stats();
        assert_eq!(s.rooms, 1, "one room joined");
        // connections/0 because register() doesn't call try_acquire_global;
        // only the handler does. This keeps the invariant explicit.
    }

    #[test]
    fn all_session_ids_returns_every_live_socket() {
        let h = fresh_hub();
        let (tx1, _rx1) = make_tx();
        let (tx2, _rx2) = make_tx();
        let id1 = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx1)
            .id;
        let id2 = h
            .register(sample_user("u2", "user"), "2.2.2.2".into(), tx2)
            .id;
        let mut ids = h.all_session_ids();
        ids.sort();
        assert_eq!(ids, vec![id1, id2]);
    }

    #[test]
    fn broadcast_to_room_raw_counts_deliveries() {
        let h = fresh_hub();
        let (tx1, _rx1) = make_tx();
        let (tx2, mut rx2) = make_tx();
        let id1 = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx1)
            .id;
        let id2 = h
            .register(sample_user("u2", "user"), "2.2.2.2".into(), tx2)
            .id;
        h.join_room("room", id1);
        h.join_room("room", id2);
        let n = h.broadcast_to_room_raw("room", r#"{\"type\":\"ping\"}"#);
        assert_eq!(n, 2, "both members must receive");
        // And the message actually arrived.
        let m = rx2.try_recv().expect("u2 must receive");
        assert!(std::str::from_utf8(&m).unwrap_or("").contains("ping"));
    }

    // ── routing indexes (O(recipients) fan-out) ──────────────────

    #[test]
    fn unregister_reclaims_routing_index_entries() {
        // The user/staff/admin index entries must not outlive their last
        // socket — an empty DashSet per user ever seen is the same
        // permanent-RSS leak leave_room fixed for rooms.
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h
            .register(sample_user("staff1", "employee"), "1.1.1.1".into(), tx)
            .id;
        assert_eq!(h.by_user.len(), 1);
        assert_eq!(h.staff_sockets.len(), 1);
        assert_eq!(h.admin_sockets.len(), 0, "employee is not admin");
        h.unregister(id);
        assert_eq!(h.by_user.len(), 0, "by_user entry must be reclaimed");
        assert_eq!(h.staff_sockets.len(), 0, "staff entry must be reclaimed");

        // Multi-socket user: entry survives until the LAST socket drops.
        let (tx1, _rx1) = make_tx();
        let (tx2, _rx2) = make_tx();
        let id1 = h
            .register(sample_user("uA", "user"), "1.1.1.1".into(), tx1)
            .id;
        let id2 = h
            .register(sample_user("uA", "user"), "1.1.1.1".into(), tx2)
            .id;
        assert_eq!(h.by_user.len(), 1, "same user = one entry");
        h.unregister(id1);
        assert_eq!(h.by_user.len(), 1, "entry survives while one socket lives");
        assert_eq!(h.sockets_of_user(&sample_user_id("uA")), vec![id2]);
        h.unregister(id2);
        assert_eq!(h.by_user.len(), 0);
    }

    #[test]
    fn sockets_of_user_is_indexed_not_scanned() {
        let h = fresh_hub();
        let (tx1, _rx1) = make_tx();
        let (tx2, _rx2) = make_tx();
        let (tx3, _rx3) = make_tx();
        let id1 = h
            .register(sample_user("uA", "user"), "1.1.1.1".into(), tx1)
            .id;
        let _other = h
            .register(sample_user("uB", "user"), "2.2.2.2".into(), tx2)
            .id;
        let id3 = h
            .register(sample_user("uA", "user"), "1.1.1.1".into(), tx3)
            .id;
        let mut sockets = h.sockets_of_user(&sample_user_id("uA"));
        sockets.sort();
        let mut expected = vec![id1, id3];
        expected.sort();
        assert_eq!(sockets, expected);
        // Unknown user → empty, not an error.
        assert!(h.sockets_of_user("nope").is_empty());
    }

    // ── slow-consumer reaper ─────────────────────────────────────

    #[test]
    fn reaper_closes_socket_past_threshold_after_queue_drains() {
        // Threshold 4, queue capacity 4: 10 broadcasts → 4 queued + 6
        // dropped ≥ threshold. The sentinel fallback needs queue space,
        // so the test drains first (the write pump does exactly this in
        // production) — then the reaper must deliver the empty-Bytes
        // close sentinel and count the reap.
        let h = ChatHub::with_limits(3, 60, 4);
        let (tx, mut rx) = mpsc::channel(4);
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        h.join_room("room", id);
        for _ in 0..10 {
            h.broadcast_to_room_raw("room", "{\"type\":\"ping\"}");
        }
        // Drain the queued messages (the write pump's job).
        let mut seen = 0;
        while rx.try_recv().is_ok() {
            seen += 1;
        }
        assert_eq!(seen, 4, "capacity bounded the queue");
        let reaped = h.reap_slow_consumers();
        assert_eq!(reaped, 1, "socket over threshold must be reaped");
        assert_eq!(h.slow_reaped_total(), 1);
        // The close sentinel arrives as an empty Bytes payload.
        let sentinel = rx.try_recv().expect("close sentinel must be queued");
        assert!(
            sentinel.is_empty(),
            "sentinel is the empty-Bytes close marker"
        );

        // Meter was reset: a few more drops WITHOUT hitting the threshold
        // must NOT reap again.
        for _ in 0..3 {
            h.broadcast_to_room_raw("room", "{\"type\":\"ping\"}");
        }
        let _ = rx.try_recv();
        assert_eq!(h.reap_slow_consumers(), 0, "below threshold = no reap");
    }

    #[test]
    fn reaper_uses_priority_close_channel_even_with_full_queue() {
        // The production wiring: handle_socket registers a dedicated
        // 1-slot close channel via set_closer — the sentinel MUST go out
        // even when the outbound queue is completely full (a full queue
        // is the reaping condition itself).
        let h = ChatHub::with_limits(3, 60, 4);
        let (tx, mut rx) = mpsc::channel(2);
        let (close_tx, mut close_rx) = mpsc::channel::<()>(1);
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        h.set_closer(id, close_tx);
        h.join_room("room", id);
        // Fill the queue (2 queued) + 5 dropped.
        for _ in 0..7 {
            h.broadcast_to_room_raw("room", "{\"type\":\"ping\"}");
        }
        // Do NOT drain — queue stays full. The dedicated close channel
        // still delivers.
        let reaped = h.reap_slow_consumers();
        assert_eq!(reaped, 1);
        close_rx
            .try_recv()
            .expect("priority close channel must fire despite full queue");
        // The outbound queue still holds ONLY the two original messages:
        // the empty-Bytes sentinel could not fit (queue full — that is
        // the reaping condition), so the close went exclusively through
        // the priority channel.
        let mut drained = Vec::new();
        while let Ok(m) = rx.try_recv() {
            drained.push(m);
        }
        assert_eq!(drained.len(), 2, "queue holds only the 2 original messages");
        assert!(
            drained.iter().all(|m| !m.is_empty()),
            "no close sentinel was queued into the full outbound queue"
        );
        assert_eq!(h.slow_reaped_total(), 1);
    }

    #[test]
    fn reaper_disabled_when_threshold_zero() {
        let h = ChatHub::with_limits(3, 60, 0);
        let (tx, _rx) = mpsc::channel(2);
        let id = h
            .register(sample_user("u1", "user"), "1.1.1.1".into(), tx)
            .id;
        h.join_room("room", id);
        for _ in 0..10 {
            h.broadcast_to_room_raw("room", "{\"type\":\"ping\"}");
        }
        assert_eq!(h.reap_slow_consumers(), 0, "threshold 0 = reaper off");
        assert_eq!(h.slow_reaped_total(), 0);
    }

    // ── Customer presence ───────────────────────────────────────

    /// Online means "has at least one socket": only the first socket
    /// announces it, only the last one's close takes it back, and every
    /// announcement carries a strictly newer sequence number.
    #[test]
    fn presence_flips_on_first_and_last_socket_with_increasing_seq() {
        let h = fresh_hub();
        let u = sample_user("cust-a", "user");
        let uid = u.id.to_string();

        let (tx, _rx1) = make_tx();
        let first = h.register(u.clone(), "1.1.1.1".into(), tx);
        let up = first
            .online_seq
            .expect("first socket brings the user online");
        let (tx, _rx2) = make_tx();
        let second = h.register(u.clone(), "1.1.1.1".into(), tx);
        assert_eq!(second.online_seq, None, "a second tab is not news");
        assert_eq!(h.online_customers().1, vec![uid.clone()]);

        let gone = h.unregister(first.id).unwrap();
        assert_eq!(gone.offline_seq, None, "one tab is still open");
        let down = h
            .unregister(second.id)
            .unwrap()
            .offline_seq
            .expect("last socket takes the user offline");
        assert!(down > up);
        assert!(h.online_customers().1.is_empty());

        // A refresh: the new socket's online event is newer still.
        let (tx, _rx3) = make_tx();
        let again = h.register(u, "1.1.1.1".into(), tx).online_seq.unwrap();
        assert!(again > down);
    }

    /// The staff list shows customers; staff sockets never appear in it,
    /// and the snapshot's number covers every transition it reflects.
    #[test]
    fn online_customers_excludes_staff_and_is_as_new_as_its_seq() {
        let h = fresh_hub();
        let (tx, _rx1) = make_tx();
        let c = h.register(sample_user("cust-b", "user"), "1.1.1.1".into(), tx);
        let (tx, _rx2) = make_tx();
        h.register(sample_user("emp-b", "employee"), "2.2.2.2".into(), tx);
        let (tx, _rx3) = make_tx();
        h.register(sample_user("adm-b", "admin"), "3.3.3.3".into(), tx);

        let (seq, users) = h.online_customers();
        assert_eq!(users, vec![sample_user("cust-b", "user").id.to_string()]);
        assert!(seq >= c.online_seq.unwrap());
    }

    /// Closing the support panel detaches the socket from its room but
    /// keeps the user online.
    #[test]
    fn clear_channel_leaves_the_room_but_not_the_site() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let u = sample_user("cust-c", "user");
        let id = h.register(u.clone(), "1.1.1.1".into(), tx).id;
        h.set_channel(id, "room-c".into());
        h.join_room("room-c", id);
        assert!(h.is_user_online_in_channel("room-c", &u.id.to_string()));

        assert_eq!(h.clear_channel(id).as_deref(), Some("room-c"));
        assert!(!h.is_user_online_in_channel("room-c", &u.id.to_string()));
        assert_eq!(h.clear_channel(id), None);
        assert_eq!(h.online_customers().1, vec![u.id.to_string()]);
    }
}

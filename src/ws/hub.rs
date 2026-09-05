//! In-memory connection registry for the WebSocket chat.
//!
//! Built on [`DashMap`] for lock-free concurrent reads/writes — every
//! connected client is indexed by a `u64` socket id (atomic counter) so
//! lookups, room membership and presence broadcasts are all O(1).
//!
//! The hub is a process-local singleton (`OnceLock`); for horizontal
//! scaling behind multiple instances, swap this for a Redis Pub/Sub fan-out
//! (the `broadcast_to_room` call site is the only place that needs changing).

use std::sync::atomic::{AtomicUsize, Ordering};
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
}

/// The shared chat hub. Cheap to clone (`&'static` via [`hub()`]).
///
/// Staff presence (online / busy / load) lives in [`crate::presence`] —
/// the hub no longer keeps its own employee index.
pub struct ChatHub {
    sessions: DashMap<u64, Session>,
    rooms: DashMap<String, DashSet<u64>>,
    ip_conns: DashMap<String, std::sync::atomic::AtomicUsize>,
    idempotency: DashMap<String, (Instant, Option<String>)>, // (stored_at, value)
    next_id: std::sync::atomic::AtomicU64,
    /// Total live sessions across all IPs (atomic for O(1) admission checks).
    global_conns: AtomicUsize,
    /// Hard cap on `global_conns` (read once at init from config; 0 = unlimited).
    max_global_conns: usize,
    /// Cache of "channel_id exists" lookups — short-circuits the
    /// `SELECT * FROM ChatChannel WHERE id = ?` on every `join`.
    /// Maps `channel_id → inserted_at`; entries older than
    /// `channel_cache_ttl` are treated as misses (and purged by `idem_gc`).
    channel_exists_cache: DashMap<String, Instant>,
    /// TTL for `channel_exists_cache` entries.
    channel_cache_ttl: Duration,
}

static HUB: OnceLock<ChatHub> = OnceLock::new();
static HUB_CFG: OnceLock<(usize, u64)> = OnceLock::new();

/// Process-global hub accessor (lazily initialised on first call).
///
/// If `init_with_config` was called BEFORE the first `hub()` call (the
/// normal boot order in `server.rs::bootstrap`), the configured
/// `WsConfig.max_connections` is used. Otherwise the hardcoded fallback
/// (50_000 connections, 60s channel-cache TTL) applies — useful for tests
/// that don't go through the full bootstrap.
pub fn hub() -> &'static ChatHub {
    HUB.get_or_init(|| {
        let (max, ttl) = *HUB_CFG.get().unwrap_or(&(50_000, 60));
        ChatHub::with_limits(max, ttl)
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
pub fn init_with_config(max_global: usize, channel_cache_ttl_sec: u64) {
    let _ = HUB_CFG.set((max_global, channel_cache_ttl_sec));
}

impl ChatHub {
    /// Construct with explicit global-connection cap and channel-cache TTL.
    /// Called from `hub()` (defaults) and from tests that want isolated limits.
    pub fn with_limits(max_global: usize, channel_cache_ttl_sec: u64) -> Self {
        Self {
            sessions: DashMap::new(),
            rooms: DashMap::new(),
            ip_conns: DashMap::new(),
            idempotency: DashMap::new(),
            next_id: std::sync::atomic::AtomicU64::new(1),
            global_conns: AtomicUsize::new(0),
            max_global_conns: max_global,
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
        // fetch_sub saturating at 0 (defensive — should never underflow if
        // acquire/release are balanced, but a double-release must not panic).
        let prev = self.global_conns.fetch_sub(1, Ordering::AcqRel);
        if prev == 0 {
            // Undo the underflow we just caused.
            self.global_conns.store(0, Ordering::Release);
        }
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
    /// NOTE: this does NOT touch the global counter — call `try_acquire_global`
    /// first, then `try_acquire_ip`, and roll back the global acquire if the
    /// IP check fails.
    pub fn try_acquire_ip(&self, ip: &str, cap: usize) -> bool {
        use std::sync::atomic::Ordering;
        let entry = self.ip_conns.entry(ip.to_string()).or_default();
        // CAS loop: only increment if below cap.
        loop {
            let cur = entry.load(Ordering::Acquire);
            if cur >= cap {
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
            let prev = entry.fetch_sub(1, Ordering::AcqRel);
            if prev <= 1 {
                drop(entry);
                self.ip_conns.remove(ip);
            }
        }
    }

    /// Register a new connection. Returns the assigned socket id.
    /// Precondition: the caller has ALREADY acquired a global slot via
    /// [`try_acquire_global`] and a per-IP slot via [`try_acquire_ip`].
    /// [`unregister`] releases both.
    pub fn register(&self, user: SessionUser, ip: String, tx: ClientTx) -> u64 {
        use std::sync::atomic::Ordering;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.sessions.insert(
            id,
            Session {
                user,
                channel_id: None,
                tx,
                ip,
            },
        );
        id
    }

    /// Tear down a connection: leave any joined room, remove the staff
    /// presence socket, release the IP slot, release the global slot,
    /// and drop the session. Returns the (user, channel_id) pair so the
    /// caller can broadcast the correct presence-offline update.
    pub fn unregister(&self, id: u64) -> Option<(SessionUser, Option<String>)> {
        let (_, sess) = self.sessions.remove(&id)?;
        // Leave the current channel room (presence broadcast is done by caller).
        if let Some(cid) = &sess.channel_id {
            self.leave_room(cid, id);
        }
        // Remove the presence socket (whole entry drops when the staff
        // member's last socket of either family goes away).
        if sess.user.is_staff() {
            presence().chat_socket_disconnected(&sess.user.id.to_string(), id);
        }
        self.release_ip(&sess.ip);
        self.release_global();
        Some((sess.user, sess.channel_id))
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
    }

    /// Push a pre-serialised JSON string to every socket in a room.
    /// Serialisation is done once by the caller; we only clone the `String`.
    /// Uses **non-blocking `try_send`** so a single slow consumer cannot stall
    /// the broadcast for everyone else — a full channel drops the message
    /// (the heartbeat sweep will reap the slow socket shortly).
    ///
    /// Returns the number of recipients the message was delivered to.
    pub fn broadcast_to_room_raw(&self, channel_id: &str, payload: &str) -> usize {
        // Pre-serialise once; `Bytes::clone()` per recipient is just an
        // atomic refcount bump — no heap allocation, no memcpy.
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        let mut delivered = 0;
        if let Some(set) = self.rooms.get(channel_id) {
            for sid in set.iter() {
                if let Some(sess) = self.sessions.get(&sid) {
                    // try_send: non-blocking. On Full, drop the message (slow
                    // consumer). On Closed, the read loop will reap it.
                    if sess.tx.try_send(bytes.clone()).is_ok() {
                        delivered += 1;
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
                    let _ = sess.tx.try_send(bytes.clone());
                }
            }
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
            let _ = entry.tx.try_send(bytes.clone());
        }
    }

    /// Broadcast a JSON message to ALL online STAFF sockets (employees
    /// AND admins, across every brand). Used for:
    ///   - the "new message arrived in another channel" attention signal,
    ///   - `staff_presence` fan-out when availability changes.
    ///
    /// Iterates the session map and filters `user.is_staff()`. Each
    /// socket gets one delivery (multiple tabs = multiple deliveries,
    /// intentional so every tab updates its UI).
    pub fn broadcast_to_staff(&self, msg: &serde_json::Value) {
        let payload = serde_json::to_string(msg).unwrap_or_default();
        self.broadcast_to_staff_raw(&payload);
    }

    /// Raw-payload variant of [`broadcast_to_staff`] (payload is
    /// pre-serialised by the caller).
    pub fn broadcast_to_staff_raw(&self, payload: &str) {
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        for entry in self.sessions.iter() {
            if entry.value().user.is_staff() {
                let _ = entry.value().tx.try_send(bytes.clone());
            }
        }
    }

    /// Send a JSON message to EVERY live socket of one user (all their
    /// tabs). Used for targeted routing — e.g. a new message in a
    /// channel assigned to employee X goes to X's sockets, not to all
    /// staff. Returns the number of sockets it was queued to.
    pub fn send_to_user(&self, user_id: &str, msg: &serde_json::Value) -> usize {
        let payload = serde_json::to_string(msg).unwrap_or_default();
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        let mut delivered = 0;
        for entry in self.sessions.iter() {
            if entry.value().user.id.to_string() == user_id
                && entry.value().tx.try_send(bytes.clone()).is_ok()
            {
                delivered += 1;
            }
        }
        delivered
    }

    /// Send a JSON message to every live ADMIN socket (regardless of
    /// brand). Admins monitor the whole support queue, so they keep
    /// receiving channel notifications even for channels assigned to
    /// a specific employee.
    pub fn broadcast_to_admins(&self, msg: &serde_json::Value) {
        let payload = serde_json::to_string(msg).unwrap_or_default();
        let bytes = bytes::Bytes::copy_from_slice(payload.as_bytes());
        for entry in self.sessions.iter() {
            if entry.value().user.is_admin() {
                let _ = entry.value().tx.try_send(bytes.clone());
            }
        }
    }

    /// Collect the socket ids of a user's live sessions (used for
    /// targeted sends from the assignment logic).
    pub fn sockets_of_user(&self, user_id: &str) -> Vec<u64> {
        self.sessions
            .iter()
            .filter(|e| e.value().user.id.to_string() == user_id)
            .map(|e| *e.key())
            .collect()
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
            Entry::Occupied(e) => {
                // Already claimed/stored — check TTL.
                let (stored_at, val) = e.get();
                if stored_at.elapsed() > Self::IDEM_TTL {
                    // Stale — overwrite with a fresh claim.
                    drop(e);
                    self.idempotency
                        .insert(client_msg_id.to_string(), (Instant::now(), None));
                    None
                } else {
                    Some(val.clone())
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
    /// Iterates the map and drops expired entries; runs every 60s from a
    /// background task. Uses DashMap's iterator (lock-per-shard) so it
    /// doesn't block concurrent `idem_claim` callers.
    pub fn idem_gc(&self) {
        let now = Instant::now();
        let mut removed = 0usize;
        for entry in self.idempotency.iter() {
            let (stored_at, _) = entry.value();
            if now.duration_since(*stored_at) > Self::IDEM_TTL
                && self.idempotency.remove(entry.key()).is_some()
            {
                removed += 1;
            }
        }
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
    pub fn channel_cache_gc(&self) {
        let now = Instant::now();
        let ttl = self.channel_cache_ttl;
        let mut purged = 0;
        for entry in self.channel_exists_cache.iter() {
            if now.duration_since(*entry.value()) >= ttl
                && self.channel_exists_cache.remove(entry.key()).is_some()
            {
                purged += 1;
            }
        }
        if purged > 0 {
            tracing::debug!(
                purged,
                remaining = self.channel_exists_cache.len(),
                "channel-exists cache GC"
            );
        }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::SessionUser;
    use uuid::Uuid;

    /// Build a fresh (non-singleton) hub for testing. The global hub() is a
    /// `OnceLock`-cached singleton, so to test concurrent operations in
    /// isolation we instantiate `ChatHub::new()` directly.
    fn fresh_hub() -> ChatHub {
        // Use a small global cap so the cap-rejection tests are meaningful
        // without each test needing to spin up 50_000 connections.
        ChatHub::with_limits(3, 60)
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

    // ── register / unregister ───────────────────────────────────

    #[test]
    fn register_returns_incrementing_ids() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id1 = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx);
        let (tx, _rx) = make_tx();
        let id2 = h.register(sample_user("u2", "user"), "1.1.1.1".into(), tx);
        let (tx, _rx) = make_tx();
        let id3 = h.register(sample_user("u3", "user"), "1.1.1.1".into(), tx);
        assert!(id2 > id1, "ids must be monotonic: {id1} {id2}");
        assert!(id3 > id2, "ids must be monotonic: {id2} {id3}");
    }

    #[test]
    fn register_then_unregister_removes_session() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx);
        assert!(h.user_of(id).is_some());
        let (user, channel) = h
            .unregister(id)
            .expect("unregister should return the session");
        assert_eq!(user.name, "User-u1");
        assert!(channel.is_none(), "no channel was set");
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
        let id = h.register(sample_user("u1", "user"), ip.into(), tx);
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
        let id = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx);
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
        let id = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx);
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
        let id = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx);
        h.join_room("room-a", id);
        // user_still_in_room excludes `except` from the search, so checking
        // the user's only socket against itself returns false. We use a
        // second socket to verify membership instead.
        let (tx2, _rx2) = make_tx();
        let id2 = h.register(sample_user("u2", "user"), "2.2.2.2".into(), tx2);
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

    // ── broadcast_to_room / broadcast_to_room_except ────────────

    #[test]
    fn broadcast_to_room_delivers_to_all_members() {
        let h = fresh_hub();
        let (tx1, mut rx1) = make_tx();
        let (tx2, mut rx2) = make_tx();
        let id1 = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx1);
        let id2 = h.register(sample_user("u2", "user"), "2.2.2.2".into(), tx2);
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
        let id1 = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx1);
        let id2 = h.register(sample_user("u2", "user"), "2.2.2.2".into(), tx2);
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
        let id = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx);
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
        let id1 = h.register(sample_user("uA", "user"), "1.1.1.1".into(), tx1);
        let id2 = h.register(sample_user("uA", "user"), "1.1.1.1".into(), tx2);
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
        let id = h.register(user, "1.1.1.1".into(), tx);
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

    #[test]
    #[ignore = "requires time manipulation; TTL-based idem_gc is covered by integration tests"]
    fn idem_gc_runs_when_entries_expired() {
        // Placeholder — would need a mock clock to test TTL expiry
        // without sleeping for 5 minutes in unit tests.
    }

    // ── user_of / channel_of /    // ── user_of / channel_of ────────────────────────────────────

    #[test]
    fn user_of_returns_user_for_known_id() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h.register(sample_user("u7", "user"), "1.1.1.1".into(), tx);
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
        let h = ChatHub::with_limits(0, 60);
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
        let id1 = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx);
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
        let id1 = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx1);
        let id2 = h.register(sample_user("u2", "user"), "2.2.2.2".into(), tx2);
        let mut ids = h.all_session_ids();
        ids.sort();
        assert_eq!(ids, vec![id1, id2]);
    }

    #[test]
    fn broadcast_to_room_raw_counts_deliveries() {
        let h = fresh_hub();
        let (tx1, _rx1) = make_tx();
        let (tx2, mut rx2) = make_tx();
        let id1 = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx1);
        let id2 = h.register(sample_user("u2", "user"), "2.2.2.2".into(), tx2);
        h.join_room("room", id1);
        h.join_room("room", id2);
        let n = h.broadcast_to_room_raw("room", r#"{\"type\":\"ping\"}"#);
        assert_eq!(n, 2, "both members must receive");
        // And the message actually arrived.
        let m = rx2.try_recv().expect("u2 must receive");
        assert!(std::str::from_utf8(&m).unwrap_or("").contains("ping"));
    }
}

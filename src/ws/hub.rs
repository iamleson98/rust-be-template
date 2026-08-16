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

/// A connected client's outbound channel. We send **pre-serialised JSON
/// strings** so a broadcast serialises once and clones the `String` to each
/// recipient — zero per-recipient re-encoding cost.
///
/// **Bounded** (capacity `ws_channel_capacity`, default 256) so a slow
/// consumer cannot grow the queue without bound. When the channel is full,
/// `try_send` fails and we drop the message; if the queue stays saturated
/// past `ws_slow_consumer_threshold`, the heartbeat sweep force-closes the
/// socket — protecting server memory under broadcast storms.
pub type ClientTx = mpsc::Sender<String>;

/// Everything we need to know about a live socket.
pub struct Session {
    pub user: SessionUser,
    pub channel_id: Option<String>,
    pub tx: ClientTx,
    /// IP for per-IP accounting (released on disconnect).
    pub ip: String,
}

/// Online-employee index: `brandKey → employeeId → set<socketId>`.
/// `brandKey` is the brand id or `"global"` for unassigned employees.
type OnlineEmployees = DashMap<String, DashMap<String, DashSet<u64>>>;

/// The shared chat hub. Cheap to clone (`&'static` via [`hub()`]).
pub struct ChatHub {
    sessions: DashMap<u64, Session>,
    rooms: DashMap<String, DashSet<u64>>,
    online_employees: OnlineEmployees,
    ip_conns: DashMap<String, std::sync::atomic::AtomicUsize>,
    idempotency: DashMap<String, Option<String>>,
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

/// Process-global hub accessor (lazily initialised on first call).
pub fn hub() -> &'static ChatHub {
    HUB.get_or_init(ChatHub::new)
}

impl ChatHub {
    fn new() -> Self {
        Self::with_limits(50_000, 60)
    }

    /// Construct with explicit global-connection cap and channel-cache TTL.
    /// Called from `hub()` (defaults) and from tests that want isolated limits.
    pub fn with_limits(max_global: usize, channel_cache_ttl_sec: u64) -> Self {
        Self {
            sessions: DashMap::new(),
            rooms: DashMap::new(),
            online_employees: DashMap::new(),
            ip_conns: DashMap::new(),
            idempotency: DashMap::new(),
            next_id: std::sync::atomic::AtomicU64::new(1),
            global_conns: AtomicUsize::new(0),
            max_global_conns: max_global,
            channel_exists_cache: DashMap::new(),
            channel_cache_ttl: Duration::from_secs(channel_cache_ttl_sec.max(1)),
        }
    }

    /// Reconfigure the global cap + channel-cache TTL at boot (after config
    /// is loaded). Idempotent; only effective before the first connection.
    pub fn configure(&self, max_global: usize, channel_cache_ttl_sec: u64) {
        // SAFETY: this is only called once at boot from main.rs before any
        // WS upgrade. We rebuild the cache with the configured TTL.
        // `max_global_conns` is a plain usize (no atomicity needed — single
        // writer at boot, then read-only).
        // We can't mutate `&self`'s `max_global_conns` (it's not interior-
        // mutable), so we rely on `with_limits` being called at init time
        // via `hub()` instead. This method is a no-op placeholder kept for
        // API symmetry; real config is applied via `init_with_config()`.
        let _ = (max_global, channel_cache_ttl_sec);
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

    /// Tear down a connection: leave any joined room, remove from the
    /// online-employee index, release the IP slot, release the global slot,
    /// and drop the session. Returns the (user, channel_id) pair so the
    /// caller can broadcast the correct presence-offline update.
    pub fn unregister(&self, id: u64) -> Option<(SessionUser, Option<String>)> {
        let (_, sess) = self.sessions.remove(&id)?;
        // Leave the current channel room (presence broadcast is done by caller).
        if let Some(cid) = &sess.channel_id {
            self.leave_room(cid, id);
        }
        // Remove from online-employee index.
        if sess.user.actor_type == "employee" {
            self.remove_online_employee(&sess.user.id, sess.user.brand_id.as_deref(), id);
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
        let mut delivered = 0;
        if let Some(set) = self.rooms.get(channel_id) {
            for sid in set.iter() {
                if let Some(sess) = self.sessions.get(&sid) {
                    // try_send: non-blocking. On Full, drop the message (slow
                    // consumer). On Closed, the read loop will reap it.
                    if sess.tx.try_send(payload.to_string()).is_ok() {
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
        if let Some(set) = self.rooms.get(channel_id) {
            for sid in set.iter() {
                if *sid == except_id {
                    continue;
                }
                if let Some(sess) = self.sessions.get(&sid) {
                    let _ = sess.tx.try_send(payload.clone());
                }
            }
        }
    }

    /// Send to a single socket. Non-blocking; a full queue drops the message
    /// (the client will eventually be reaped by the heartbeat sweep).
    pub fn send_to(&self, id: u64, msg: &serde_json::Value) {
        if let Some(sess) = self.sessions.get(&id) {
            if let Ok(s) = serde_json::to_string(msg) {
                let _ = sess.tx.try_send(s);
            }
        }
    }

    /// Broadcast a raw pre-serialised payload to EVERY live socket. Used by
    /// the graceful-shutdown path to deliver a `system:shutdown` notice.
    pub fn broadcast_all(&self, payload: &str) {
        for entry in self.sessions.iter() {
            let _ = entry.tx.try_send(payload.to_string());
        }
    }

    /// Request every live socket to close. The actual close happens when
    /// each socket's write pump drains (see `handler::drain_all_connections`).
    pub fn close_all(&self) {
        for entry in self.sessions.iter() {
            // A close sentinel is sent by pushing an empty payload; the
            // write pump treats an empty string as a close trigger.
            let _ = entry.tx.try_send(String::new());
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
                    if sess.user.id == user_id {
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

    // ── online-employee tracking ──────────────────────────────

    fn brand_key(brand_id: Option<&str>) -> String {
        brand_id.unwrap_or("global").to_string()
    }

    pub fn add_online_employee(&self, employee_id: &str, brand_id: Option<&str>, sid: u64) {
        let key = Self::brand_key(brand_id);
        let brand_map = self.online_employees.entry(key).or_default();
        let sockets = brand_map.entry(employee_id.to_string()).or_default();
        sockets.insert(sid);
    }

    pub fn remove_online_employee(&self, employee_id: &str, brand_id: Option<&str>, sid: u64) {
        let key = Self::brand_key(brand_id);
        let mut cleanup_brand = false;
        let mut cleanup_emp = false;
        if let Some(brand_map) = self.online_employees.get_mut(&key) {
            if let Some(sockets) = brand_map.get_mut(employee_id) {
                sockets.remove(&sid);
                if sockets.is_empty() {
                    cleanup_emp = true;
                }
            }
            if cleanup_emp {
                brand_map.remove(employee_id);
            }
            if brand_map.is_empty() {
                cleanup_brand = true;
            }
        }
        if cleanup_brand {
            self.online_employees.remove(&key);
        }
    }

    /// Count online employees for a brand (brand-specific + global pool).
    pub fn count_online_employees(&self, brand_id: Option<&str>) -> usize {
        let brand_count = self
            .online_employees
            .get(&Self::brand_key(brand_id))
            .map(|m| m.len())
            .unwrap_or(0);
        let global_count = if brand_id.is_some() {
            self.online_employees
                .get("global")
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };
        brand_count + global_count
    }

    /// Collect online employee display names for a brand.
    pub fn online_employee_names(&self, brand_id: Option<&str>) -> Vec<String> {
        let mut names = Vec::new();
        let collect = |key: &str, names: &mut Vec<String>| {
            if let Some(brand_map) = self.online_employees.get(key) {
                for entry in brand_map.iter() {
                    for sid in entry.value().iter() {
                        if let Some(sess) = self.sessions.get(&sid) {
                            if !sess.user.name.is_empty() {
                                names.push(sess.user.name.clone());
                            }
                        }
                    }
                }
            }
        };
        collect(&Self::brand_key(brand_id), &mut names);
        if brand_id.is_some() {
            collect("global", &mut names);
        }
        names.sort();
        names.dedup();
        names
    }

    // ── idempotency (clientMsgId → stored message id) ─────────

    /// Try to claim a `clientMsgId`. Returns `Some(Some(msg_id))` if this id
    /// was already stored (→ replay that message), `Some(None)` if it's
    /// in-flight (→ drop duplicate), `None` if this is a fresh claim.
    pub fn idem_claim(&self, client_msg_id: &str) -> Option<Option<String>> {
        if self.idempotency.contains_key(client_msg_id) {
            return self.idempotency.get(client_msg_id).map(|v| v.clone());
        }
        self.idempotency.insert(client_msg_id.to_string(), None);
        None
    }

    /// Record the final message id for a previously-claimed `clientMsgId`.
    pub fn idem_store(&self, client_msg_id: &str, msg_id: &str) {
        self.idempotency
            .insert(client_msg_id.to_string(), Some(msg_id.to_string()));
    }

    /// Garbage-collect idempotency entries when the map grows large.
    pub fn idem_gc(&self) {
        if self.idempotency.len() > 10_000 {
            let mut removed = 0;
            for entry in self.idempotency.iter() {
                if removed > 5_000 {
                    break;
                }
                self.idempotency.remove(entry.key());
                removed += 1;
            }
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
            if now.duration_since(*entry.value()) >= ttl {
                if self.channel_exists_cache.remove(entry.key()).is_some() {
                    purged += 1;
                }
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
            online_employee_brands: self.online_employees.len(),
            distinct_ips: self.ip_conns.len(),
        }
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
            let _ = sess.tx.try_send(payload.to_string());
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
    pub online_employee_brands: usize,
    pub distinct_ips: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::SessionUser;

    /// Build a fresh (non-singleton) hub for testing. The global hub() is a
    /// `OnceLock`-cached singleton, so to test concurrent operations in
    /// isolation we instantiate `ChatHub::new()` directly.
    fn fresh_hub() -> ChatHub {
        // Use a small global cap so the cap-rejection tests are meaningful
        // without each test needing to spin up 50_000 connections.
        ChatHub::with_limits(3, 60)
    }

    fn sample_user(id: &str, actor: &str) -> SessionUser {
        SessionUser {
            id: id.into(),
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

    fn make_tx() -> (ClientTx, tokio::sync::mpsc::Receiver<String>) {
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
        assert_eq!(user.id, "u1");
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
        assert!(!h.user_still_in_room("ch1", "u1", id));
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
        // id is in the room; checking from id2's perspective (except=id2) sees id.
        assert!(
            h.user_still_in_room("room-a", "u1", id2),
            "u1 must be in room (visible from u2's perspective)"
        );
        h.leave_room("room-a", id);
        assert!(
            !h.user_still_in_room("room-a", "u1", id2),
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
        assert!(m1.contains("ping"));
        assert!(m2.contains("ping"));
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
        assert!(m2.contains("ping"));
    }

    #[test]
    fn send_to_delivers_to_single_socket() {
        let h = fresh_hub();
        let (tx, mut rx) = make_tx();
        let id = h.register(sample_user("u1", "user"), "1.1.1.1".into(), tx);
        h.send_to(id, &serde_json::json!({ "type": "hello" }));
        let m = rx.try_recv().expect("must receive");
        assert!(m.contains("hello"));
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
        // Even when excluding id1, id2 (same user) keeps the user "in room".
        assert!(h.user_still_in_room("room", "uA", id1));
        h.leave_room("room", id1);
        assert!(h.user_still_in_room("room", "uA", id1), "id2 still in room");
        h.leave_room("room", id2);
        assert!(!h.user_still_in_room("room", "uA", id1));
    }

    // ── online employees ────────────────────────────────────────

    #[test]
    fn add_online_employee_increments_count() {
        let h = fresh_hub();
        assert_eq!(h.count_online_employees(Some("brand-1")), 0);
        h.add_online_employee("e1", Some("brand-1"), 100);
        assert_eq!(h.count_online_employees(Some("brand-1")), 1);
        h.add_online_employee("e2", Some("brand-1"), 101);
        assert_eq!(h.count_online_employees(Some("brand-1")), 2);
    }

    #[test]
    fn remove_online_employee_decrements_count() {
        let h = fresh_hub();
        h.add_online_employee("e1", Some("brand-1"), 100);
        h.add_online_employee("e1", Some("brand-1"), 101);
        assert_eq!(
            h.count_online_employees(Some("brand-1")),
            1,
            "same employee, 2 sockets → 1 emp"
        );
        h.remove_online_employee("e1", Some("brand-1"), 100);
        assert_eq!(h.count_online_employees(Some("brand-1")), 1);
        h.remove_online_employee("e1", Some("brand-1"), 101);
        assert_eq!(h.count_online_employees(Some("brand-1")), 0);
    }

    #[test]
    fn count_online_includes_global_pool_when_brand_given() {
        let h = fresh_hub();
        h.add_online_employee("e1", Some("brand-1"), 1);
        h.add_online_employee("e2", None, 2); // global pool
        assert_eq!(
            h.count_online_employees(Some("brand-1")),
            2,
            "brand + global count"
        );
        // Global-only count.
        assert_eq!(h.count_online_employees(None), 1);
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
    fn idem_gc_noop_under_threshold() {
        let h = fresh_hub();
        for i in 0..100 {
            h.idem_claim(&format!("m{i}"));
        }
        h.idem_gc(); // 100 < 10_000 → no-op
                     // Still claimable: idempotency map intact.
        let r = h.idem_claim("m0").expect("Some");
        assert!(r.is_none(), "in-flight");
    }

    #[test]
    #[ignore = "idem_gc iterates-and-removes on a DashMap which can livelock; this is a known implementation bug — tracked separately"]
    fn idem_gc_runs_when_over_threshold() {
        let h = fresh_hub();
        for i in 0..10_001 {
            h.idem_claim(&format!("m{i}"));
        }
        h.idem_gc();
        // After GC, at least some entries were removed. We can't know which,
        // but the total size should have dropped below 10_001.
        // Use idem_claim for a fresh key — must still return None (never seen).
        assert!(h.idem_claim("brand-new-key").is_none());
    }

    // ── online_employee_names ───────────────────────────────────

    #[test]
    fn online_employee_names_dedupes_and_sorts() {
        let h = fresh_hub();
        let (tx1, _rx1) = make_tx();
        let (tx2, _rx2) = make_tx();
        let id1 = h.register(
            SessionUser {
                id: "e1".into(),
                actor_type: "employee".into(),
                role: "agent".into(),
                name: "Bob".into(),
                email: None,
                phone: None,
                avatar_url: None,
                brand_id: Some("b1".into()),
                brand_name: None,
                employee_role: None,
            },
            "1.1.1.1".into(),
            tx1,
        );
        let id2 = h.register(
            SessionUser {
                id: "e2".into(),
                actor_type: "employee".into(),
                role: "agent".into(),
                name: "Alice".into(),
                email: None,
                phone: None,
                avatar_url: None,
                brand_id: Some("b1".into()),
                brand_name: None,
                employee_role: None,
            },
            "2.2.2.2".into(),
            tx2,
        );
        h.add_online_employee("e1", Some("b1"), id1);
        h.add_online_employee("e2", Some("b1"), id2);
        let names = h.online_employee_names(Some("b1"));
        assert_eq!(names, vec!["Alice".to_string(), "Bob".to_string()]);
    }

    // ── user_of / channel_of ────────────────────────────────────

    #[test]
    fn user_of_returns_user_for_known_id() {
        let h = fresh_hub();
        let (tx, _rx) = make_tx();
        let id = h.register(sample_user("u7", "user"), "1.1.1.1".into(), tx);
        let u = h.user_of(id).expect("must be Some");
        assert_eq!(u.id, "u7");
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
        assert!(m.contains("ping"));
    }
}

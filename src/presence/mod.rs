//! Staff presence — the single source of truth for "which staff members
//! are online / busy / available" across the chat + audio-call systems.
//!
//! ## Why a separate module
//!
//! The chat hub (`ws::hub`) and the audio-call hub (`audio_call::hub`)
//! each used to keep their OWN notion of "who is online" — the chat hub
//! had `online_employees` (brand → employee → chat sockets) and the call
//! hub had its peer map with `in_call` flags. That split made the
//! routing rules the product spec asks for impossible to express:
//!
//!   - "redirect calls to an employee that is logged in, but NOT busy
//!     in chats/call" — needs chat-load AND call state together;
//!   - "auto-assign the most available person when a user starts a chat"
//!     — needs a comparable load metric across every staff socket;
//!   - "the bot handles chat when no employee/admin is online" — needs
//!     ONE online count, not two.
//!
//! `PresenceHub` aggregates both socket families (chat WS + call WS)
//! plus live load (active chat assignments) and call state into one
//! process-wide registry. Both hubs feed it; all routing decisions read
//! from it.
//!
//! ## State machine per staff member
//!
//! ```text
//!  (gone) ──chat/call socket──▶ ONLINE ──last socket drops──▶ (gone)
//!              │                    │
//!              │                    ├─ in_call=true ──▶ BUSY (calls)
//!              │                    └─ active_chats++ ── loaded (chats)
//!  available == online && !in_call
//! ```
//!
//! ## Concurrency
//!
//! `DashMap<String, StaffEntry>` — lock-free sharded reads/writes, same
//! pattern as both WS hubs. Process-local singleton (`OnceLock`);
//! horizontal scaling would move this to Redis (same as the hubs).
//!
//! ## Cache + DB design ("active state of users")
//!
//! The DashMap registry above is the CACHE half — the hot, live truth
//! every routing decision reads (never blocks on the DB). The DB half
//! is `staff_presence_state`, written by a debounced JOURNAL task:
//!
//!   * hub mutations emit a tiny event on a lock-free channel
//!     (`try_send` — presence durability is best-effort, never a
//!     reason to block a socket handler);
//!   * the journal coalesces events per user (keep-latest) and flushes
//!     at most one upsert per user per 5s window;
//!   * a slow heartbeat (60s) bumps `last_seen_at` for long-online
//!     members;
//!   * the journal also maintains the OFFLINE roster cache (DB read
//!     refreshed every 30s) so `staff_json` / the REST endpoint can
//!     render "last seen X" entries synchronously without touching
//!     the DB on the request path.
//!
//! Result: correct live state (cache), durable last-seen across
//! restarts (DB), and bounded DB traffic regardless of socket churn.
//!
//! ## Staleness defense
//!
//! Sockets are reference-counted (`chat_sockets` / `call_sockets` sets);
//! an entry only disappears when its LAST socket disconnects. A
//! background sweeper (`spawn_sweeper`) additionally drops entries whose
//! socket sets are somehow empty (a missed disconnect) after a grace
//! period — belt and braces so a leaked entry can never keep a staff
//! member "online" forever.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use uuid::Uuid;

use crate::auth::SessionUser;
use crate::store::{StaffPresenceStore, StaffPresenceUpsert};

/// How long an entry with zero sockets lingers before the sweeper drops it.
const EMPTY_GRACE: Duration = Duration::from_secs(30);
/// Sweeper cadence.
const SWEEP_INTERVAL: Duration = Duration::from_secs(15);
/// Journal flush cadence — coalesced upserts land at most this often.
const JOURNAL_FLUSH: Duration = Duration::from_secs(5);
/// Heartbeat cadence for long-online members (`last_seen_at` bumps).
const JOURNAL_HEARTBEAT: Duration = Duration::from_secs(60);
/// How far back the offline roster reaches ("recently active").
const OFFLINE_LOOKBACK: Duration = Duration::from_secs(7 * 24 * 3600);
/// Offline-roster cache refresh cadence.
const OFFLINE_REFRESH: Duration = Duration::from_secs(30);
/// Offline roster size cap (newest first).
const OFFLINE_LIMIT: u64 = 50;

/// One staff member's last-known presence, mirrored to the DB by the
/// journal. Small + `Clone` so it can ride a lock-free channel.
#[derive(Clone, Debug)]
struct JournalEvent {
    user_id: Uuid,
    name: String,
    role: String,
    brand_id: Option<Uuid>,
    online: bool,
    last_seen_at: String,
    last_online_at: Option<String>,
}

/// One offline roster entry (DB-backed, served from the cache).
#[derive(Clone, Debug)]
pub struct OfflineStaff {
    pub user_id: String,
    pub name: String,
    pub role: String,
    pub brand_id: Option<String>,
    pub last_seen_at: String,
    pub last_online_at: Option<String>,
}

/// Journal channel — `None` until `spawn_journal` runs (unit tests that
/// construct a bare `PresenceHub` simply never emit).
static JOURNAL: OnceLock<tokio::sync::mpsc::UnboundedSender<JournalEvent>> = OnceLock::new();

/// Offline-roster cache, refreshed by the journal task. Empty until the
/// first refresh — callers treat "no cache yet" as "no offline entries"
/// (the online roster is authoritative in that window).
static OFFLINE_CACHE: RwLock<Vec<OfflineStaff>> = RwLock::new(Vec::new());

/// Sequence counter for journal emissions — one bump per flush keeps
/// coalescing deterministic under contention (tests).
static JOURNAL_EPOCH: AtomicU64 = AtomicU64::new(0);

/// Live state of one staff member (employee or admin).
#[derive(Clone, Debug)]
pub struct StaffEntry {
    pub user_id: String,
    pub name: String,
    /// `"employee"` or `"admin"` — admins are full support agents too.
    pub role: String,
    /// Brand scope. `None` = global staff (matches every brand).
    pub brand_id: Option<String>,
    /// Chat-WS socket ids currently connected for this user.
    pub chat_sockets: HashSet<u64>,
    /// Audio-call-WS socket ids currently connected for this user.
    pub call_sockets: HashSet<u64>,
    /// Number of channels currently assigned to (or implicitly owned by)
    /// this staff member — the chat load metric.
    pub active_chats: u64,
    /// Currently handling an audio call.
    pub in_call: bool,
    pub last_seen: Instant,
    /// RFC3339 wall-clock of the last presence activity. Mirrors
    /// `last_seen` (Instant) for payload rendering — Instant is not
    /// serializable and has no meaning across processes.
    pub last_seen_at: String,
    /// When this member was last chosen for an assignment. Used as the
    /// load-balancing tie-break (least-recently-assigned wins) so two
    /// equally-loaded staff alternate instead of coin-flipping.
    pub last_assigned: Option<Instant>,
}

impl StaffEntry {
    /// Online = at least one live socket on either hub.
    pub fn online(&self) -> bool {
        !self.chat_sockets.is_empty() || !self.call_sockets.is_empty()
    }

    /// Busy = in an active audio call (call state is exclusive; chat load
    /// is a *scoring* input, not a hard busy flag — an employee with 3
    /// open chats is busy-er than one with 0, but still reachable).
    pub fn busy(&self) -> bool {
        self.in_call
    }

    /// Available = online and not in a call.
    pub fn available(&self) -> bool {
        self.online() && !self.in_call
    }

    /// Chat-load score for pick ordering (lower = more available).
    pub fn load_score(&self) -> u64 {
        self.active_chats
    }

    /// Shared ordering for "most available" comparisons (lower sorts
    /// first): chat load → last-assigned recency → employees-before-
    /// admins → name. Available-only filtering is the caller's job.
    /// Exposed so other hubs (audio-call) reuse the exact ranking.
    pub fn availability_cmp(a: &StaffEntry, b: &StaffEntry) -> std::cmp::Ordering {
        a.load_score()
            .cmp(&b.load_score())
            .then_with(|| a.last_assigned.cmp(&b.last_assigned))
            .then_with(|| {
                let a_admin = a.role == "admin";
                let b_admin = b.role == "admin";
                a_admin.cmp(&b_admin)
            })
            .then_with(|| a.name.cmp(&b.name))
    }

    /// Does this member serve `brand_id`? Global (`brand_id == None`)
    /// staff serve every brand.
    pub fn serves_brand(&self, brand_id: Option<&str>) -> bool {
        match (self.brand_id.as_deref(), brand_id) {
            (None, _) => true, // global staff
            (Some(b), Some(target)) => b == target,
            (Some(_), None) => true, // brand-less query sees everyone
        }
    }
}

/// The process-wide presence registry.
pub struct PresenceHub {
    staff: DashMap<String, StaffEntry>,
}

static PRESENCE: OnceLock<PresenceHub> = OnceLock::new();

/// Process-global accessor.
pub fn presence() -> &'static PresenceHub {
    PRESENCE.get_or_init(PresenceHub::new)
}

impl PresenceHub {
    fn new() -> Self {
        Self {
            staff: DashMap::new(),
        }
    }

    // ── Mutations (called by the hubs) ──────────────────────────

    fn entry_for(&self, user: &SessionUser) -> StaffEntry {
        StaffEntry {
            user_id: user.id.to_string(),
            name: user.name.clone(),
            role: user.actor_type.clone(),
            brand_id: user.brand_id.map(|id| id.to_string()),
            chat_sockets: HashSet::new(),
            call_sockets: HashSet::new(),
            active_chats: 0,
            in_call: false,
            last_seen: Instant::now(),
            last_seen_at: now_rfc3339(),
            last_assigned: None,
        }
    }

    /// Mirror a mutation to the DB journal (best-effort, never blocks:
    /// tokio's unbounded sender is a lock-free enqueue; `send` only
    /// fails once the receiver is dropped, i.e. during shutdown).
    fn journal_emit(user_id: &str, entry: &StaffEntry, online: bool) {
        let Some(tx) = JOURNAL.get() else { return };
        let Ok(uid) = Uuid::parse_str(user_id) else {
            return;
        };
        let _ = tx.send(JournalEvent {
            user_id: uid,
            name: entry.name.clone(),
            role: entry.role.clone(),
            brand_id: entry
                .brand_id
                .as_deref()
                .and_then(|b| Uuid::parse_str(b).ok()),
            online,
            last_seen_at: entry.last_seen_at.clone(),
            // The journal upsert keeps the stored `last_online_at`
            // when `None` (a heartbeat / offline bump does not erase
            // the last online stint); a fresh online transition sets it.
            last_online_at: online.then(|| entry.last_seen_at.clone()),
        });
    }

    /// A staff member connected a chat-WS socket. Only call for
    /// `user.is_staff()` sessions.
    pub fn chat_socket_connected(&self, user: &SessionUser, sid: u64) {
        let mut entry = self
            .staff
            .entry(user.id.to_string())
            .or_insert_with(|| self.entry_for(user));
        let went_online = !entry.online();
        entry.chat_sockets.insert(sid);
        entry.last_seen = Instant::now();
        entry.last_seen_at = now_rfc3339();
        // Refresh the display name — it may have changed since boot.
        entry.name = user.name.clone();
        if went_online {
            Self::journal_emit(&entry.user_id, &entry, true);
        }
    }

    /// A staff member's chat-WS socket went away. Removes the whole
    /// entry when the last socket of both families is gone.
    pub fn chat_socket_disconnected(&self, user_id: &str, sid: u64) {
        if let Some(mut entry) = self.staff.get_mut(user_id) {
            entry.chat_sockets.remove(&sid);
            entry.last_seen = Instant::now();
            entry.last_seen_at = now_rfc3339();
            if entry.chat_sockets.is_empty() && entry.call_sockets.is_empty() {
                let snapshot = entry.clone();
                drop(entry);
                self.staff.remove(user_id);
                Self::journal_emit(user_id, &snapshot, false);
            }
        }
    }

    /// A staff member registered as a call agent (call-WS socket).
    pub fn call_socket_connected(&self, user: &SessionUser, sid: u64) {
        let mut entry = self
            .staff
            .entry(user.id.to_string())
            .or_insert_with(|| self.entry_for(user));
        let went_online = !entry.online();
        entry.call_sockets.insert(sid);
        entry.last_seen = Instant::now();
        entry.last_seen_at = now_rfc3339();
        entry.name = user.name.clone();
        if went_online {
            Self::journal_emit(&entry.user_id, &entry, true);
        }
    }

    /// A staff member's call-WS socket went away. Also clears their
    /// in-call flag (a disconnected agent cannot still be in a call).
    pub fn call_socket_disconnected(&self, user_id: &str, sid: u64) {
        if let Some(mut entry) = self.staff.get_mut(user_id) {
            entry.call_sockets.remove(&sid);
            entry.in_call = false;
            entry.last_seen = Instant::now();
            entry.last_seen_at = now_rfc3339();
            if entry.chat_sockets.is_empty() && entry.call_sockets.is_empty() {
                let snapshot = entry.clone();
                drop(entry);
                self.staff.remove(user_id);
                Self::journal_emit(user_id, &snapshot, false);
            }
        }
    }

    /// Mark a staff member as (not) currently in an audio call.
    /// No-op for unknown users (they can't be in a call).
    pub fn set_in_call(&self, user_id: &str, in_call: bool) {
        if let Some(mut entry) = self.staff.get_mut(user_id) {
            entry.in_call = in_call;
            entry.last_seen = Instant::now();
            entry.last_seen_at = now_rfc3339();
        }
    }

    /// Adjust the active-chat load (`+1` on assignment / implicit admin
    /// ownership, `-1` on release/close).
    pub fn adjust_active_chats(&self, user_id: &str, delta: i64) {
        if let Some(mut entry) = self.staff.get_mut(user_id) {
            if delta >= 0 {
                entry.active_chats = entry.active_chats.saturating_add(delta as u64);
            } else {
                entry.active_chats = entry.active_chats.saturating_sub((-delta) as u64);
            }
            entry.last_seen = Instant::now();
            entry.last_seen_at = now_rfc3339();
        }
    }

    /// Record that this member was chosen for an assignment (resets the
    /// load-balancing clock).
    pub fn mark_assigned(&self, user_id: &str) {
        if let Some(mut entry) = self.staff.get_mut(user_id) {
            entry.last_assigned = Some(Instant::now());
        }
    }

    /// Drop a member entirely (used by tests + admin force-offline).
    pub fn remove(&self, user_id: &str) {
        self.staff.remove(user_id);
    }

    // ── Queries (used by routing decisions + dashboards) ────────

    /// Snapshot one member's state.
    pub fn get(&self, user_id: &str) -> Option<StaffEntry> {
        self.staff.get(user_id).map(|e| e.value().clone())
    }

    /// Is this staff member online (any socket)?
    pub fn is_online(&self, user_id: &str) -> bool {
        self.staff.get(user_id).is_some_and(|e| e.value().online())
    }

    /// All staff entries in brand scope (brand staff + global staff).
    pub fn snapshot(&self, brand_id: Option<&str>) -> Vec<StaffEntry> {
        self.staff
            .iter()
            .filter(|e| e.value().serves_brand(brand_id))
            .map(|e| e.value().clone())
            .collect()
    }

    /// Count of ONLINE staff in brand scope (bot fallback signal:
    /// zero online ⇒ the NullClaw bot owns the chat).
    pub fn online_count(&self, brand_id: Option<&str>) -> usize {
        self.snapshot(brand_id)
            .iter()
            .filter(|s| s.online())
            .count()
    }

    /// Count of AVAILABLE (online, not in a call) staff in brand scope.
    pub fn available_count(&self, brand_id: Option<&str>) -> usize {
        self.snapshot(brand_id)
            .iter()
            .filter(|s| s.available())
            .count()
    }

    /// Pick the best available staff member for a new chat/call in
    /// `brand_id` scope.
    ///
    /// Ordering (the "most available person"):
    ///   1. not busy (available),
    ///   2. lowest chat load (`active_chats`),
    ///   3. least-recently assigned (round-robin under equal load),
    ///   4. employees before admins — assigning an employee produces a
    ///      real `chat_assignment` row and takes work off the admin's
    ///      queue; the admin is the implicit owner of everything anyway.
    ///
    /// Returns `None` when nobody (staff) is online and available.
    pub fn pick_best_available(&self, brand_id: Option<&str>) -> Option<StaffEntry> {
        let mut candidates: Vec<StaffEntry> = self
            .snapshot(brand_id)
            .into_iter()
            .filter(|s| s.available())
            .collect();
        candidates.sort_by(StaffEntry::availability_cmp);
        candidates.into_iter().next()
    }

    /// Should the NullClaw bot take over support for this brand?
    /// (Yes when no staff at all is online.)
    pub fn bot_active(&self, brand_id: Option<&str>) -> bool {
        self.online_count(brand_id) == 0
    }

    /// JSON snapshot for the `staff_presence` WS broadcast + the
    /// `/api/presence/staff` REST endpoint. Deterministically ordered.
    ///
    /// Payload (camelCase, additive over time):
    ///   * `staff` — live entries with `lastSeenAt` (cache);
    ///   * `offline` — recently-active-but-offline members with durable
    ///     `lastSeenAt` (DB cache, refreshed by the journal).
    pub fn staff_json(&self, brand_id: Option<&str>) -> serde_json::Value {
        let mut list: Vec<StaffEntry> = self.snapshot(brand_id);
        list.sort_by(|a, b| {
            // online first, then by name for stable UX.
            b.online()
                .cmp(&a.online())
                .then_with(|| a.name.cmp(&b.name))
        });
        let staff: Vec<serde_json::Value> = list
            .iter()
            .map(|s| {
                serde_json::json!({
                    "userId": s.user_id,
                    "name": s.name,
                    "role": s.role,
                    "brandId": s.brand_id,
                    "online": s.online(),
                    "available": s.available(),
                    "busy": s.busy(),
                    "inCall": s.in_call,
                    "activeChats": s.active_chats,
                    "lastSeenAt": s.last_seen_at,
                })
            })
            .collect();
        let offline: Vec<serde_json::Value> = offline_roster(brand_id)
            .into_iter()
            .map(|o| {
                serde_json::json!({
                    "userId": o.user_id,
                    "name": o.name,
                    "role": o.role,
                    "brandId": o.brand_id,
                    "lastSeenAt": o.last_seen_at,
                    "lastOnlineAt": o.last_online_at,
                })
            })
            .collect();
        serde_json::json!({
            "type": "staff_presence",
            "staff": staff,
            "offline": offline,
            "onlineCount": self.online_count(brand_id),
            "availableCount": self.available_count(brand_id),
            "botActive": self.bot_active(brand_id),
        })
    }

    /// Drop entries that have zero sockets and have been idle past the
    /// grace period (missed-disconnect defense). Returns the number of
    /// purged entries.
    pub fn sweep(&self) -> usize {
        let now = Instant::now();
        let stale: Vec<String> = self
            .staff
            .iter()
            .filter(|e| {
                let v = e.value();
                v.chat_sockets.is_empty()
                    && v.call_sockets.is_empty()
                    && now.duration_since(v.last_seen) > EMPTY_GRACE
            })
            .map(|e| e.key().clone())
            .collect();
        let n = stale.len();
        for id in stale {
            self.staff.remove(&id);
        }
        n
    }

    /// Entry count (tests / metrics).
    pub fn len(&self) -> usize {
        self.staff.len()
    }

    /// True when no staff entries exist at all.
    pub fn is_empty(&self) -> bool {
        self.staff.is_empty()
    }
}

/// Spawn the background sweeper (called once from `server.rs` bootstrap,
/// next to the WS hub's `spawn_idem_gc`).
pub fn spawn_sweeper() {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(SWEEP_INTERVAL);
        tick.tick().await; // consume the immediate first tick
        loop {
            tick.tick().await;
            let purged = presence().sweep();
            if purged > 0 {
                tracing::info!(purged, "presence sweeper removed stale entries");
            }
        }
    });
}

// ────────────────────────────────────────────────────────────────
//  DB journal (cache + DB design — see the module docs)
// ────────────────────────────────────────────────────────────────

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Clone of the offline-roster cache, brand-scoped. Sync + never blocks:
/// the journal task refreshes the cache on a timer so the request path
/// (WS broadcast + REST) stays lock-free-cheap.
pub fn offline_roster(brand_id: Option<&str>) -> Vec<OfflineStaff> {
    let guard = OFFLINE_CACHE.read().unwrap_or_else(|e| e.into_inner());
    guard
        .iter()
        .filter(|o| match (o.brand_id.as_deref(), brand_id) {
            (None, _) => true, // global staff serve every brand
            (Some(b), Some(target)) => b == target,
            (Some(_), None) => true, // brand-less query sees everyone
        })
        .cloned()
        .collect()
}

/// Number of cache-refresh cycles performed (tests / metrics).
pub fn journal_cycles() -> u64 {
    JOURNAL_EPOCH.load(Ordering::Relaxed)
}

/// Refresh the offline-roster cache from the DB (called by the journal
/// task; also safe to call directly in tests). Excludes members that
/// the LIVE registry currently reports online — the cache only holds
/// the "recently active but offline" complement.
async fn refresh_offline_cache(store: &dyn StaffPresenceStore) {
    let since = (chrono::Utc::now()
        - chrono::Duration::from_std(OFFLINE_LOOKBACK)
            .unwrap_or_else(|_| chrono::Duration::seconds(0)))
    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let rows = match store.list_recently_active(&since, OFFLINE_LIMIT).await {
        Ok(rows) => rows,
        Err(e) => {
            // The team board must keep working when the DB hiccups —
            // keep the previous cache and retry on the next cycle.
            tracing::warn!(error = %e, "presence offline-roster refresh failed");
            return;
        }
    };
    let online_ids: HashSet<String> = presence()
        .snapshot(None)
        .into_iter()
        .filter(|s| s.online())
        .map(|s| s.user_id)
        .collect();
    let roster: Vec<OfflineStaff> = rows
        .into_iter()
        .filter(|r| !online_ids.contains(&r.user_id.to_string()) && r.online == 0)
        .map(|r| OfflineStaff {
            user_id: r.user_id.to_string(),
            name: r.name,
            role: r.role,
            brand_id: r.brand_id.map(|b| b.to_string()),
            last_seen_at: r.last_seen_at,
            last_online_at: r.last_online_at,
        })
        .collect();
    let mut guard = OFFLINE_CACHE.write().unwrap_or_else(|e| e.into_inner());
    *guard = roster;
    JOURNAL_EPOCH.fetch_add(1, Ordering::Relaxed);
}

/// Spawn the DB journal (called once from `server.rs` bootstrap).
///
/// Design (bounded DB traffic, "cache + db" reliability):
///   * every hub mutation lands on a lock-free channel (never blocks
///     a socket handler);
///   * a 5s flush coalesces pending events per user (keep-latest —
///     the last state in the window wins) and upserts them;
///   * a 60s heartbeat bumps `last_seen_at` for members still online
///     (a long-online agent should not look "last seen an hour ago"
///     just because nothing transitioned);
///   * a 30s DB read refreshes the offline-roster cache.
pub fn spawn_journal(store: std::sync::Arc<dyn StaffPresenceStore>) {
    use std::collections::HashMap;
    use tokio::sync::mpsc::unbounded_channel;

    let (tx, mut rx) = unbounded_channel::<JournalEvent>();
    // First initializer wins; a second bootstrap (tests) reuses the
    // existing channel — events then flow to THIS task, which holds a
    // fresh store handle.
    let _ = JOURNAL.set(tx);

    tokio::spawn(async move {
        let mut pending: HashMap<Uuid, JournalEvent> = HashMap::new();
        let mut flush = tokio::time::interval(JOURNAL_FLUSH);
        flush.tick().await; // consume the immediate first tick
        let mut heartbeat = tokio::time::interval(JOURNAL_HEARTBEAT);
        heartbeat.tick().await;
        let mut roster = tokio::time::interval(OFFLINE_REFRESH);
        roster.tick().await;
        loop {
            tokio::select! {
                ev = rx.recv() => {
                    match ev {
                        Some(ev) => {
                            // Keep-latest coalescing: a connect followed
                            // by a disconnect inside one window collapses
                            // to the final state (one upsert, not two).
                            pending.insert(ev.user_id, ev);
                        }
                        None => break, // sender dropped (shutdown)
                    }
                }
                _ = flush.tick() => {
                    if pending.is_empty() { continue; }
                    let batch: Vec<JournalEvent> = pending.drain().map(|(_, v)| v).collect();
                    for ev in batch {
                        if let Err(e) = store.upsert(StaffPresenceUpsert {
                            user_id: ev.user_id,
                            name: ev.name,
                            role: ev.role,
                            brand_id: ev.brand_id,
                            online: ev.online,
                            last_seen_at: ev.last_seen_at,
                            last_online_at: ev.last_online_at,
                        }).await {
                            // Losing one debounced presence flush is
                            // acceptable (the next transition or
                            // heartbeat re-writes the state) — log and
                            // carry on rather than killing the journal.
                            tracing::warn!(error = %e, user_id = %ev.user_id, "presence journal flush failed");
                        }
                    }
                }
                _ = heartbeat.tick() => {
                    // Bump `last_seen_at` for everyone still online.
                    let bumps: Vec<JournalEvent> = presence()
                        .snapshot(None)
                        .into_iter()
                        .filter(|s| s.online())
                        .map(|s| JournalEvent {
                            user_id: Uuid::parse_str(&s.user_id).unwrap_or_default(),
                            name: s.name,
                            role: s.role,
                            brand_id: s.brand_id.as_deref().and_then(|b| Uuid::parse_str(b).ok()),
                            online: true,
                            last_seen_at: now_rfc3339(),
                            last_online_at: None, // keep the stored stint
                        })
                        .collect();
                    if !bumps.is_empty() {
                        for ev in bumps {
                            pending.insert(ev.user_id, ev);
                        }
                    }
                }
                _ = roster.tick() => {
                    refresh_offline_cache(store.as_ref()).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;

    fn staff_user(role: &str, brand: Option<Uuid>) -> SessionUser {
        SessionUser {
            id: Uuid::new_v4(),
            actor_type: role.to_string(),
            role: role.to_string(),
            name: format!("Staff-{role}"),
            email: None,
            phone: None,
            avatar_url: None,
            brand_id: brand,
            brand_name: None,
            employee_role: None,
        }
    }

    #[test]
    fn online_requires_a_socket() {
        let hub = PresenceHub::new();
        let u = staff_user("employee", None);
        assert!(!hub.is_online(&u.id.to_string()));
        hub.chat_socket_connected(&u, 1);
        assert!(hub.is_online(&u.id.to_string()));
        hub.chat_socket_disconnected(&u.id.to_string(), 1);
        assert!(!hub.is_online(&u.id.to_string()));
    }

    #[test]
    fn entry_survives_until_last_socket_of_both_families() {
        let hub = PresenceHub::new();
        let u = staff_user("employee", None);
        hub.chat_socket_connected(&u, 1);
        hub.call_socket_connected(&u, 2);
        hub.chat_socket_disconnected(&u.id.to_string(), 1);
        assert!(hub.is_online(&u.id.to_string()));
        hub.call_socket_disconnected(&u.id.to_string(), 2);
        assert!(!hub.is_online(&u.id.to_string()));
    }

    #[test]
    fn call_disconnect_clears_in_call() {
        let hub = PresenceHub::new();
        let u = staff_user("employee", None);
        hub.call_socket_connected(&u, 1);
        hub.set_in_call(&u.id.to_string(), true);
        assert!(hub.get(&u.id.to_string()).unwrap().busy());
        hub.call_socket_disconnected(&u.id.to_string(), 1);
        assert!(!hub.is_online(&u.id.to_string()));
    }

    #[test]
    fn busy_excluded_from_available() {
        let hub = PresenceHub::new();
        let u = staff_user("employee", None);
        hub.chat_socket_connected(&u, 1);
        assert_eq!(hub.available_count(None), 1);
        hub.set_in_call(&u.id.to_string(), true);
        assert_eq!(hub.available_count(None), 0);
        assert_eq!(hub.online_count(None), 1); // still online, just busy
    }

    #[test]
    fn pick_prefers_lowest_load() {
        let hub = PresenceHub::new();
        let busy_guy = staff_user("employee", None);
        let free_guy = staff_user("employee", None);
        hub.chat_socket_connected(&busy_guy, 1);
        hub.chat_socket_connected(&free_guy, 2);
        hub.adjust_active_chats(&busy_guy.id.to_string(), 5);
        let picked = hub.pick_best_available(None).unwrap();
        assert_eq!(picked.user_id, free_guy.id.to_string());
    }

    #[test]
    fn pick_round_robins_equal_load() {
        let hub = PresenceHub::new();
        let a = staff_user("employee", None);
        let b = staff_user("employee", None);
        hub.chat_socket_connected(&a, 1);
        hub.chat_socket_connected(&b, 2);
        // a.name = b.name = "Staff-employee" → deterministic tie-break by
        // last_assigned: a assigned first ⇒ next pick is b.
        hub.mark_assigned(&a.id.to_string());
        let picked = hub.pick_best_available(None).unwrap();
        assert_eq!(picked.user_id, b.id.to_string());
    }

    #[test]
    fn pick_prefers_employee_over_equally_available_admin() {
        let hub = PresenceHub::new();
        let admin = staff_user("admin", None);
        let emp = staff_user("employee", None);
        hub.chat_socket_connected(&admin, 1);
        hub.chat_socket_connected(&emp, 2);
        let picked = hub.pick_best_available(None).unwrap();
        assert_eq!(picked.user_id, emp.id.to_string());
    }

    #[test]
    fn brand_scoping_includes_global_staff() {
        let hub = PresenceHub::new();
        let brand = Uuid::new_v4();
        let global = staff_user("employee", None);
        let other_brand = staff_user("employee", Some(Uuid::new_v4()));
        let branded = staff_user("employee", Some(brand));
        hub.chat_socket_connected(&global, 1);
        hub.chat_socket_connected(&other_brand, 2);
        hub.chat_socket_connected(&branded, 3);
        let scope = brand.to_string();
        let picked = hub.pick_best_available(Some(&scope)).unwrap();
        // other_brand does NOT serve `brand`; global + branded do.
        assert!(
            picked.user_id == global.id.to_string() || picked.user_id == branded.id.to_string()
        );
    }

    #[test]
    fn bot_active_only_when_nobody_online() {
        let hub = PresenceHub::new();
        assert!(hub.bot_active(None));
        let u = staff_user("admin", None);
        hub.chat_socket_connected(&u, 1);
        assert!(!hub.bot_active(None));
        // Even a busy (in-call) staff member keeps the bot off — the
        // spec gates the bot on ONLINE, not AVAILABLE.
        hub.set_in_call(&u.id.to_string(), true);
        assert!(!hub.bot_active(None));
    }

    #[test]
    fn sweep_removes_empty_stale_entries() {
        let hub = PresenceHub::new();
        let u = staff_user("employee", None);
        hub.chat_socket_connected(&u, 1);
        hub.chat_socket_disconnected(&u.id.to_string(), 1); // normally removed already
                                                            // Simulate a leaked entry: insert with no sockets directly.
        hub.staff
            .entry(u.id.to_string())
            .or_insert_with(|| StaffEntry {
                user_id: u.id.to_string(),
                name: u.name.clone(),
                role: "employee".into(),
                brand_id: None,
                chat_sockets: HashSet::new(),
                call_sockets: HashSet::new(),
                active_chats: 0,
                in_call: false,
                last_seen: Instant::now(),
                last_seen_at: now_rfc3339(),
                last_assigned: None,
            });
        assert_eq!(hub.len(), 1);
        assert_eq!(hub.sweep(), 0); // still within grace
        assert_eq!(hub.len(), 1);
        // Force-stale the entry:
        if let Some(mut e) = hub.staff.get_mut(&u.id.to_string()) {
            e.last_seen = Instant::now() - EMPTY_GRACE - Duration::from_secs(1);
        }
        assert_eq!(hub.sweep(), 1);
        assert_eq!(hub.len(), 0);
    }

    #[test]
    fn active_chats_never_underflows() {
        let hub = PresenceHub::new();
        let u = staff_user("employee", None);
        hub.chat_socket_connected(&u, 1);
        hub.adjust_active_chats(&u.id.to_string(), -3);
        assert_eq!(hub.get(&u.id.to_string()).unwrap().active_chats, 0);
    }

    #[test]
    fn staff_json_carries_last_seen_and_offline_roster() {
        let hub = PresenceHub::new();
        let u = staff_user("employee", None);
        hub.chat_socket_connected(&u, 1);

        let payload = hub.staff_json(None);
        assert_eq!(payload["type"], "staff_presence");
        let entry = &payload["staff"][0];
        assert_eq!(entry["userId"], u.id.to_string());
        // lastSeenAt present + RFC3339-shaped ("...THH:MM:SSZ").
        let seen = entry["lastSeenAt"].as_str().unwrap_or_default();
        assert!(
            seen.starts_with("20") && seen.contains('T') && seen.ends_with('Z'),
            "lastSeenAt must be RFC3339, got: {seen}"
        );
        // Offline array exists (empty when nobody was recently active).
        assert!(payload["offline"].as_array().is_some());
    }

    #[test]
    fn offline_roster_brand_scoping() {
        // The cache starts empty (no journal in unit tests).
        assert!(offline_roster(None).is_empty());
        {
            let mut guard = OFFLINE_CACHE.write().unwrap_or_else(|e| e.into_inner());
            *guard = vec![
                OfflineStaff {
                    user_id: "global".into(),
                    name: "Global".into(),
                    role: "admin".into(),
                    brand_id: None,
                    last_seen_at: "2026-09-12T00:00:00Z".into(),
                    last_online_at: None,
                },
                OfflineStaff {
                    user_id: "branded".into(),
                    name: "Branded".into(),
                    role: "employee".into(),
                    brand_id: Some("brand-a".into()),
                    last_seen_at: "2026-09-12T00:00:00Z".into(),
                    last_online_at: None,
                },
            ];
        }

        let all = offline_roster(None);
        assert_eq!(all.len(), 2);
        let scoped = offline_roster(Some("brand-a"));
        assert_eq!(
            scoped.len(),
            2,
            "brand scope keeps global + same-brand staff"
        );
        let other = offline_roster(Some("brand-b"));
        assert_eq!(other.len(), 1, "brand-b scope excludes brand-a staff");
        assert_eq!(other[0].user_id, "global");

        // Cleanup: leave the cache empty for other tests.
        let mut guard = OFFLINE_CACHE.write().unwrap_or_else(|e| e.into_inner());
        *guard = Vec::new();
    }

    /// The journal coalesces per-user: a connect + disconnect inside one
    /// flush window collapses to ONE upsert carrying the FINAL state
    /// (this is what keeps DB writes bounded under socket churn — the
    /// office-network scenario where connections flap constantly).
    #[tokio::test(start_paused = true)]
    async fn journal_coalesces_to_latest_state_per_user() {
        use crate::store::staff_presence::tests_support::RecordingStore;
        use std::sync::Arc;

        let store = Arc::new(RecordingStore::default());
        spawn_journal(store.clone());
        let hub = PresenceHub::new();
        let u = staff_user("employee", None);

        hub.chat_socket_connected(&u, 1); // online transition → event
        hub.chat_socket_connected(&u, 2); // still online → NO event
        hub.chat_socket_disconnected(&u.id.to_string(), 2); // still online → NO event
        hub.chat_socket_disconnected(&u.id.to_string(), 1); // offline transition → event

        // One flush window (virtual time — the runtime auto-advances).
        tokio::time::sleep(JOURNAL_FLUSH + Duration::from_secs(1)).await;
        // The journal channel is process-global: parallel local-hub tests
        // in this module also emit transitions. Only OUR user's writes
        // assert here — that is the coalescing contract.
        let mine: Vec<_> = store
            .writes()
            .into_iter()
            .filter(|w| w.user_id == u.id)
            .collect();
        assert_eq!(mine.len(), 1, "writes for this user: {mine:?}");
        assert!(!mine[0].online, "final state must be offline");
        assert!(!mine[0].last_seen_at.is_empty());
    }
}

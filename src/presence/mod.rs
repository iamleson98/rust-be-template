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
//! ## Staleness defense
//!
//! Sockets are reference-counted (`chat_sockets` / `call_sockets` sets);
//! an entry only disappears when its LAST socket disconnects. A
//! background sweeper (`spawn_sweeper`) additionally drops entries whose
//! socket sets are somehow empty (a missed disconnect) after a grace
//! period — belt and braces so a leaked entry can never keep a staff
//! member "online" forever.

use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use dashmap::DashMap;

use crate::auth::SessionUser;

/// How long an entry with zero sockets lingers before the sweeper drops it.
const EMPTY_GRACE: Duration = Duration::from_secs(30);
/// Sweeper cadence.
const SWEEP_INTERVAL: Duration = Duration::from_secs(15);

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
            last_assigned: None,
        }
    }

    /// A staff member connected a chat-WS socket. Only call for
    /// `user.is_staff()` sessions.
    pub fn chat_socket_connected(&self, user: &SessionUser, sid: u64) {
        let mut entry = self
            .staff
            .entry(user.id.to_string())
            .or_insert_with(|| self.entry_for(user));
        entry.chat_sockets.insert(sid);
        entry.last_seen = Instant::now();
        // Refresh the display name — it may have changed since boot.
        entry.name = user.name.clone();
    }

    /// A staff member's chat-WS socket went away. Removes the whole
    /// entry when the last socket of both families is gone.
    pub fn chat_socket_disconnected(&self, user_id: &str, sid: u64) {
        if let Some(mut entry) = self.staff.get_mut(user_id) {
            entry.chat_sockets.remove(&sid);
            entry.last_seen = Instant::now();
            if entry.chat_sockets.is_empty() && entry.call_sockets.is_empty() {
                drop(entry);
                self.staff.remove(user_id);
            }
        }
    }

    /// A staff member registered as a call agent (call-WS socket).
    pub fn call_socket_connected(&self, user: &SessionUser, sid: u64) {
        let mut entry = self
            .staff
            .entry(user.id.to_string())
            .or_insert_with(|| self.entry_for(user));
        entry.call_sockets.insert(sid);
        entry.last_seen = Instant::now();
        entry.name = user.name.clone();
    }

    /// A staff member's call-WS socket went away. Also clears their
    /// in-call flag (a disconnected agent cannot still be in a call).
    pub fn call_socket_disconnected(&self, user_id: &str, sid: u64) {
        if let Some(mut entry) = self.staff.get_mut(user_id) {
            entry.call_sockets.remove(&sid);
            entry.in_call = false;
            entry.last_seen = Instant::now();
            if entry.chat_sockets.is_empty() && entry.call_sockets.is_empty() {
                drop(entry);
                self.staff.remove(user_id);
            }
        }
    }

    /// Mark a staff member as (not) currently in an audio call.
    /// No-op for unknown users (they can't be in a call).
    pub fn set_in_call(&self, user_id: &str, in_call: bool) {
        if let Some(mut entry) = self.staff.get_mut(user_id) {
            entry.in_call = in_call;
            entry.last_seen = Instant::now();
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
                })
            })
            .collect();
        serde_json::json!({
            "type": "staff_presence",
            "staff": staff,
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
}

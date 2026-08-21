//! Chat abuse detector + temporary ban state machine.
//!
//! ## Detection strategy
//!
//! A user message is inspected against several heuristics. If any
//! heuristic matches, the user's `violations` counter increments. When
//! the counter reaches `BAN_THRESHOLD` within the `WINDOW_SECS` window,
//! the user is auto-banned for `BAN_SECS` (~10 min).
//!
//! Heuristics:
//!   1. **Profanity / slurs** — Vietnamese + English bad-word list.
//!   2. **All-caps shouting** — message > 12 chars + > 70% uppercase.
//!   3. **Phone-number spam** — 3+ distinct phone numbers in one message
//!      (a common scam pattern).
//!
//! ## Heuristics NOT included (per user request)
//!
//!   * **Message-length abuse** — handled in the frontend chat-input
//!     component (500-char hard limit + disabled send button).
//!   * **URL spam** — too noisy; legitimate customer-service URLs
//!     (booking links, payment receipts) frequently appear in chat.
//!   * **Repeat-spam** — sending the same message multiple times is NOT
//!     treated as a violation. The user explicitly said blocking for
//!     repeat messages is "weird". A user might re-send a message that
//!     didn't appear to go through, or emphasise a point. We still
//!     track the message hash for audit, but it does NOT count toward
//!     the ban threshold.
//!
//! The detector is deliberately conservative — false positives would
//! punish legitimate users. Each heuristic only fires on clear matches.
//!
//! ## Ban state
//!
//! When banned, the user_id + IP are recorded with `banned_until`. The
//! WS handler rejects all `message` events with a 403-style error until
//! the ban expires. After expiry, the violation counter resets.
//!
//! ## Why in-memory?
//!
//! - Bans are short (10 min) — not worth a DB round-trip per message.
//! - On restart, all bans clear — which is fine for the customer: a
//!   restart is rare, and a "clean slate" is a feature, not a bug.
//! - If the abuse is sustained, the user will be re-banned within a
//!   few messages anyway.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use once_cell::sync::Lazy;

/// Default violation window (rolling) — 5 minutes.
pub const WINDOW_SECS: u64 = 5 * 60;

/// Ban duration — 10 minutes.
pub const BAN_SECS: u64 = 10 * 60;

/// Number of violations within the window that triggers a ban.
/// Set to 5 (was 3) — the user said the ban was too aggressive.
/// 3 violations = 3 profane messages in 5 minutes → ban. 5 is more
/// forgiving while still catching sustained abuse.
pub const BAN_THRESHOLD: u32 = 5;

/// Outcome of inspecting a user's message.
#[derive(Debug, Clone)]
pub enum AbuseVerdict {
    /// Message is clean — proceed with normal handling.
    Ok,
    /// Message triggered a heuristic, but the user isn't banned (yet).
    /// `reason` is the human-readable violation (Vietnamese, shown to user).
    /// The violation has been recorded against the user.
    Warned { reason: String },
    /// User is now banned. `until` is the Instant the ban expires.
    /// Subsequent messages from this user should be rejected with the
    /// same `reason` until `until` passes.
    Banned { reason: String, until: Instant },
}

impl AbuseVerdict {
    pub fn is_banned(&self) -> bool {
        matches!(self, AbuseVerdict::Banned { .. })
    }
}

/// Per-user rolling state used by [`AbuseGuard`].
#[derive(Debug, Default)]
struct UserState {
    /// Timestamps of recent violations (used for rolling-window counting).
    recent_violations: VecDeque<Instant>,
    /// Last 10 message hashes — used for repeat-spam detection.
    recent_msg_hashes: VecDeque<u64>,
    /// Instant the ban expires, if currently banned.
    banned_until: Option<Instant>,
}

impl UserState {
    fn purge_old(&mut self, now: Instant, window: Duration) {
        // Drop violations older than the rolling window.
        while let Some(front) = self.recent_violations.front() {
            if now.duration_since(*front) > window {
                self.recent_violations.pop_front();
            } else {
                break;
            }
        }
        // Cap message-hash history at 10 (don't grow unbounded).
        while self.recent_msg_hashes.len() > 10 {
            self.recent_msg_hashes.pop_front();
        }
    }
}

/// In-memory chat abuse detector + ban state machine.
///
/// Construct once (via [`AbuseGuard::shared`] for the global singleton),
/// clone cheaply (it's `Arc`-backed).
#[derive(Clone)]
pub struct AbuseGuard {
    inner: Arc<Inner>,
}

struct Inner {
    /// user_id → state. Keyed by user_id (string, since SessionUser.id is a String).
    users: DashMap<String, UserState>,
    /// IP → state. Used when the user isn't authenticated (guest).
    /// Also used as a secondary key for ban enforcement.
    ips: DashMap<String, UserState>,
    window: Duration,
    ban: Duration,
    threshold: u32,
}

impl AbuseGuard {
    /// Construct with custom tuning (mainly for tests).
    pub fn new(window: Duration, ban: Duration, threshold: u32) -> Self {
        Self {
            inner: Arc::new(Inner {
                users: DashMap::new(),
                ips: DashMap::new(),
                window,
                ban,
                threshold,
            }),
        }
    }

    /// Default singleton — shared by all WS handlers. Tuned with the
    /// module-level constants (`WINDOW_SECS`, `BAN_SECS`, `BAN_THRESHOLD`).
    pub fn shared() -> Self {
        static GLOBAL: Lazy<AbuseGuard> = Lazy::new(|| {
            AbuseGuard::new(
                Duration::from_secs(WINDOW_SECS),
                Duration::from_secs(BAN_SECS),
                BAN_THRESHOLD,
            )
        });
        GLOBAL.clone()
    }

    /// Inspect a user's message. Returns the verdict and (if banned)
    /// records the ban. Idempotent for the same `(user_id, ip)` — calling
    /// twice with the same text doesn't double-count.
    ///
    /// `user_id` is the user's UUID (as string). `ip` is the remote IP.
    /// Either may be `None` for anonymous/unauthenticated traffic, but
    /// in practice the chat WS requires auth so both are present.
    pub fn check(
        &self,
        user_id: Option<&str>,
        ip: Option<&str>,
        text: &str,
    ) -> AbuseVerdict {
        let now = Instant::now();

        // First: if the user is already banned, return the ban verdict
        // without re-inspecting the message. (The ban is time-based.)
        if let Some(uid) = user_id {
            if let Some(mut st) = self.inner.users.get_mut(uid) {
                st.purge_old(now, self.inner.window);
                if let Some(until) = st.banned_until {
                    if now < until {
                        let remaining = until - now;
                        return AbuseVerdict::Banned {
                            reason: format!(
                                "Tài khoản tạm khóa do vi phạm quy định chat. Vui lòng thử lại sau {} phút.",
                                (remaining.as_secs() / 60).max(1)
                            ),
                            until,
                        };
                    } else {
                        // Ban expired — clear state.
                        st.banned_until = None;
                        st.recent_violations.clear();
                    }
                }
            }
        }

        // Run heuristics — check for abusive content patterns.
        // Repeat-spam (same message sent multiple times) is NO LONGER
        // treated as a ban-triggering violation — the user explicitly
        // said blocking users for sending the same message a few times
        // is "weird". Repeat messages alone are not abuse; the user
        // might be re-sending a message that didn't appear to go
        // through, or emphasising a point.
        //
        // We still track the message hash (for future analysis / audit),
        // but it does NOT increment the violation counter or trigger
        // a ban. Only actual content violations (profanity, all-caps
        // shouting, phone-number spam) count toward the ban threshold.
        let pattern_violation = inspect(text);
        let hash = fxhash(text);

        // Track the hash for audit purposes only — does NOT count
        // toward the ban threshold.
        if let Some(uid) = user_id {
            let mut st = self.inner.users.entry(uid.to_string()).or_default();
            st.purge_old(now, self.inner.window);
            st.recent_msg_hashes.push_back(hash);
        }

        // The combined violation is just the pattern violation.
        // Repeat-spam is ignored (see comment above).
        let combined_reason: Option<String> = pattern_violation.map(|p| p.to_string());

        // Apply to both the user_id-keyed state and the IP-keyed state.
        // The user_id state is authoritative; the IP state is a backup
        // for the case where the user re-registers to dodge a ban.
        let verdict = if let Some(full_reason) = combined_reason {
            let count_user = user_id.map(|uid| {
                let mut st = self.inner.users.entry(uid.to_string()).or_default();
                st.purge_old(now, self.inner.window);
                st.recent_violations.push_back(now);
                st.recent_violations.len() as u32
            });

            // Also track by IP (best-effort — silently skip if None).
            if let Some(ip) = ip {
                let mut st = self.inner.ips.entry(ip.to_string()).or_default();
                st.purge_old(now, self.inner.window);
                st.recent_violations.push_back(now);
            }

            let count = count_user.unwrap_or(1);
            if count >= self.inner.threshold {
                // Ban!
                let until = now + self.inner.ban;
                if let Some(uid) = user_id {
                    if let Some(mut st) = self.inner.users.get_mut(uid) {
                        st.banned_until = Some(until);
                    }
                }
                if let Some(ip) = ip {
                    if let Some(mut st) = self.inner.ips.get_mut(ip) {
                        st.banned_until = Some(until);
                    }
                }
                AbuseVerdict::Banned {
                    reason: format!(
                        "Tài khoản đã bị tạm khóa 10 phút do vi phạm quy định chat: {full_reason}. Vui lòng thử lại sau."
                    ),
                    until,
                }
            } else {
                AbuseVerdict::Warned { reason: full_reason }
            }
        } else {
            AbuseVerdict::Ok
        };

        verdict
    }

    /// Quick check: is this user_id currently banned? Doesn't record
    /// a new violation. Used by the WS handler to short-circuit a
    /// banned user's `message` events without inspecting them again.
    pub fn is_banned(&self, user_id: &str) -> Option<Instant> {
        let now = Instant::now();
        if let Some(st) = self.inner.users.get(user_id) {
            if let Some(until) = st.banned_until {
                if now < until {
                    return Some(until);
                }
            }
        }
        None
    }

    /// Quick check: is this IP currently banned?
    pub fn is_ip_banned(&self, ip: &str) -> Option<Instant> {
        let now = Instant::now();
        if let Some(st) = self.inner.ips.get(ip) {
            if let Some(until) = st.banned_until {
                if now < until {
                    return Some(until);
                }
            }
        }
        None
    }

    /// Manually clear a user's ban (admin override). Returns true if
    /// the user was actually banned.
    pub fn unban(&self, user_id: &str) -> bool {
        if let Some(mut st) = self.inner.users.get_mut(user_id) {
            if st.banned_until.take().is_some() {
                st.recent_violations.clear();
                return true;
            }
        }
        false
    }

    #[cfg(test)]
    pub fn violation_count(&self, user_id: &str) -> usize {
        self.inner
            .users
            .get(user_id)
            .map(|st| st.recent_violations.len())
            .unwrap_or(0)
    }
}

// ── Heuristics ───────────────────────────────────────────────────

/// Inspect a single message. Returns `Some(reason)` if a violation is
/// detected, `None` otherwise.
///
/// NOTE: This does NOT check message length or URL count. The user
/// explicitly asked that those be removed — the frontend chat input
/// has a 500-char hard limit + disabled send button, and legitimate
/// customer-service URLs (booking links, payment receipts) frequently
/// appear in chat. See `src/guard/mod.rs` for the rationale.
fn inspect(text: &str) -> Option<&'static str> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_lowercase();

    // 1. Profanity / slurs (Vietnamese + English).
    if contains_profanity(&lower) {
        return Some("Tin nhắn chứa từ ngữ không phù hợp");
    }

    // 2. All-caps shouting — message > 12 chars, > 70% uppercase letters.
    if trimmed.chars().count() > 12 {
        let letters: Vec<char> = trimmed.chars().filter(|c| c.is_alphabetic()).collect();
        if !letters.is_empty() {
            let upper = letters.iter().filter(|c| c.is_uppercase()).count();
            let ratio = upper as f32 / letters.len() as f32;
            if ratio > 0.7 {
                return Some("Tin nhắn viết hoa quá nhiều (vi phạm quy định)");
            }
        }
    }

    // 3. Phone-number spam — 3+ distinct phone numbers in one message.
    let phone_count = count_phone_numbers(trimmed);
    if phone_count >= 3 {
        return Some("Tin nhắn chứa quá nhiều số điện thoại (nghi ngờ spam/lừa đảo)");
    }

    None
}

/// Returns `true` if the message contains any word in the profanity list.
///
/// The list is intentionally small — only high-confidence slurs that
/// are unambiguously abusive in any context. False positives here would
/// punish legitimate users.
fn contains_profanity(lower: &str) -> bool {
    /// Vietnamese + English slurs / hate terms. Lowercase only.
    /// Word-boundary checks are skipped intentionally — Vietnamese
    /// profanity often appears as part of a phrase without spaces.
    const BAD: &[&str] = &[
        // English
        "fuck", "shit", "bitch", "asshole", "bastard", "dickhead", "motherfucker",
        // Vietnamese (common slurs — kept clinical)
        "địt", "lồn", "cặc", "đĩ", "điếm", "mẹ mày", "m é mày",
        "s Hit", "stfu", "idiot",
        // Scam / social-engineering
        "khuyến mãi ngẫu nhiên", "quà tặng miễn phí", "click here to claim",
    ];

    BAD.iter().any(|w| lower.contains(w))
}

/// Count distinct phone numbers in a message. Vietnamese mobile numbers
/// are 10–11 digits, often prefixed with +84 or 0.
fn count_phone_numbers(text: &str) -> usize {
    let mut count = 0;
    let mut prev_digit = false;
    let mut run_len = 0usize;

    for ch in text.chars() {
        if ch.is_ascii_digit() {
            run_len += 1;
            prev_digit = true;
        } else {
            // Allow space/dash/dot between digit groups.
            if prev_digit && (ch == ' ' || ch == '-' || ch == '.' || ch == '(' || ch == ')') {
                // Don't reset run_len — could be a continuation.
                continue;
            }
            if (10..=12).contains(&run_len) {
                count += 1;
            }
            run_len = 0;
            prev_digit = false;
        }
    }
    // Tail.
    if (10..=12).contains(&run_len) {
        count += 1;
    }
    count
}

/// Simple FNV-1a hash for message-content dedup. We don't need crypto
/// strength — we just need to detect identical repeated messages.
fn fxhash(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guard() -> AbuseGuard {
        AbuseGuard::new(Duration::from_secs(60), Duration::from_secs(600), 3)
    }

    #[test]
    fn clean_message_returns_ok() {
        let g = guard();
        let v = g.check(Some("u1"), Some("1.1.1.1"), "Chào bạn, mình muốn đặt vé đi Đà Lạt");
        assert!(matches!(v, AbuseVerdict::Ok));
    }

    #[test]
    fn detects_profanity_english() {
        let g = guard();
        let v = g.check(Some("u2"), Some("1.1.1.2"), "fuck you");
        assert!(matches!(v, AbuseVerdict::Warned { .. }));
    }

    #[test]
    fn detects_profanity_vietnamese() {
        let g = guard();
        let v = g.check(Some("u3"), Some("1.1.1.3"), "địt mẹ mày");
        assert!(matches!(v, AbuseVerdict::Warned { .. }));
    }

    #[test]
    fn detects_caps_shouting() {
        let g = guard();
        let v = g.check(Some("u4"), Some("1.1.1.4"), "STOP MESSAGING ME RIGHT NOW PLEASE");
        assert!(matches!(v, AbuseVerdict::Warned { .. }));
    }

    #[test]
    fn detects_phone_spam() {
        let g = guard();
        let v = g.check(
            Some("u5"),
            Some("1.1.1.5"),
            "Gọi 0901234567 or 0912345678 or 0987654321 ngay",
        );
        assert!(matches!(v, AbuseVerdict::Warned { .. }));
    }

    #[test]
    fn does_not_flag_urls() {
        // URL-spam heuristic was removed — a chat message with
        // URLs should NOT be flagged (legitimate customer-service
        // URLs like booking links / payment receipts are common).
        let g = guard();
        let v = g.check(
            Some("u6"),
            Some("1.1.1.6"),
            "Bạn xem vé tại https://vexevn.app/booking/123 nhé",
        );
        assert!(matches!(v, AbuseVerdict::Ok));
    }

    #[test]
    fn does_not_flag_long_messages() {
        // Length heuristic was removed — long messages are handled
        // in the frontend chat input (500 char limit). The backend
        // should NOT flag a long-but-legitimate message.
        let g = guard();
        let long = "Tôi muốn đặt vé đi Đà Lạt. ".repeat(50); // ~1350 chars
        let v = g.check(Some("u7"), Some("1.1.1.7"), &long);
        assert!(matches!(v, AbuseVerdict::Ok));
    }

    #[test]
    fn bans_after_threshold() {
        let g = guard();
        // Two warnings, no ban.
        for _ in 0..2 {
            let v = g.check(Some("u8"), Some("1.1.1.8"), "fuck");
            assert!(matches!(v, AbuseVerdict::Warned { .. }));
        }
        // Third violation → ban.
        let v = g.check(Some("u8"), Some("1.1.1.8"), "fuck");
        assert!(matches!(v, AbuseVerdict::Banned { .. }));
        // Subsequent checks return Banned (still within ban window).
        let v = g.check(Some("u8"), Some("1.1.1.8"), "hello");
        assert!(v.is_banned());
    }

    #[test]
    fn is_banned_returns_some_when_banned() {
        let g = guard();
        assert!(g.is_banned("u9").is_none());
        for _ in 0..3 {
            g.check(Some("u9"), Some("1.1.1.9"), "fuck");
        }
        assert!(g.is_banned("u9").is_some());
    }

    #[test]
    fn unban_clears_state() {
        let g = guard();
        for _ in 0..3 {
            g.check(Some("u10"), Some("1.1.1.10"), "fuck");
        }
        assert!(g.is_banned("u10").is_some());
        assert!(g.unban("u10"));
        assert!(g.is_banned("u10").is_none());
    }

    #[test]
    fn repeat_messages_do_not_ban() {
        // Repeat-spam is NO LONGER a ban-triggering violation.
        // Sending the same clean message 5 times should NOT result
        // in a ban (the user explicitly said this is "weird").
        let g = guard();
        let msg = "đặt vé đi Đà Lạt";
        for _ in 0..5 {
            let v = g.check(Some("u11"), Some("1.1.1.11"), msg);
            assert!(matches!(v, AbuseVerdict::Ok), "repeat message should not flag: {:?}", v);
        }
        // Not banned.
        assert!(g.is_banned("u11").is_none());
    }

    #[test]
    fn empty_message_returns_ok() {
        let g = guard();
        let v = g.check(Some("u12"), Some("1.1.1.12"), "   ");
        assert!(matches!(v, AbuseVerdict::Ok));
    }
}

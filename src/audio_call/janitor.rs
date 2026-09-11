//! Call-session janitor — the server-side guarantee that call
//! resources are ALWAYS released, even when no client ever sends a
//! `hangup`.
//!
//! ## Why this exists (the "system stops working smoothly" leaks)
//!
//! Every *explicit* end path already cleans up: the WS handler clears
//! sessions, agent `in_call` flags and presence on hangup or socket
//! drop. But both ends of the lifecycle had NO server-side deadline:
//!
//! 1. **Zombie RINGING sessions.** The customer's client owns the ring
//!    timer (`hangup reason:"timeout"` after ~45-60s). If that client
//!    is frozen (OS-suspended app whose socket still answers pings),
//!    force-killed, or simply buggy, the session rings forever:
//!    - the customer is locked into `customer-busy` — every new call
//!      attempt is rejected,
//!    - the ringing agent is excluded from all new offers
//!      (`ringing_agents`), and
//!    - the stored offer SDP + `tried` set stay resident in memory.
//!
//! 2. **Zombie ACTIVE sessions.** Call liveness is WebRTC/ICE's job —
//!    when the media path dies, BOTH clients end the call themselves.
//!    But if both call UIs die WITHOUT sending `hangup` (client bug,
//!    force-kill on both sides while the signaling sockets stay
//!    connected via other devices), the session stays `Active`
//!    forever: the agent is stuck `in_call` (invisible to routing),
//!    the customer can't call again, and no socket drop ever fires
//!    because the sockets are still alive.
//!
//! The janitor closes both holes with the same expiry machinery the
//! clients were trusted with:
//!
//! * `RINGING` sessions older than the ring timeout
//!   ([`AUDIO_CALL_RING_TIMEOUT_SECS`], default 60s) are expired
//!   exactly like a client-sent `hangup reason:"timeout"` — ring
//!   escalation to the next agent, or `timeout` to the customer when
//!   the queue is dry. Each escalation re-arms the ring clock, so
//!   every agent gets a full window.
//! * `ACTIVE` sessions older than the hard lifetime cap
//!   ([`AUDIO_CALL_MAX_CALL_DURATION_SECS`], default 4h) are torn
//!   down with `hangup reason:"expired"` to both parties — far beyond
//!   any legitimate support call, yet bounding a zombie's busy-lock
//!   to one sweep instead of forever.
//!
//! Every expiry reuses the handler's own release path
//! (`agent_session_cleanup` + `relay_offer` + push
//! `notify_call_ended`), so the agent is freed from `in_call`,
//! presence is re-broadcast, live sockets get a `hangup` frame that
//! tears down their zombie call UI, and push-ringing phones stop —
//! one door for every session end.
//!
//! ## What this deliberately does NOT do
//!
//! * It never touches live, in-window sessions — both expiry methods
//!   re-validate state atomically at removal (a session answered
//!   between the janitor's snapshot and its removal is put back
//!   untouched).
//! * It does not decide media liveness — ICE/clients do. The active
//!   cap is a backstop, not a policy.
//!
//! ## Expiry == resource release checklist (per session end)
//!
//! | Resource                          | Released by                          |
//! |-----------------------------------|--------------------------------------|
//! | `SessionManager` map entry (SDP)  | `expire_ringing` / `expire_active`   |
//! | agent `in_call` flag (hub)        | `agent_session_cleanup`              |
//! | presence broadcast (busy → free)  | `agent_session_cleanup`              |
//! | clients' zombie call UIs          | `hangup` frames to both parties      |
//! | push-ringing phones (FCM)         | `push().notify_call_ended`           |
//!
//! [`AUDIO_CALL_RING_TIMEOUT_SECS`]: crate::config::AudioCallConfig
//! [`AUDIO_CALL_MAX_CALL_DURATION_SECS`]: crate::config::AudioCallConfig

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde_json::json;

use crate::audio_call::handler::{agent_session_cleanup, pick_agent, relay_offer};
use crate::audio_call::session::{sessions, CallState, HangupOutcome};

/// One janitor pass, for logging + tests.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JanitorReport {
    /// Ringing sessions expired (re-routed to a next agent or notified).
    pub ring_expired: usize,
    /// Of those, how many re-routed to a next agent.
    pub ring_rerouted: usize,
    /// Active sessions torn down at the hard lifetime cap.
    pub active_expired: usize,
}

impl JanitorReport {
    fn anything(&self) -> bool {
        self.ring_expired > 0 || self.active_expired > 0
    }
}

/// Cumulative counters since boot — surfaced in the janitor's log lines
/// so operators can see "how often does the safety net fire" without
/// enabling debug logging.
static RING_EXPIRED_TOTAL: AtomicU64 = AtomicU64::new(0);
static RING_REROUTED_TOTAL: AtomicU64 = AtomicU64::new(0);
static ACTIVE_EXPIRED_TOTAL: AtomicU64 = AtomicU64::new(0);

/// Snapshot of the janitor's cumulative counters (monitoring/tests).
pub fn janitor_stats() -> (u64, u64, u64) {
    (
        RING_EXPIRED_TOTAL.load(Ordering::Relaxed),
        RING_REROUTED_TOTAL.load(Ordering::Relaxed),
        ACTIVE_EXPIRED_TOTAL.load(Ordering::Relaxed),
    )
}

/// A session the sweeper decided MIGHT be expired. The authoritative
/// re-check happens inside `SessionManager` (atomic at removal).
struct Suspect {
    customer_id: String,
    agent_id: String,
    state: CallState,
    age: Duration,
}

/// Snapshot the sessions that are candidates for expiry under the
/// given budgets. Cheap: one DashMap iteration (usually empty).
fn suspects(ring_timeout: Duration, max_duration: Duration) -> Vec<Suspect> {
    sessions()
        .sessions_iter()
        .filter_map(|s| {
            let age = s.created_at.elapsed();
            match s.state {
                CallState::Ringing if age >= ring_timeout => Some(Suspect {
                    customer_id: s.customer_id.clone(),
                    agent_id: s.agent_id.clone(),
                    state: CallState::Ringing,
                    age,
                }),
                CallState::Active if age >= max_duration => Some(Suspect {
                    customer_id: s.customer_id.clone(),
                    agent_id: s.agent_id.clone(),
                    state: CallState::Active,
                    age,
                }),
                _ => None,
            }
        })
        .collect()
}

/// One janitor sweep. `Duration::MAX` for either budget disables that
/// expiry (never fires — the elapsed age can never reach it).
pub(crate) fn sweep_once(ring_timeout: Duration, max_duration: Duration) -> JanitorReport {
    let mut report = JanitorReport::default();

    for s in suspects(ring_timeout, max_duration) {
        match s.state {
            CallState::Ringing => {
                // Same semantics as a client-sent `hangup reason:"timeout"`,
                // just server-initiated: ring-escalate if another agent is
                // available, otherwise tell the customer the queue is dry.
                match sessions().expire_ringing(&s.customer_id, &s.agent_id, pick_agent) {
                    Some(HangupOutcome::ReRouted {
                        customer_id,
                        agent_id,
                    }) => {
                        tracing::info!(
                            customer = %customer_id,
                            from_agent = %s.agent_id,
                            to_agent = %agent_id,
                            ring_age_sec = s.age.as_secs(),
                            "call janitor: ringing session expired — re-routed to next agent"
                        );
                        relay_offer(&customer_id, &agent_id);
                        report.ring_expired += 1;
                        report.ring_rerouted += 1;
                    }
                    Some(HangupOutcome::Notify {
                        customer_id,
                        reason,
                    }) => {
                        tracing::info!(
                            customer = %customer_id,
                            agent = %s.agent_id,
                            ring_age_sec = s.age.as_secs(),
                            "call janitor: ringing session expired — notifying customer"
                        );
                        agent_session_cleanup(&s.agent_id);
                        let _ = call_hub_send(
                            &customer_id,
                            &json!({
                                "type": "hangup",
                                "from": "system",
                                "reason": reason,
                            }),
                        );
                        crate::push::push().notify_call_ended(&s.agent_id, &customer_id);
                        report.ring_expired += 1;
                    }
                    // Stale snapshot (answered / already ended) — the
                    // session manager re-validated; nothing to do.
                    Some(HangupOutcome::NoSession) | None => {}
                }
            }
            CallState::Active => {
                // Hard lifetime cap: zombie call UIs on both sides.
                // Release the agent's busy flag, tell BOTH parties
                // (their sockets are alive — that's why nobody else
                // cleaned up), stop any push ring.
                if let Some(ended) = sessions().expire_active(&s.customer_id) {
                    tracing::info!(
                        customer = %ended.customer_id,
                        agent = %ended.agent_id,
                        age_sec = s.age.as_secs(),
                        "call janitor: active session exceeded max duration — expired"
                    );
                    agent_session_cleanup(&ended.agent_id);
                    let hangup = json!({
                        "type": "hangup",
                        "from": "system",
                        "reason": "expired",
                    });
                    let _ = call_hub_send(&ended.customer_id, &hangup);
                    let _ = call_hub_send(&ended.agent_id, &hangup);
                    crate::push::push().notify_call_ended(&ended.agent_id, &ended.customer_id);
                    report.active_expired += 1;
                }
            }
        }
    }

    if report.anything() {
        RING_EXPIRED_TOTAL.fetch_add(report.ring_expired as u64, Ordering::Relaxed);
        RING_REROUTED_TOTAL.fetch_add(report.ring_rerouted as u64, Ordering::Relaxed);
        ACTIVE_EXPIRED_TOTAL.fetch_add(report.active_expired as u64, Ordering::Relaxed);
    }
    report
}

/// Thin wrapper so this module doesn't need the hub's full import
/// surface inline everywhere (and tests can shim it if ever needed).
fn call_hub_send(user_id: &str, msg: &serde_json::Value) -> bool {
    crate::audio_call::hub::call_hub().send_to(user_id, msg)
}

/// Spawn the background sweeper. Called once from `server::bootstrap`
/// next to the other maintenance tasks (presence sweeper, memory
/// sweeper). A zero interval disables it entirely — callers gate on
/// `config.audio_call.enabled` themselves.
pub fn spawn_janitor(ring_timeout: Duration, max_duration: Duration, interval: Duration) {
    if interval.is_zero() {
        tracing::info!("call-session janitor disabled (AUDIO_CALL_JANITOR_INTERVAL_SECS=0)");
        return;
    }
    if ring_timeout == Duration::MAX && max_duration == Duration::MAX {
        tracing::info!(
            "call-session janitor: all expiries disabled \
             (ring timeout = max duration = 0) — not spawning"
        );
        return;
    }
    tracing::info!(
        ring_timeout_sec = ring_timeout.as_secs(),
        max_call_duration_sec = max_duration.as_secs(),
        interval_sec = interval.as_secs(),
        "call-session janitor started"
    );
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            let report = sweep_once(ring_timeout, max_duration);
            if report.anything() {
                tracing::warn!(
                    ring_expired = report.ring_expired,
                    ring_rerouted = report.ring_rerouted,
                    active_expired = report.active_expired,
                    total_sessions = sessions().len(),
                    "call janitor swept expired sessions"
                );
            } else {
                tracing::debug!(live_sessions = sessions().len(), "call janitor swept");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_call::TEST_LOCK;
    use serde_json::json;

    fn offer() -> serde_json::Value {
        json!({ "type": "offer", "sdp": "v=0..." })
    }

    /// Budgets are sub-second so `backdate_for_tests` never has to
    /// subtract past the process start (a fresh CI runner's monotonic
    /// clock cannot represent "16h ago") — the janitor only compares
    /// `age >= budget`, so tiny values exercise identical logic.
    const RING: Duration = Duration::from_millis(100);
    const CAP: Duration = Duration::from_millis(300);

    /// Rig a RINGING session that is (pretend) old: begin the offer,
    /// then backdate `created_at` so the sweeper sees it as expired.
    fn aged_ringing(customer: &str, agent: &str, age: Duration) {
        let m = sessions();
        let out = m.begin_customer_offer(customer, offer(), None, None, {
            let agent = agent.to_string();
            move |_| Some(agent.clone())
        });
        assert_eq!(
            out,
            crate::audio_call::session::OfferOutcome::Ringing {
                agent_id: agent.to_string()
            }
        );
        m.backdate_for_tests(customer, age);
    }

    /// Rig an ACTIVE session that is (pretend) old.
    fn aged_active(customer: &str, agent: &str, age: Duration) {
        aged_ringing(customer, agent, Duration::ZERO);
        let m = sessions();
        assert_eq!(
            m.on_answer(agent, customer, None),
            Some(customer.to_string())
        );
        m.backdate_for_tests(customer, age);
    }

    #[test]
    fn fresh_sessions_are_untouched() {
        let _g = TEST_LOCK.lock().unwrap();
        sessions().clear();
        aged_ringing("c-fresh", "a1", Duration::ZERO);
        aged_active("c-active", "a2", Duration::from_millis(50));
        let report = sweep_once(RING, CAP);
        assert_eq!(report, JanitorReport::default());
        assert!(sessions().get("c-fresh").is_some());
        assert!(sessions().get("c-active").is_some());
        sessions().clear();
    }

    #[test]
    fn expired_ringing_session_is_removed() {
        let _g = TEST_LOCK.lock().unwrap();
        sessions().clear();
        // Aged ring + nobody else to re-route to.
        aged_ringing("c-zombie", "a1", RING * 3);
        let report = sweep_once(RING, CAP);
        assert_eq!(report.ring_expired, 1);
        assert_eq!(report.ring_rerouted, 0);
        assert_eq!(report.active_expired, 0);
        // The zombie session is GONE: the customer can call again.
        assert!(sessions().get("c-zombie").is_none());
        assert!(!sessions().is_user_in_call("c-zombie"));
        sessions().clear();
    }

    #[test]
    fn expired_ringing_reroutes_and_rearms_clock() {
        let _g = TEST_LOCK.lock().unwrap();
        sessions().clear();
        aged_ringing("c-reroute", "a1", RING * 5);
        // Re-route to a2 directly (the handler's ring escalation path is
        // covered by session tests; here we assert the RE-ARM).
        let out = sessions().expire_ringing("c-reroute", "a1", |exclude| {
            let next: Option<String> = Some("a2".to_string());
            next.filter(|next| !exclude.contains(next))
        });
        match out {
            Some(HangupOutcome::ReRouted { agent_id, .. }) => assert_eq!(agent_id, "a2"),
            other => panic!("expected re-route, got {other:?}"),
        }
        // Re-armed: the re-routed session is young again — a sweep with
        // the same budget must NOT expire it (each agent gets a full
        // ring window; a2 has only "just" started ringing).
        let report = sweep_once(RING, CAP);
        assert_eq!(report, JanitorReport::default());
        assert!(sessions().get("c-reroute").is_some());
        sessions().clear();
    }

    #[test]
    fn active_session_past_cap_is_expired() {
        let _g = TEST_LOCK.lock().unwrap();
        sessions().clear();
        aged_active("c-long", "a9", CAP * 2);
        let report = sweep_once(RING, CAP);
        assert_eq!(report.active_expired, 1);
        assert_eq!(report.ring_expired, 0);
        assert!(sessions().get("c-long").is_none());
        assert!(!sessions().is_user_in_call("a9"));
        sessions().clear();
    }

    #[test]
    fn disabled_budgets_never_expire() {
        let _g = TEST_LOCK.lock().unwrap();
        sessions().clear();
        aged_ringing("c-ring", "a1", Duration::from_secs(1));
        aged_active("c-act", "a2", Duration::from_secs(1));
        // Duration::MAX = the "0 disables" config semantics.
        let report = sweep_once(Duration::MAX, Duration::MAX);
        assert_eq!(report, JanitorReport::default());
        assert!(sessions().get("c-ring").is_some());
        assert!(sessions().get("c-act").is_some());
        sessions().clear();
    }

    /// The suspects snapshot is only a hint — a session that gets
    /// ANSWERED after the snapshot but before expiry must survive:
    /// `expire_ringing` puts a now-Active session back untouched.
    #[test]
    fn answered_between_snapshot_and_expiry_survives() {
        let _g = TEST_LOCK.lock().unwrap();
        sessions().clear();
        aged_ringing("c-race", "a1", RING * 5);
        // The agent answers right "after" the sweeper snapshotted.
        assert_eq!(
            sessions().on_answer("a1", "c-race", Some(9)),
            Some("c-race".to_string())
        );
        // Sweep still runs — but must not kill the just-answered call
        // (its age is below the ACTIVE cap).
        let report = sweep_once(RING, CAP * 10);
        assert_eq!(report, JanitorReport::default());
        assert_eq!(
            sessions().get("c-race").map(|s| s.state),
            Some(CallState::Active)
        );
        sessions().clear();
    }
}

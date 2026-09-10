//! Server-side call-session state machine — the single source of truth
//! for "which call is in which state between which two users".
//!
//! ## Why sessions (the scalable method)
//!
//! Previously the call hub relayed `offer`/`answer`/`hangup` frames and
//! only pinned `customer → agent` for ICE routing. All *liveness*
//! decisions lived on the clients: the answering mobile app decided
//! "busy", the customer's timer decided "nobody picked up", and the
//! agent's `in_call` flag was flipped on `answer` but only ever
//! cleared by an *agent*-sent hangup. That has three production bugs
//! this module fixes:
//!
//! 1. **Zombie busy agents**: a customer hanging up an ACTIVE call
//!    never cleared the agent's `in_call` → presence kept reporting
//!    the agent busy → `pick_available_agent_id` skipped them forever
//!    → "All agents are busy" for every later call. Any session end
//!    (either side, any reason, socket drop) now clears the agent's
//!    in-call state in one place.
//! 2. **No busy guard for customers**: two agents could ring the same
//!    customer at once; a customer already in a call could start
//!    another. Sessions are keyed `customer → session`, so a second
//!    offer for an in-call user is rejected server-side with
//!    `customer-busy` / `peer-busy`.
//! 3. **No ring escalation**: an agent declining (or missing) a call
//!    just sent a hangup to the customer. Modern dispatch systems
//!    (Slack huddles, contact-center "ring groups") re-route to the
//!    next free agent automatically. Sessions carry the `tried` set +
//!    the original offer SDP, so the SAME offer can be relayed to the
//!    next available agent until the queue is exhausted.
//!
//! ## State machine
//!
//! ```text
//!            offer (customer→server)          answer (agent→server)
//!  (none) ────────────────────────▶ RINGING ─────────────────────▶ ACTIVE
//!    ▲                                │    │                          │
//!    │                    agent hangup│    │customer hangup           │ any hangup /
//!    │                    busy/decline│    │/socket drop              │ socket drop
//!    │              re-route: next    │    │                          │
//!    └──── exhausts ◀── agent ────────┘    └────────── (none) ◀──────┘
//! ```
//!
//! ## Concurrency
//!
//! `DashMap<customer_id, CallSession>` — same lock-free pattern as the
//! hubs. Process-local singleton; moving to Redis Pub/Sub + a shared
//! map is the documented horizontal-scaling step (single replica is
//! pinned by the DB anyway, see `stack.yml`).
//!
//! ## Agent-initiated calls
//!
//! An agent calling a customer (`startCall` from the chat room) creates
//! the SAME session shape, just `initiator = Agent` — re-route does not
//! apply (there is exactly one intended callee); agent hangup while
//! ringing simply notifies the customer.

use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::Instant;

use dashmap::DashMap;
use serde_json::Value;

/// Lifecycle of one call session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CallState {
    /// Offer relayed to the agent, waiting for their `answer`.
    Ringing,
    /// Answer relayed — media is (being) negotiated.
    Active,
}

/// Which side placed the call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Initiator {
    Customer,
    Agent,
}

/// One live call between a customer and an agent.
#[derive(Debug, Clone)]
pub struct CallSession {
    pub customer_id: String,
    pub agent_id: String,
    /// The ORIGINAL offer SDP (`{"type":"offer","sdp":...}`) — kept so a
    /// re-routed offer is byte-identical for the next agent.
    pub offer: Value,
    /// Chat channel context ("supporting ticket X") — relayed with the offer.
    pub channel_id: Option<String>,
    pub state: CallState,
    pub initiator: Initiator,
    /// Agents this call already rang (declined / busy / unreachable).
    /// Re-route never re-rings a member of this set.
    pub tried: HashSet<String>,
    pub created_at: Instant,
    /// The socket that SENT the offer (the calling side's device). While
    /// ringing, that socket going away means the caller vanished — the
    /// call dies instead of ringing into a void.
    pub offerer_sid: Option<u64>,
    /// The socket that ACCEPTED the call (`answer`). While active, this
    /// socket + `offerer_sid` carry the media PCs — either dropping ends
    /// the call even when the user still has other live sockets (multi-
    /// session: web + phone).
    pub answered_on: Option<u64>,
}

/// Result of trying to place a call (customer- or agent-initiated).
#[derive(Debug, PartialEq, Eq)]
pub enum OfferOutcome {
    /// Offer accepted — relay it to this agent (a session now exists).
    Ringing { agent_id: String },
    /// The CALLER (customer) is already in a call — reject with
    /// `customer-busy`.
    CustomerBusy,
    /// The CALLEE (customer) is already in a call — reject with
    /// `peer-busy` (agent-initiated calls).
    PeerBusy,
    /// The AGENT placing the call is already in another call — reject
    /// with `agent-busy` (agent-initiated calls).
    AgentBusy,
    /// No agent available to take the call.
    NoAgent,
}

/// Result of an agent declining / missing a ringing call (one session —
/// the handler drains in a loop until `NoSession`).
#[derive(Debug, PartialEq, Eq)]
pub enum HangupOutcome {
    /// Session gone, the customer must be notified with this reason
    /// (`"timeout"` / `"agents-busy"` when the ring queue exhausted).
    Notify { customer_id: String, reason: String },
    /// Re-routed: relay the stored offer (fetch via
    /// [`SessionManager::get`]) to the next agent.
    ReRouted {
        customer_id: String,
        agent_id: String,
    },
    /// No session involving this agent (nothing to do).
    NoSession,
}

/// Result of the customer ending a call.
#[derive(Debug, PartialEq, Eq)]
pub enum CustomerHangup {
    /// Session removed — notify this agent.
    NotifyAgent {
        agent_id: String,
    },
    NoSession,
}

/// A call ENDED because one of its carrying sockets dropped.
/// The handler notifies the counterpart + clears in-call state.
#[derive(Debug, PartialEq, Eq)]
pub struct SocketEndedCall {
    /// The user still online whose peer vanished (notify them).
    pub notify_user_id: String,
    /// The user whose socket dropped (cleanup their in-call flag).
    pub dropped_user_id: String,
    /// Customer of the ended session (logging + push).
    pub customer_id: String,
    /// Agent of the ended session (cleanup + push).
    pub agent_id: String,
}

/// Snapshot of the live session a registering user is part of — sent
/// back in the `registered` frame as `activeCall` so (re)connecting
/// clients can reconcile their call UI with server truth.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveCallInfo {
    /// The session's customer id.
    pub customer_id: String,
    /// The OTHER party's user id (agent if this user is the customer,
    /// customer if this user is the agent).
    pub peer_id: String,
    /// `"ringing"` | `"active"`.
    pub state: CallState,
    /// `"customer"` | `"agent"` — who placed the call.
    pub initiator: Initiator,
}

/// The process-wide session registry.
pub struct SessionManager {
    /// `customer_id → session`. ONE call per customer — the busy guard
    /// for both directions ("when he is in a call, other users should
    /// not be able to call him").
    sessions: DashMap<String, CallSession>,
}

static SESSIONS: OnceLock<SessionManager> = OnceLock::new();

/// Process-global accessor.
pub fn sessions() -> &'static SessionManager {
    SESSIONS.get_or_init(SessionManager::new)
}

impl SessionManager {
    fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    /// Live session count (metrics / health).
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    /// A call ENDED because one of its carrying sockets dropped.
    /// The handler notifies the counterpart + clears in-call state.
    pub fn end_sessions_of_socket(&self, user_id: &str, sid: u64) -> Vec<SocketEndedCall> {
        let mut ended = Vec::new();
        // Sessions where this user is either side.
        let keys: Vec<String> = self
            .sessions
            .iter()
            .filter(|s| s.customer_id == user_id || s.agent_id == user_id)
            .map(|s| s.customer_id.clone())
            .collect();
        for key in keys {
            let Some((_, s)) = self.sessions.remove(&key) else {
                continue;
            };
            let carries = s.offerer_sid == Some(sid)
                || (s.state == CallState::Active && s.answered_on == Some(sid));
            if carries {
                ended.push(SocketEndedCall {
                    notify_user_id: if s.customer_id == user_id {
                        s.agent_id.clone()
                    } else {
                        s.customer_id.clone()
                    },
                    dropped_user_id: user_id.to_string(),
                    customer_id: s.customer_id,
                    agent_id: s.agent_id,
                });
            } else {
                // Not carried by this socket — put it back untouched.
                self.sessions.insert(key, s);
            }
        }
        ended
    }

    /// Is this user (customer OR agent) currently in a call session?
    pub fn is_user_in_call(&self, user_id: &str) -> bool {
        self.sessions
            .iter()
            .any(|s| s.customer_id == user_id || s.agent_id == user_id)
    }

    /// Does THIS socket carry a live call? Used by the WS read pump to
    /// pick its idle budget: the caller's socket carries the offer while
    /// RINGING, the answerer's socket carries the session once ACTIVE.
    ///
    /// A call-carrying socket is legitimately SILENT for long stretches
    /// (audio flows peer-to-peer over WebRTC, not through the signaling
    /// socket), and its owning app may be OS-frozen in the background
    /// (Android caches a call screen the moment the proximity sensor
    /// blanks the display). Reaping such a socket at the plain 90s idle
    /// timeout kills LIVE calls — see the handler's call-aware idle
    /// logic. Call liveness is WebRTC/ICE's job (both clients end the
    /// call on ICE failure themselves); the idle timeout only needs to
    /// reap sockets that are NOT carrying a call.
    pub fn socket_carries_call(&self, user_id: &str, sid: u64) -> bool {
        self.sessions.iter().any(|s| {
            (s.customer_id == user_id || s.agent_id == user_id)
                && (s.offerer_sid == Some(sid)
                    || (s.state == CallState::Active && s.answered_on == Some(sid)))
        })
    }

    /// The live call session this user is part of (either role), for
    /// the `registered` frame's `activeCall` field. Clients use it to
    /// reconcile after a reconnect: a client whose local UI still shows
    /// a call but sees `activeCall: null` on (re)register knows the
    /// session is gone server-side and must end its zombie call UI —
    /// the hangup that ended the session was sent to the OTHER side
    /// (and to this user's OTHER sockets), so a socket that reconnected
    /// would otherwise never learn the call is over.
    pub fn active_call_of(&self, user_id: &str) -> Option<ActiveCallInfo> {
        self.sessions
            .iter()
            .find(|s| s.customer_id == user_id || s.agent_id == user_id)
            .map(|s| ActiveCallInfo {
                customer_id: s.customer_id.clone(),
                peer_id: if s.customer_id == user_id {
                    s.agent_id.clone()
                } else {
                    s.customer_id.clone()
                },
                state: s.state,
                initiator: s.initiator,
            })
    }

    /// Agents currently RINGING for some customer — excluded from new
    /// offers so one ringing phone isn't stacked with a second caller.
    pub fn ringing_agents(&self) -> HashSet<String> {
        self.sessions
            .iter()
            .filter(|s| s.state == CallState::Ringing)
            .map(|s| s.agent_id.clone())
            .collect()
    }

    /// The agent a customer's session is with (ICE + hangup routing —
    /// replaces the hub's old pin map).
    pub fn agent_for(&self, customer_id: &str) -> Option<String> {
        self.sessions.get(customer_id).map(|s| s.agent_id.clone())
    }

    /// Begin a CUSTOMER-initiated call: busy-guard the customer, pick
    /// the best agent not already busy/ringing, create the session.
    ///
    /// `pick_agent` is injected (the handler passes a closure over the
    /// call hub + presence) so this module stays free of IO and the
    /// unit tests don't need live sockets.
    pub fn begin_customer_offer(
        &self,
        customer_id: &str,
        offer: Value,
        channel_id: Option<String>,
        offerer_sid: Option<u64>,
        pick_agent: impl FnOnce(&HashSet<String>) -> Option<String>,
    ) -> OfferOutcome {
        // Busy guard: this customer is already in (or placing) a call.
        if self.sessions.contains_key(customer_id) {
            return OfferOutcome::CustomerBusy;
        }
        let exclude = self.ringing_agents();
        match pick_agent(&exclude) {
            Some(agent_id) => {
                let mut tried = HashSet::new();
                tried.insert(agent_id.clone());
                self.sessions.insert(
                    customer_id.to_string(),
                    CallSession {
                        customer_id: customer_id.to_string(),
                        agent_id: agent_id.clone(),
                        offer,
                        channel_id,
                        state: CallState::Ringing,
                        initiator: Initiator::Customer,
                        tried,
                        created_at: Instant::now(),
                        offerer_sid,
                        answered_on: None,
                    },
                );
                OfferOutcome::Ringing { agent_id }
            }
            None => OfferOutcome::NoAgent,
        }
    }

    /// Begin an AGENT-initiated call to `customer_id`: the customer must
    /// be free, and the agent must not already be in another call.
    pub fn begin_agent_offer(
        &self,
        agent_id: &str,
        customer_id: &str,
        offer: Value,
        channel_id: Option<String>,
        offerer_sid: Option<u64>,
    ) -> OfferOutcome {
        if self.sessions.contains_key(customer_id) {
            return OfferOutcome::PeerBusy;
        }
        if self.is_user_in_call(agent_id) {
            return OfferOutcome::AgentBusy;
        }
        let mut tried = HashSet::new();
        tried.insert(agent_id.to_string());
        self.sessions.insert(
            customer_id.to_string(),
            CallSession {
                customer_id: customer_id.to_string(),
                agent_id: agent_id.to_string(),
                offer,
                channel_id,
                state: CallState::Ringing,
                initiator: Initiator::Agent,
                tried,
                created_at: Instant::now(),
                offerer_sid,
                answered_on: None,
            },
        );
        OfferOutcome::Ringing {
            agent_id: agent_id.to_string(),
        }
    }

    /// Agent accepted (`answer`): validate the session is ringing with
    /// THIS agent, then promote it to Active. Returns the customer id
    /// to relay the answer to; `None` = stale/invalid answer (drop it).
    ///
    /// `answerer_sid` records WHICH socket accepted (multi-session:
    /// web + phone both ring; the one that answers carries the call —
    /// its drop ends the session, and the others get an
    /// `answered-elsewhere` hangup so they stop ringing).
    pub fn on_answer(
        &self,
        agent_id: &str,
        customer_id: &str,
        answerer_sid: Option<u64>,
    ) -> Option<String> {
        if let Some(mut s) = self.sessions.get_mut(customer_id) {
            if s.agent_id == agent_id && s.state == CallState::Ringing {
                s.state = CallState::Active;
                s.answered_on = answerer_sid;
                Some(customer_id.to_string())
            } else {
                None
            }
        } else {
            None
        }
    }

    /// Agent hung up / declined / timed out / socket-dropped. Handles
    /// ONE session (the first this agent is involved in — call in a
    /// loop until `NoSession` to drain them all; each call strictly
    /// decreases the sessions held by this agent because re-routes
    /// re-insert for a DIFFERENT agent). For a ringing customer-
    /// initiated call this may re-route to the next agent; for an
    /// active or agent-initiated call it just ends.
    ///
    /// `pick_agent` is the same closure injected by the handler.
    pub fn on_agent_hangup(
        &self,
        agent_id: &str,
        reason: &str,
        pick_agent: impl FnOnce(&HashSet<String>) -> Option<String>,
    ) -> HangupOutcome {
        // Find the (first) session this agent is involved in.
        let key = self
            .sessions
            .iter()
            .find(|s| s.agent_id == agent_id)
            .map(|s| s.customer_id.clone());
        let Some(customer_id) = key else {
            return HangupOutcome::NoSession;
        };

        let mut s = match self.sessions.remove(&customer_id) {
            Some((_, s)) => s,
            None => return HangupOutcome::NoSession,
        };

        if s.state == CallState::Ringing && s.initiator == Initiator::Customer {
            // Ring escalation: the agent never picked up (busy guard,
            // decline, ring timeout, socket drop). Try the NEXT agent
            // that wasn't already tried.
            let mut exclude = s.tried.clone();
            exclude.extend(self.ringing_agents());
            if let Some(next) = pick_agent(&exclude) {
                s.tried.insert(next.clone());
                s.agent_id = next.clone();
                self.sessions.insert(customer_id.clone(), s);
                return HangupOutcome::ReRouted {
                    customer_id,
                    agent_id: next,
                };
            }
            // Nobody left to try — the customer learns the queue is dry.
            let why = if reason == "busy" {
                "agents-busy"
            } else {
                "timeout"
            };
            return HangupOutcome::Notify {
                customer_id,
                reason: why.to_string(),
            };
        }

        // Active call (or agent cancelling their own outbound offer).
        HangupOutcome::Notify {
            customer_id,
            reason: reason.to_string(),
        }
    }

    /// Customer hung up / socket-dropped. Returns the agent to notify.
    pub fn on_customer_hangup(&self, customer_id: &str) -> CustomerHangup {
        match self.sessions.remove(customer_id) {
            Some((_, s)) => CustomerHangup::NotifyAgent {
                agent_id: s.agent_id,
            },
            None => CustomerHangup::NoSession,
        }
    }

    /// Validate an AGENT→customer signalling target (`ice` / `hangup` /
    /// `answer` with an explicit `to`): `Some(customer)` only when a
    /// live session pairs this agent with that customer.
    pub fn agent_target(&self, agent_id: &str, customer_id: &str) -> Option<String> {
        self.sessions
            .get(customer_id)
            .filter(|s| s.agent_id == agent_id)
            .map(|_| customer_id.to_string())
    }

    /// Session snapshot for a customer (tests + debug logging).
    pub fn get(&self, customer_id: &str) -> Option<CallSession> {
        self.sessions.get(customer_id).map(|s| s.value().clone())
    }

    /// Remove every session involving `user_id` (socket dropped).
    /// Returns the removed sessions so the caller can notify the other
    /// sides + clear in-call state.
    pub fn drop_sessions_of(&self, user_id: &str) -> Vec<CallSession> {
        let keys: Vec<String> = self
            .sessions
            .iter()
            .filter(|s| s.customer_id == user_id || s.agent_id == user_id)
            .map(|s| s.customer_id.clone())
            .collect();
        keys.into_iter()
            .filter_map(|k| self.sessions.remove(&k).map(|(_, s)| s))
            .collect()
    }

    /// Test helper: wipe everything. Unit tests share the global
    /// singleton, so each test starts by clearing it (guarded by the
    /// same TEST_LOCK pattern the call hub uses).
    #[cfg(test)]
    pub fn clear(&self) {
        self.sessions.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// SessionManager is a process-global singleton and the tests make
    /// absolute assertions — serialise them. The lock is SHARED with the
    /// hub + handler test modules via `crate::audio_call::TEST_LOCK`
    /// (private per-module locks used to let cross-module tests
    /// interleave on the same singletons).
    use crate::audio_call::TEST_LOCK;

    fn offer() -> Value {
        json!({ "type": "offer", "sdp": "v=0..." })
    }

    fn picker_pick(agent: &'static str) -> impl FnOnce(&HashSet<String>) -> Option<String> {
        move |exclude: &HashSet<String>| {
            if exclude.contains(agent) {
                None
            } else {
                Some(agent.to_string())
            }
        }
    }

    fn picker_none() -> impl FnOnce(&HashSet<String>) -> Option<String> {
        |_| None
    }

    #[test]
    fn customer_offer_creates_ringing_session() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        let out = m.begin_customer_offer(
            "cust-1",
            offer(),
            Some("ch-1".into()),
            None,
            picker_pick("a1"),
        );
        assert_eq!(
            out,
            OfferOutcome::Ringing {
                agent_id: "a1".into()
            }
        );
        let s = m.get("cust-1").unwrap();
        assert_eq!(s.state, CallState::Ringing);
        assert_eq!(s.agent_id, "a1");
        assert!(s.tried.contains("a1"));
        m.clear();
    }

    #[test]
    fn second_customer_offer_is_busy() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        // Same customer tries again (double-tap, second tab, …).
        let out = m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        assert_eq!(out, OfferOutcome::CustomerBusy);
        // Another AGENT calling that busy customer is rejected too.
        let out = m.begin_agent_offer("a2", "cust-1", offer(), None, None);
        assert_eq!(out, OfferOutcome::PeerBusy);
        m.clear();
    }

    #[test]
    fn no_agent_online_is_reported() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        let out = m.begin_customer_offer("cust-1", offer(), None, None, picker_none());
        assert_eq!(out, OfferOutcome::NoAgent);
        assert!(m.is_empty());
    }

    #[test]
    fn answer_promotes_to_active_and_rejects_wrong_agent() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        // A late answer from an agent the call was re-routed AWAY from.
        assert_eq!(m.on_answer("a2", "cust-1", None), None);
        // The real agent answers.
        assert_eq!(m.on_answer("a1", "cust-1", Some(7)), Some("cust-1".into()));
        assert_eq!(m.get("cust-1").unwrap().state, CallState::Active);
        // Duplicate answer is ignored (session already Active).
        assert_eq!(m.on_answer("a1", "cust-1", None), None);
        m.clear();
    }

    #[test]
    fn ringing_agent_decline_re_routes_to_next_agent() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        // a1 declines; a2 is free → re-route.
        let out = m.on_agent_hangup("a1", "declined", picker_pick("a2"));
        assert_eq!(
            out,
            HangupOutcome::ReRouted {
                customer_id: "cust-1".into(),
                agent_id: "a2".into()
            }
        );
        let s = m.get("cust-1").unwrap();
        assert_eq!(s.agent_id, "a2");
        assert!(s.tried.contains("a1") && s.tried.contains("a2"));
        // a2 also declines and nobody is left → the queue is dry.
        let out = m.on_agent_hangup("a2", "declined", picker_none());
        assert_eq!(
            out,
            HangupOutcome::Notify {
                customer_id: "cust-1".into(),
                reason: "timeout".into()
            }
        );
        assert!(m.is_empty());
    }

    #[test]
    fn re_route_never_rings_an_already_tried_agent() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        // The only agent available is a1 again (already tried) → no
        // re-route, the queue is dry.
        let out = m.on_agent_hangup("a1", "busy", picker_pick("a1"));
        assert_eq!(
            out,
            HangupOutcome::Notify {
                customer_id: "cust-1".into(),
                reason: "agents-busy".into()
            }
        );
        assert!(m.is_empty());
    }

    #[test]
    fn active_call_agent_hangup_notifies_customer() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        m.on_answer("a1", "cust-1", None);
        let out = m.on_agent_hangup("a1", "remote", picker_none());
        assert_eq!(
            out,
            HangupOutcome::Notify {
                customer_id: "cust-1".into(),
                reason: "remote".into()
            }
        );
        assert!(m.is_empty());
    }

    #[test]
    fn customer_hangup_returns_agent_to_notify() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        m.on_answer("a1", "cust-1", None);
        assert_eq!(
            m.on_customer_hangup("cust-1"),
            CustomerHangup::NotifyAgent {
                agent_id: "a1".into()
            }
        );
        // Second hangup: no session.
        assert_eq!(m.on_customer_hangup("cust-1"), CustomerHangup::NoSession);
        assert!(m.is_empty());
    }

    #[test]
    fn agent_initiated_ringing_hangup_does_not_re_route() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_agent_offer("a1", "cust-1", offer(), Some("ch-9".into()), None);
        // Agent cancels their own outbound offer — even though other
        // agents exist, re-route doesn't apply (there is exactly one
        // intended callee).
        let out = m.on_agent_hangup("a1", "remote", picker_pick("a2"));
        assert_eq!(
            out,
            HangupOutcome::Notify {
                customer_id: "cust-1".into(),
                reason: "remote".into()
            }
        );
        assert!(m.is_empty());
    }

    #[test]
    fn in_call_lookup_covers_both_sides() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        assert!(m.is_user_in_call("cust-1"));
        assert!(m.is_user_in_call("a1"));
        assert!(!m.is_user_in_call("a2"));
        // A second customer calling while a1 rings is NOT stacked onto
        // a1: ringing_agents feeds the exclusion set.
        assert_eq!(m.ringing_agents(), HashSet::from(["a1".into()]));
        m.clear();
    }

    #[test]
    fn drop_sessions_of_cleans_both_roles() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        m.begin_customer_offer("cust-2", offer(), None, None, picker_pick("a2"));
        // Agent a1's socket drops: their session goes, cust-2/a2 stays.
        let dropped = m.drop_sessions_of("a1");
        assert_eq!(dropped.len(), 1);
        assert_eq!(dropped[0].customer_id, "cust-1");
        assert!(m.get("cust-2").is_some());
        // Customer cust-2's socket drops: session goes too.
        let dropped = m.drop_sessions_of("cust-2");
        assert_eq!(dropped.len(), 1);
        assert!(m.is_empty());
    }

    #[test]
    fn agent_in_call_cannot_place_another_call() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        // a1 is mid-call and tries to START a call to another customer.
        let out = m.begin_agent_offer("a1", "cust-2", offer(), None, None);
        assert_eq!(out, OfferOutcome::AgentBusy);
        // No session was created for cust-2.
        assert!(m.get("cust-2").is_none());
        m.clear();
    }

    #[test]
    fn counterpart_resolution() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));
        // Customer's ICE → their session's agent.
        assert_eq!(m.agent_for("cust-1").as_deref(), Some("a1"));
        // Agent's ICE with an explicit `to` → validated against the session.
        assert_eq!(m.agent_target("a1", "cust-1").as_deref(), Some("cust-1"));
        // Wrong pairing is rejected.
        assert_eq!(m.agent_target("a2", "cust-1"), None);
        m.clear();
    }

    #[test]
    fn socket_drop_ends_only_carried_sessions() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        // Customer sockets 1 (offerer) and agent socket 9 (answerer) carry
        // an ACTIVE call; agent's OTHER socket 10 must not affect it.
        m.begin_customer_offer("cust-1", offer(), None, Some(1), picker_pick("a1"));
        assert!(m.on_answer("a1", "cust-1", Some(9)).is_some());

        // An unrelated socket of the agent drops → call survives.
        assert!(m.end_sessions_of_socket("a1", 10).is_empty());
        assert!(m.is_user_in_call("cust-1"));

        // The ANSWERING socket drops → the active call ends.
        let ended = m.end_sessions_of_socket("a1", 9);
        assert_eq!(ended.len(), 1);
        assert_eq!(ended[0].notify_user_id, "cust-1");
        assert_eq!(ended[0].agent_id, "a1");
        assert!(!m.is_user_in_call("cust-1"));

        // A RINGING call whose offerer socket drops dies with it.
        m.begin_customer_offer("cust-2", offer(), None, Some(5), picker_pick("a1"));
        let ended = m.end_sessions_of_socket("cust-2", 5);
        assert_eq!(ended.len(), 1);
        assert_eq!(ended[0].notify_user_id, "a1");
        m.clear();
    }

    #[test]
    fn socket_carries_call_follows_the_calling_and_answering_sockets() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        // Customer socket 1 sends the offer; agent socket 9 answers.
        m.begin_customer_offer("cust-1", offer(), None, Some(1), picker_pick("a1"));

        // While RINGING only the OFFERER's socket carries the call — the
        // answerer hasn't picked up yet (idle budget stays plain for 9).
        assert!(m.socket_carries_call("cust-1", 1));
        assert!(!m.socket_carries_call("a1", 9));
        // Unrelated users/sockets never carry it.
        assert!(!m.socket_carries_call("a2", 1));
        assert!(!m.socket_carries_call("cust-1", 2));

        // Once ACTIVE both the offerer and the answerer carry it.
        assert!(m.on_answer("a1", "cust-1", Some(9)).is_some());
        assert!(m.socket_carries_call("cust-1", 1));
        assert!(m.socket_carries_call("a1", 9));
        // ...but the agent's OTHER socket does not.
        assert!(!m.socket_carries_call("a1", 10));

        // Session gone → nobody carries anything.
        assert_eq!(
            m.on_customer_hangup("cust-1"),
            CustomerHangup::NotifyAgent {
                agent_id: "a1".into()
            }
        );
        assert!(!m.socket_carries_call("cust-1", 1));
        assert!(!m.socket_carries_call("a1", 9));
        m.clear();
    }

    #[test]
    fn active_call_of_resolves_peer_for_both_sides() {
        let _g = TEST_LOCK.lock().unwrap();
        let m = sessions();
        m.clear();
        m.begin_customer_offer("cust-1", offer(), None, None, picker_pick("a1"));

        // Customer sees the agent as the peer, agent sees the customer.
        let c = m.active_call_of("cust-1").unwrap();
        assert_eq!(c.peer_id, "a1");
        assert_eq!(c.customer_id, "cust-1");
        assert_eq!(c.state, CallState::Ringing);
        assert_eq!(c.initiator, Initiator::Customer);
        let a = m.active_call_of("a1").unwrap();
        assert_eq!(a.peer_id, "cust-1");
        assert_eq!(a.initiator, Initiator::Customer);

        // Once active the state flips.
        assert!(m.on_answer("a1", "cust-1", None).is_some());
        assert_eq!(m.active_call_of("cust-1").unwrap().state, CallState::Active);

        // No session → null (the reconciliation signal).
        assert!(m.active_call_of("a2").is_none());
        m.on_customer_hangup("cust-1");
        assert!(m.active_call_of("cust-1").is_none());
        assert!(m.active_call_of("a1").is_none());
        m.clear();

        // Wire format: camelCase + snake_case enum values, `null` when
        // absent — the exact shape clients parse out of `registered`.
        let wire = serde_json::to_value(m.active_call_of("cust-1").unwrap_or(ActiveCallInfo {
            customer_id: "c".into(),
            peer_id: "a".into(),
            state: CallState::Active,
            initiator: Initiator::Agent,
        }))
        .unwrap();
        assert_eq!(
            wire,
            json!({
                "customerId": "c",
                "peerId": "a",
                "state": "active",
                "initiator": "agent",
            })
        );
    }
}

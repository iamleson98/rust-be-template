//! Run-level cancellation registry.
//!
//! Maps `job_run` ids → the [`CancellationToken`] the running handler
//! observes, so the admin "kill" endpoint (`POST /cron-jobs/{jobType}/cancel`)
//! can stop an in-flight job cooperatively. Lives between
//! [`JobService`](crate::service::job_service::JobService) (which cancels)
//! and the [`WorkerRunner`](super::runner::WorkerRunner) (which registers
//! and releases tokens at dispatch time).
//!
//! ## Lifecycle
//!
//! ```text
//!                     register(run_id, parent)
//!  (not seen yet) ─────────────────► live token stored
//!        │                                   │
//!  cancel(run_id)                     handler completes
//!  (pre-mark: the run is queued        release(run_id)
//!   but not dispatched yet)                  │
//!        └──► next register() returns        ▼
//!             an ALREADY-CANCELLED      (forgotten)
//!             token
//! ```
//!
//! Every token handed out is a **child** of the worker runner's shutdown
//! token, so a process-wide shutdown (Ctrl+C / SIGTERM) cancels running
//! jobs through the exact same cooperative path as the admin button.

use std::collections::{HashMap, HashSet};

use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Default)]
pub struct RunCancels {
    /// Tokens of dispatched (currently executing) runs.
    live: Mutex<HashMap<Uuid, CancellationToken>>,
    /// Runs cancelled while still queued — their next dispatch starts
    /// already-cancelled.
    pending: Mutex<HashSet<Uuid>>,
}

impl RunCancels {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register the dispatch of `run_id`. The returned token is a child
    /// of `parent` (the runner's shutdown token) and is pre-cancelled
    /// when the run was killed while queued.
    pub fn register(&self, run_id: Uuid, parent: &CancellationToken) -> CancellationToken {
        let token = parent.child_token();
        let mut live = self.live.lock();
        // A late cancel that raced the dispatch: cancel immediately.
        if self.pending.lock().remove(&run_id) {
            token.cancel();
        }
        live.insert(run_id, token.clone());
        token
    }

    /// Request cancellation of `run_id`:
    /// - dispatched → cancels the live token (handler observes it),
    /// - still queued → pre-marks it so the handler exits immediately
    ///   when a worker finally picks the envelope up.
    pub fn cancel(&self, run_id: Uuid) {
        let live_token = self.live.lock().get(&run_id).cloned();
        match live_token {
            Some(token) => token.cancel(),
            None => {
                self.pending.lock().insert(run_id);
            }
        }
    }

    /// Forget a finished run (called on every handler exit path,
    /// including timeout and panic).
    pub fn release(&self, run_id: Uuid) {
        self.live.lock().remove(&run_id);
        self.pending.lock().remove(&run_id);
    }

    /// Whether `run_id` is currently dispatched (used by tests/logging).
    pub fn is_live(&self, run_id: Uuid) -> bool {
        self.live.lock().contains_key(&run_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_then_cancel_cancels_the_live_token() {
        let rc = RunCancels::new();
        let parent = CancellationToken::new();
        let id = Uuid::new_v4();

        let token = rc.register(id, &parent);
        assert!(!token.is_cancelled());
        assert!(rc.is_live(id));

        rc.cancel(id);
        assert!(token.is_cancelled(), "live token must observe the cancel");
    }

    #[test]
    fn cancel_before_register_pre_cancels_the_next_dispatch() {
        let rc = RunCancels::new();
        let parent = CancellationToken::new();
        let id = Uuid::new_v4();

        rc.cancel(id); // killed while queued
        let token = rc.register(id, &parent);
        assert!(token.is_cancelled(), "dispatch must start already cancelled");

        rc.release(id);
        rc.cancel(id); // released — records as pending again, no panic
        assert!(!rc.is_live(id));
    }

    #[test]
    fn parent_shutdown_cancels_every_child() {
        let rc = RunCancels::new();
        let parent = CancellationToken::new();
        let a = rc.register(Uuid::new_v4(), &parent);
        let b = rc.register(Uuid::new_v4(), &parent);

        parent.cancel();
        assert!(a.is_cancelled() && b.is_cancelled());
    }

    #[test]
    fn release_forgets_the_run() {
        let rc = RunCancels::new();
        let parent = CancellationToken::new();
        let id = Uuid::new_v4();
        let token = rc.register(id, &parent);

        rc.release(id);
        assert!(!rc.is_live(id));
        // Late cancel after release is recorded as pending, never panics.
        rc.cancel(id);
        assert!(!token.is_cancelled(), "released token is untouched");
    }
}

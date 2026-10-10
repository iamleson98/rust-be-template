//! In-process cancellation of running jobs.
//!
//! The runner registers each job's token here while it runs; the admin
//! cancel button fires it so the job stops at once. A job running in
//! another process is reached through the queue instead: cancelling
//! flags its row, and that worker's next lease renewal fails and fires
//! the token there.
//!
//! Every token is a child of the runner's shutdown token, so shutdown
//! stops running jobs through the same path.

use std::collections::HashMap;

use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Default)]
pub struct RunCancels {
    live: Mutex<HashMap<Uuid, CancellationToken>>,
}

impl RunCancels {
    pub fn new() -> Self {
        Self::default()
    }

    /// A token for job `id` (a child of `parent`), tracked until
    /// [`release`](Self::release).
    pub fn register(&self, id: Uuid, parent: &CancellationToken) -> CancellationToken {
        let token = parent.child_token();
        self.live.lock().insert(id, token.clone());
        token
    }

    /// Cancel job `id` if it runs in this process. `true` = it did.
    pub fn cancel(&self, id: Uuid) -> bool {
        match self.live.lock().get(&id) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    /// Forget job `id` (it finished, one way or another).
    pub fn release(&self, id: Uuid) {
        self.live.lock().remove(&id);
    }

    pub fn is_live(&self, id: Uuid) -> bool {
        self.live.lock().contains_key(&id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_reaches_a_registered_job_only() {
        let rc = RunCancels::new();
        let parent = CancellationToken::new();
        let id = Uuid::new_v4();
        assert!(!rc.cancel(id), "nothing registered yet");
        let token = rc.register(id, &parent);
        assert!(rc.cancel(id));
        assert!(token.is_cancelled());
        rc.release(id);
        assert!(!rc.is_live(id));
        assert!(!rc.cancel(id));
    }

    #[test]
    fn shutdown_cancels_every_running_job() {
        let rc = RunCancels::new();
        let parent = CancellationToken::new();
        let a = rc.register(Uuid::new_v4(), &parent);
        let b = rc.register(Uuid::new_v4(), &parent);
        parent.cancel();
        assert!(a.is_cancelled() && b.is_cancelled());
    }
}

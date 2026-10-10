//! Background jobs.
//!
//! * [`Job`] — one kind of work: a stable `KIND`, typed `Args`, a
//!   [`JobPolicy`] (timeout, attempts, retry backoff) and `perform`.
//! * [`JobQueue`] — the durable queue in the app database
//!   (`background_job`, through [`crate::store::JobQueueStore`]): leased
//!   claims, retries with backoff, a dead set, de-duplication keys.
//! * [`WorkerRunner`] — consumer tasks that claim, run and settle jobs,
//!   reporting each run to a [`RunObserver`] (run history).
//!
//! The built-in jobs and their default schedules are listed in
//! [`crate::jobs::catalog`]; adding a job is a `Job` impl plus one
//! catalog entry.

pub use self::cancel::RunCancels;
pub use self::job::{
    Backoff, Job, JobContext, JobPolicy, JobRegistry, NoObserver, RunObserver, RunOutcome,
};
pub use self::queue::{EnqueueOptions, Enqueued, JobQueue, QueueCounts, QueuedJob};
pub use self::runner::WorkerRunner;

mod cancel;
mod job;
mod queue;
mod runner;

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

// ── Process-global shutdown signal ──────────────────────────────
//
// The runner is spawned deep inside `server::bootstrap`, but the
// graceful-shutdown future lives in `server::run`. Rather than thread
// the token through `AppState` (it is not request-scoped state), the
// bootstrap stores it here once — the same "in-process singleton"
// pattern the WebSocket hubs use.

/// Handle set by [`set_shutdown_handle`] at bootstrap.
static SHUTDOWN: OnceLock<CancellationToken> = OnceLock::new();

/// The worker-runner supervisor handle set by [`set_supervisor`] at
/// bootstrap. `server::run`'s shutdown future awaits it (bounded) so the
/// process never exits while a worker is mid-drain — and force-exits if
/// one refuses to stop (an orphaned `spawn_blocking` body).
static SUPERVISOR: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();

/// Remember the runner's shutdown token so `server::run`'s
/// graceful-shutdown future can signal workers to drain. Cancelling it
/// also cancels every in-flight job handler (their tokens are children).
pub fn set_shutdown_handle(handle: CancellationToken) {
    let _ = SHUTDOWN.set(handle);
}

/// The process-wide worker shutdown token (a fresh, never-cancelled one
/// when no runner was started, e.g. `SCHEDULER_ENABLED=false`).
pub fn shutdown_token() -> CancellationToken {
    SHUTDOWN.get_or_init(CancellationToken::new).clone()
}

/// Signal all worker tasks to exit after their current job and cancel
/// in-flight job handlers. No-op when no worker was ever started
/// (e.g. `SCHEDULER_ENABLED=false`).
pub fn notify_shutdown() {
    shutdown_token().cancel();
}

/// Stash the runner supervisor's `JoinHandle` (awaited during shutdown).
pub fn set_supervisor(handle: JoinHandle<()>) {
    if let Ok(mut slot) = SUPERVISOR.get_or_init(|| Mutex::new(None)).lock() {
        slot.replace(handle);
    }
}

/// Wait (at most `timeout`) for the worker supervisor to finish after
/// [`notify_shutdown`]. Returns `true` when all workers stopped (or none
/// were ever started); `false` on timeout — the caller should then
/// force-exit, because an orphaned `spawn_blocking` job body would
/// otherwise block the tokio runtime's drop indefinitely (the runtime
/// waits for blocking tasks on `main`'s return).
pub async fn await_worker_shutdown(timeout: Duration) -> bool {
    let handle = SUPERVISOR
        .get()
        .and_then(|m| m.lock().ok().and_then(|mut g| g.take()));
    match handle {
        // No runner started in this process — nothing to wait for.
        None => true,
        Some(handle) => tokio::time::timeout(timeout, handle).await.is_ok(),
    }
}

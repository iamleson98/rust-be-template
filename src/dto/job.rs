/// Status values used by [`Model::status`].
pub mod status {
    /// Enqueued, not yet picked up by a worker.
    pub const QUEUED: &str = "queued";
    /// A worker handler is executing the job.
    pub const RUNNING: &str = "running";
    /// Completed successfully (`finished_at` set).
    pub const SUCCEEDED: &str = "succeeded";
    /// Terminated with an error (`error` + `finished_at` set).
    pub const FAILED: &str = "failed";
}

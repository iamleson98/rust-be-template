use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;

use super::backend::JobEnvelope;

pub type JobHandler = Arc<
    dyn Fn(JobEnvelope) -> futures::future::BoxFuture<'static, anyhow::Result<()>> + Send + Sync,
>;

/// Execution policy for one job type — how the runner treats it.
///
/// The defaults preserve the runner's historical global behaviour
/// (5-minute timeout, 10 attempts). Long-running jobs such as the OSM
/// import register a custom policy (hours-long timeout, minimal
/// retries) instead of the runner special-casing them.
#[derive(Debug, Clone)]
pub struct JobPolicy {
    /// Kill the handler after this long. The future is dropped (a
    /// `spawn_blocking` body keeps running to completion in the
    /// background but its result is discarded) and the job is nacked.
    pub timeout: Duration,
    /// Total delivery attempts before the job is dropped as poison.
    /// The initial run counts as attempt 1.
    pub max_attempts: u32,
}

impl Default for JobPolicy {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(300),
            max_attempts: 10,
        }
    }
}

#[derive(Default)]
pub struct JobRegistry {
    handlers: RwLock<HashMap<String, JobHandler>>,
    policies: RwLock<HashMap<String, JobPolicy>>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a handler with the default [`JobPolicy`].
    pub fn register<F, Fut>(&self, job_type: impl Into<String>, handler: F)
    where
        F: Fn(JobEnvelope) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = anyhow::Result<()>> + Send + 'static,
    {
        self.register_with_policy(job_type, handler, JobPolicy::default());
    }

    /// Register a handler with an explicit [`JobPolicy`].
    pub fn register_with_policy<F, Fut>(
        &self,
        job_type: impl Into<String>,
        handler: F,
        policy: JobPolicy,
    ) where
        F: Fn(JobEnvelope) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = anyhow::Result<()>> + Send + 'static,
    {
        let key: String = job_type.into();
        let f = Arc::new(move |env: JobEnvelope| Box::pin(handler(env)) as _);
        self.handlers.write().insert(key.clone(), f);
        self.policies.write().insert(key, policy);
    }

    pub fn get(&self, job_type: &str) -> Option<JobHandler> {
        self.handlers.read().get(job_type).cloned()
    }

    /// The policy for `job_type` (the default when unregistered).
    pub fn policy(&self, job_type: &str) -> JobPolicy {
        self.policies
            .read()
            .get(job_type)
            .cloned()
            .unwrap_or_default()
    }
}

/// Convenience marker so callers can pass enums directly.
pub trait JobType {
    fn as_str(&self) -> &'static str;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unregistered_jobs_get_the_default_policy() {
        let r = JobRegistry::new();
        assert_eq!(r.policy("nope").timeout, Duration::from_secs(300));
        assert_eq!(r.policy("nope").max_attempts, 10);
        assert!(r.get("nope").is_none());
    }

    #[test]
    fn registered_policy_is_returned() {
        let r = JobRegistry::new();
        r.register_with_policy(
            "long.job",
            |_: JobEnvelope| async { Ok(()) },
            JobPolicy {
                timeout: Duration::from_secs(21_600),
                max_attempts: 2,
            },
        );
        assert_eq!(r.policy("long.job").timeout, Duration::from_secs(21_600));
        assert_eq!(r.policy("long.job").max_attempts, 2);
        assert!(r.get("long.job").is_some());
    }
}

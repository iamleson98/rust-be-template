use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use parking_lot::RwLock;

use super::backend::JobEnvelope;

pub type JobHandler = Arc<dyn Fn(JobEnvelope) -> futures::future::BoxFuture<'static, anyhow::Result<()>> + Send + Sync>;

#[derive(Default)]
pub struct JobRegistry {
    handlers: RwLock<HashMap<String, JobHandler>>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register<F, Fut>(&self, job_type: impl Into<String>, handler: F)
    where
        F: Fn(JobEnvelope) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = anyhow::Result<()>> + Send + 'static,
    {
        let f = Arc::new(move |env: JobEnvelope| Box::pin(handler(env)) as _);
        self.handlers.write().insert(job_type.into(), f);
    }

    pub fn get(&self, job_type: &str) -> Option<JobHandler> {
        self.handlers.read().get(job_type).cloned()
    }
}

/// Convenience marker so callers can pass enums directly.
pub trait JobType {
    fn as_str(&self) -> &'static str;
}

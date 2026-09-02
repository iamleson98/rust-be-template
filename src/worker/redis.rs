use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use tokio::sync::Notify;

use crate::config::WorkerConfig;

use super::backend::{JobEnvelope, WorkerBroker};

const QUEUE_KEY: &str = "jobs:queue";

/// Redis list-backed broker. Uses `BRPOP` (blocking pop) for dequeue,
/// `LPUSH` for enqueue. Low latency, durable within Redis TTL.
pub struct RedisBroker {
    conn: ConnectionManager,
    poll_interval: Duration,
    shutdown: Arc<Notify>,
}

impl RedisBroker {
    pub async fn connect(cfg: &WorkerConfig) -> anyhow::Result<Self> {
        // `WORKER_REDIS_URL` is what docker-compose / DEPLOYMENT.md set;
        // fall back to the app-wide `REDIS_URL` (cache backend) for
        // single-Redis setups. (Previously only `REDIS_URL` was read,
        // so containers pointing at the `redis` service never connected.)
        let url = std::env::var("WORKER_REDIS_URL")
            .or_else(|_| std::env::var("REDIS_URL"))
            .unwrap_or_else(|_| "redis://localhost:6379/0".into());
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self {
            conn,
            poll_interval: cfg.poll_interval(),
            shutdown: Arc::new(Notify::new()),
        })
    }

    pub fn shutdown_handle(&self) -> Arc<Notify> {
        self.shutdown.clone()
    }
}

#[async_trait]
impl WorkerBroker for RedisBroker {
    async fn enqueue(&self, env: JobEnvelope) -> anyhow::Result<()> {
        let mut conn = self.conn.clone();
        let payload = serde_json::to_vec(&env)?;
        let _: () = conn.lpush(QUEUE_KEY, payload).await?;
        Ok(())
    }

    async fn dequeue(&self) -> anyhow::Result<Option<JobEnvelope>> {
        // BRPOP returns (key, value) or None on timeout. Short timeout
        // lets us periodically yield for shutdown checks.
        loop {
            let mut conn = self.conn.clone();
            let timeout = self.poll_interval.as_secs_f64();
            let result: Option<(String, Vec<u8>)> = conn.brpop(QUEUE_KEY, timeout).await?;
            match result {
                Some((_k, v)) => {
                    let env: JobEnvelope = serde_json::from_slice(&v)?;
                    return Ok(Some(env));
                }
                None => {
                    // Timeout on BRPOP — loop and try again. Real shutdown
                    // is delivered via the parent task being cancelled.
                    continue;
                }
            }
        }
    }

    async fn ack(&self, _env: &JobEnvelope) -> anyhow::Result<()> {
        // Redis list is fire-and-forget; nothing to ack.
        Ok(())
    }

    async fn nack(&self, env: &JobEnvelope, err: &str) -> anyhow::Result<()> {
        let mut env = env.clone();
        env.attempts += 1;
        tracing::warn!(job_id = %env.id, error = err, attempts = env.attempts, "nack re-enqueue");
        self.enqueue(env).await
    }

    fn name(&self) -> &'static str {
        "redis"
    }
}

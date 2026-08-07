use async_trait::async_trait;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// A job as it appears on the wire. The broker doesn't care about the
/// payload shape — that's the registry's job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobEnvelope {
    pub id: Uuid,
    pub job_type: String,
    pub payload: Value,
    /// Number of times this job has already been retried. Brokers may
    /// bump this when re-enqueueing after a handler failure.
    pub attempts: u32,
}

impl JobEnvelope {
    pub fn new<T: Serialize>(job_type: impl Into<String>, payload: &T) -> anyhow::Result<Self> {
        Ok(Self {
            id: Uuid::new_v4(),
            job_type: job_type.into(),
            payload: serde_json::to_value(payload)?,
            attempts: 0,
        })
    }

    pub fn decode_payload<T: DeserializeOwned>(&self) -> anyhow::Result<T> {
        Ok(serde_json::from_value(self.payload.clone())?)
    }
}

/// A broker is anything that can enqueue and dequeue jobs.
///
/// Implementations:
/// - `RedisBroker`: BRPUSH/BRPOP list semantics
/// - `DbBroker`: SKIP LOCKED over a `jobs` table
/// - `KafkaBroker`: rdkafka producer + consumer
#[async_trait]
pub trait WorkerBroker: Send + Sync {
    /// Push a job onto the queue.
    async fn enqueue(&self, env: JobEnvelope) -> anyhow::Result<()>;

    /// Block until a job is available, then return it. Returns `None` if
    /// the broker signals shutdown (e.g. via a sentinel value).
    async fn dequeue(&self) -> anyhow::Result<Option<JobEnvelope>>;

    /// Mark a job as successfully completed. Brokers that don't track
    /// job state (Redis, Kafka) can no-op; `DbBroker` deletes the row.
    async fn ack(&self, env: &JobEnvelope) -> anyhow::Result<()>;

    /// Mark a job as failed. Brokers may re-enqueue with incremented
    /// `attempts`, or move to a dead-letter queue.
    async fn nack(&self, env: &JobEnvelope, err: &str) -> anyhow::Result<()>;

    /// Human-readable name for logs/metrics.
    fn name(&self) -> &'static str;
}

//! Pluggable async worker broker. Trait + three backends:
//! - `RedisBroker`: BLPOP/BRPOP, sub-ms latency, simplest to deploy
//! - `DbBroker`: Postgres `FOR UPDATE SKIP LOCKED` — zero new infra
//! - `KafkaBroker`: rdkafka producer/consumer — high-throughput at scale
//!
//! The [`runner`] consumes jobs from whichever broker is selected and
//! dispatches them to registered handlers.

pub use self::backend::{JobEnvelope, WorkerBroker};
pub use self::db::DbBroker;
pub use self::kafka::KafkaBroker;
pub use self::redis::RedisBroker;
pub use self::registry::{JobHandler, JobRegistry, JobType};
pub use self::runner::WorkerRunner;

mod backend;
mod db;
mod kafka;
mod redis;
mod registry;
mod runner;

use crate::config::{WorkerBackend as WorkerBackendCfg, WorkerConfig};

/// Construct the configured broker.
pub async fn build(cfg: &WorkerConfig) -> anyhow::Result<Box<dyn WorkerBroker>> {
    match cfg.backend {
        WorkerBackendCfg::Redis => Ok(Box::new(RedisBroker::connect(&cfg).await?)),
        WorkerBackendCfg::Db => Ok(Box::new(DbBroker::new().await?)),
        WorkerBackendCfg::Kafka => Ok(Box::new(KafkaBroker::new(&cfg).await?)),
    }
}

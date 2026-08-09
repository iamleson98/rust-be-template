use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Notify;

use crate::config::WorkerConfig;

use super::backend::{JobEnvelope, WorkerBroker};

/// Kafka-backed broker using `rdkafka`. Producer is async; consumer uses
/// `StreamConsumer` with manual commit-per-message.
///
/// **Compile-time gating:** this backend is only available when the crate
/// is built with `--features kafka`. Otherwise [`KafkaBroker::new`]
/// always returns an error and the code has no dependency on librdkafka.
pub struct KafkaBroker {
    #[cfg(feature = "kafka")]
    producer: rdkafka::producer::FutureProducer,
    #[cfg(feature = "kafka")]
    consumer: rdkafka::consumer::StreamConsumer,
    topic: String,
    shutdown: Arc<Notify>,
}

impl KafkaBroker {
    pub async fn new(cfg: &WorkerConfig) -> anyhow::Result<Self> {
        #[cfg(feature = "kafka")]
        {
            use rdkafka::config::{ClientConfig, RDKafkaLogLevel};
            use rdkafka::consumer::{Consumer, StreamConsumer};
            use rdkafka::producer::{FutureProducer, FutureRecord};

            let producer: FutureProducer = ClientConfig::new()
                .set("bootstrap.servers", &cfg.kafka_brokers)
                .set("message.timeout.ms", "5000")
                .create()
                .map_err(|e| anyhow::anyhow!("kafka producer: {e}"))?;

            let consumer: StreamConsumer = ClientConfig::new()
                .set("bootstrap.servers", &cfg.kafka_brokers)
                .set("group.id", &cfg.kafka_group_id)
                .set("enable.auto.commit", "false")
                .set("auto.offset.reset", "earliest")
                .set_log_level(RDKafkaLogLevel::Warning)
                .create()
                .map_err(|e| anyhow::anyhow!("kafka consumer: {e}"))?;

            consumer.subscribe(&[&cfg.kafka_topic])?;

            // Warm the producer by sending a no-op (avoids first-send delay).
            let _ = producer
                .send(
                    FutureRecord::to(&cfg.kafka_topic).payload("").key("warmup"),
                    Duration::from_secs(5),
                )
                .await;

            Ok(Self {
                producer,
                consumer,
                topic: cfg.kafka_topic.clone(),
                shutdown: Arc::new(Notify::new()),
            })
        }
        #[cfg(not(feature = "kafka"))]
        {
            anyhow::bail!(
                "Kafka broker is not compiled in. Rebuild with `--features kafka` to enable it."
            )
        }
    }

    pub fn shutdown_handle(&self) -> Arc<Notify> {
        self.shutdown.clone()
    }
}

#[async_trait]
impl WorkerBroker for KafkaBroker {
    async fn enqueue(&self, env: JobEnvelope) -> anyhow::Result<()> {
        #[cfg(feature = "kafka")]
        {
            use rdkafka::producer::FutureRecord;
            let payload = serde_json::to_vec(&env)?;
            let key = env.id.to_string();
            self.producer
                .send(
                    FutureRecord::to(&self.topic).payload(&payload).key(&key),
                    Duration::from_secs(5),
                )
                .await
                .map_err(|(e, _)| anyhow::anyhow!("kafka enqueue: {e}"))?;
            Ok(())
        }
        #[cfg(not(feature = "kafka"))]
        {
            let _ = env;
            anyhow::bail!("kafka feature not enabled")
        }
    }

    async fn dequeue(&self) -> anyhow::Result<Option<JobEnvelope>> {
        #[cfg(feature = "kafka")]
        {
            use rdkafka::Message;
            match self.consumer.recv().await {
                Ok(m) => {
                    let payload = m.payload().unwrap_or(&[]);
                    let env: JobEnvelope = serde_json::from_slice(payload)?;
                    Ok(Some(env))
                }
                Err(e) => {
                    tracing::warn!(error = %e, "kafka recv error");
                    Ok(None)
                }
            }
        }
        #[cfg(not(feature = "kafka"))]
        {
            anyhow::bail!("kafka feature not enabled")
        }
    }

    async fn ack(&self, _env: &JobEnvelope) -> anyhow::Result<()> {
        #[cfg(feature = "kafka")]
        {
            use rdkafka::consumer::CommitMode;
            self.consumer
                .commit_consumer_state(CommitMode::Async)
                .map_err(|e| anyhow::anyhow!("kafka commit: {e}"))?;
        }
        Ok(())
    }

    async fn nack(&self, env: &JobEnvelope, err: &str) -> anyhow::Result<()> {
        let mut env = env.clone();
        env.attempts += 1;
        tracing::warn!(job_id = %env.id, error = err, attempts = env.attempts, "nack re-enqueue");
        self.enqueue(env).await
    }

    fn name(&self) -> &'static str {
        "kafka"
    }
}

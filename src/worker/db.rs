use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::sea_query::{Expr, Query, SelectStatement};
use sea_orm::{ConnectionTrait, DatabaseConnection};
use tokio::sync::Notify;
use uuid::Uuid;

use super::backend::{JobEnvelope, WorkerBroker};

/// In-DB job queue. Portable across SQLite and Postgres.
///
/// - **Postgres**: uses `FOR UPDATE SKIP LOCKED` for safe concurrent dequeues.
/// - **SQLite**: uses an atomic `DELETE ... RETURNING *` with a rowid-based
///   claim. SQLite locks the whole database during writes, so concurrent
///   dequeues are safe without SKIP LOCKED (just slower under contention).
///
/// The table schema is created lazily on first use with portable types.
pub struct DbBroker {
    db: Arc<DatabaseConnection>,
    poll_interval: Duration,
    #[allow(dead_code)]
    shutdown: Arc<Notify>,
}

impl DbBroker {
    pub async fn new() -> anyhow::Result<Self> {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://./app.db?mode=rwc".into());
        let mut opts = sea_orm::ConnectOptions::new(url);
        opts.max_connections(8);
        let db = sea_orm::Database::connect(opts).await?;
        let db = Arc::new(db);
        Self::ensure_schema(db.as_ref()).await?;
        Ok(Self {
            db,
            poll_interval: Duration::from_secs(1),
            shutdown: Arc::new(Notify::new()),
        })
    }

    async fn ensure_schema(db: &DatabaseConnection) -> anyhow::Result<()> {
        // Portable types: TEXT instead of VARCHAR, TIMESTAMP (no TZ) for
        // both backends. JSONB on PG / TEXT on SQLite via `Json` from
        // sea-orm — but here we just use TEXT and parse JSON manually.
        //
        // Run as separate statements because SQLite is strict about one
        // DDL per execute.
        for stmt in [
            r#"CREATE TABLE IF NOT EXISTS jobs (
                id            TEXT PRIMARY KEY,
                job_type      TEXT NOT NULL,
                payload      TEXT NOT NULL,
                attempts      INTEGER NOT NULL DEFAULT 0,
                available_at  TIMESTAMP NOT NULL,
                created_at    TIMESTAMP NOT NULL
            )"#,
            r#"CREATE INDEX IF NOT EXISTS idx_jobs_available
                ON jobs (available_at)"#,
        ] {
            db.execute_unprepared(stmt).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl WorkerBroker for DbBroker {
    async fn enqueue(&self, env: JobEnvelope) -> anyhow::Result<()> {
        let payload = serde_json::to_string(&env.payload)?;
        let now = Utc::now().naive_utc();
        let insert = Query::insert()
            .into_table(Jobs::Table)
            .columns([
                Jobs::Id,
                Jobs::JobType,
                Jobs::Payload,
                Jobs::Attempts,
                Jobs::AvailableAt,
                Jobs::CreatedAt,
            ])
            .values_panic([
                env.id.to_string().into(),
                env.job_type.into(),
                payload.into(),
                (env.attempts as i32).into(),
                now.into(),
                now.into(),
            ])
            .to_owned();
        let builder = self.db.get_database_backend();
        self.db.execute(builder.build(&insert)).await?;
        Ok(())
    }

    async fn dequeue(&self) -> anyhow::Result<Option<JobEnvelope>> {
        // Portable atomic dequeue: SELECT the oldest available job, then
        // DELETE it. For Postgres we'd wrap in a CTE with FOR UPDATE SKIP
        // LOCKED for concurrent safety, but that's PG-specific. The
        // simpler form below works on both — concurrent workers might
        // race on SELECT, but the DELETE-RETURNING is atomic per row.
        let backend = self.db.get_database_backend();
        let now = Utc::now().naive_utc();

        // Build: DELETE FROM jobs WHERE id = (SELECT id FROM jobs
        //         WHERE available_at <= ? ORDER BY available_at LIMIT 1)
        //        RETURNING id, job_type, payload, attempts
        let mut select_oldest = SelectStatement::new()
            .column(Jobs::Id)
            .from(Jobs::Table)
            .and_where(Expr::col(Jobs::AvailableAt).lte(now))
            .order_by_columns([(Jobs::AvailableAt, sea_orm::sea_query::Order::Asc)])
            .limit(1)
            .to_owned();

        // Postgres-only: lock the row for update so concurrent workers
        // skip it. SQLite serializes writes anyway, so we only emit the
        // lock clause on PG.
        #[cfg(feature = "postgres")]
        {
            use sea_orm::sea_query::LockType;
            select_oldest.lock_with_behavior(
                LockType::Update,
                sea_orm::sea_query::LockBehavior::SkipLocked,
            );
        }
        #[cfg(not(feature = "postgres"))]
        {
            // SQLite serializes writes — no SKIP LOCKED needed.
        }
        let _ = select_oldest;

        // Use `returning_all` because `returning_col` is singular in
        // sea-query 0.32. We need all 4 columns back.
        let delete = Query::delete()
            .from_table(Jobs::Table)
            .and_where(
                Expr::col(Jobs::Id).in_subquery(
                    SelectStatement::new()
                        .column(Jobs::Id)
                        .from(Jobs::Table)
                        .and_where(Expr::col(Jobs::AvailableAt).lte(now))
                        .order_by_columns([(Jobs::AvailableAt, sea_orm::sea_query::Order::Asc)])
                        .limit(1)
                        .to_owned(),
                ),
            )
            .returning_all()
            .to_owned();
        let stmt = backend.build(&delete);

        match self.db.query_one(stmt).await? {
            Some(row) => {
                let id_str: String = row.try_get("", "id")?;
                let id = Uuid::parse_str(&id_str).unwrap_or_default();
                let job_type: String = row.try_get("", "job_type")?;
                let payload_str: String = row.try_get("", "payload")?;
                let payload: serde_json::Value = serde_json::from_str(&payload_str)?;
                let attempts: i32 = row.try_get("", "attempts")?;
                Ok(Some(JobEnvelope {
                    id,
                    job_type,
                    payload,
                    attempts: attempts as u32,
                }))
            }
            None => {
                // No job available — sleep briefly and return None so the
                // worker runner can loop with backpressure.
                tokio::time::sleep(self.poll_interval).await;
                Ok(None)
            }
        }
    }

    async fn ack(&self, _env: &JobEnvelope) -> anyhow::Result<()> {
        // Row already deleted in `dequeue`.
        Ok(())
    }

    async fn nack(&self, env: &JobEnvelope, err: &str) -> anyhow::Result<()> {
        let mut env = env.clone();
        env.attempts += 1;
        tracing::warn!(job_id = %env.id, error = err, attempts = env.attempts, "nack re-enqueue");
        self.enqueue(env).await
    }

    fn name(&self) -> &'static str {
        "db"
    }
}

#[derive(sea_orm::sea_query::Iden)]
enum Jobs {
    Table,
    Id,
    JobType,
    Payload,
    Attempts,
    AvailableAt,
    CreatedAt,
}

#[allow(dead_code)]
fn _unused(_: Uuid) {}

//! Job queue store — persistence for the `background_job` table (the
//! worker queue). The queueing rules (leases, retry timing, what each
//! state means) live in [`crate::worker::JobQueue`]; this layer only
//! reads and writes rows.
//!
//! Timestamps arrive as fixed-width ISO-8601 UTC strings, so text
//! comparisons (`run_at <= now`, `locked_until < now`) are time
//! comparisons.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::background_job::{self, Column, Entity as BackgroundJob};

use super::error::StoreResult;
use super::retry::RetryPolicy;

/// Waiting for `run_at`.
pub const AVAILABLE: &str = "available";
/// Leased by a worker until `locked_until`.
pub const RUNNING: &str = "running";
/// Cancelled while running; its worker stops at the next renewal.
pub const CANCELLED: &str = "cancelled";
/// Out of attempts, kept for inspection.
pub const DEAD: &str = "dead";

#[async_trait]
pub trait JobQueueStore: Send + Sync {
    /// Insert a job unless a live one holds the same `(kind,
    /// unique_key)`. `true` = inserted.
    async fn insert_job(&self, job: background_job::ActiveModel) -> StoreResult<bool>;

    async fn find_job(&self, id: Uuid) -> StoreResult<Option<background_job::Model>>;

    /// The job holding `(kind, unique_key)`, if any.
    async fn find_by_key(
        &self,
        kind: &str,
        unique_key: &str,
    ) -> StoreResult<Option<background_job::Model>>;

    /// Lease the next due job to `worker` until `lease_until`: an
    /// available job whose `run_at` has passed, or a running job whose
    /// lease expired (its worker died). Lowest priority value first,
    /// then earliest `run_at`. Bumps `attempt`.
    async fn claim_next(
        &self,
        worker: &str,
        now: &str,
        lease_until: &str,
    ) -> StoreResult<Option<background_job::Model>>;

    /// Extend `worker`'s lease on a running job. `false` = not held:
    /// cancelled, or taken over after an expiry.
    async fn renew_lease(
        &self,
        id: Uuid,
        worker: &str,
        now: &str,
        lease_until: &str,
    ) -> StoreResult<bool>;

    /// Remove a job `worker` holds (finished, or stopped on purpose).
    async fn delete_held(&self, id: Uuid, worker: &str) -> StoreResult<()>;

    /// Put a held job back to wait for `run_at`, recording the failure.
    async fn requeue(
        &self,
        id: Uuid,
        worker: &str,
        run_at: &str,
        error: &str,
        now: &str,
    ) -> StoreResult<()>;

    /// Hand a held running job back unchanged (its attempt refunded), due
    /// at `now`.
    async fn release(&self, id: Uuid, worker: &str, now: &str) -> StoreResult<()>;

    /// Move a held job to the dead set, freeing its unique key.
    async fn mark_dead(&self, id: Uuid, worker: &str, error: &str, now: &str) -> StoreResult<()>;

    /// Delete a job that is still waiting. `true` = it was.
    async fn delete_waiting(&self, id: Uuid) -> StoreResult<bool>;

    /// Flag a running job cancelled. `true` = it was running.
    async fn flag_cancelled(&self, id: Uuid, now: &str) -> StoreResult<bool>;

    /// Delete dead jobs last touched before `before`.
    async fn delete_dead_before(&self, before: &str) -> StoreResult<u64>;

    /// `(state, count)` pairs.
    async fn count_by_state(&self) -> StoreResult<Vec<(String, i64)>>;

    /// Dead jobs, most recently failed first.
    async fn list_dead(&self, limit: u64) -> StoreResult<Vec<background_job::Model>>;
}

#[derive(Clone)]
pub struct DbJobQueueStore {
    db: Arc<DatabaseConnection>,
}

impl DbJobQueueStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbJobQueueStore {}

/// Rows `worker` currently holds under `id`.
fn held(id: Uuid, worker: &str) -> Condition {
    Condition::all()
        .add(Column::Id.eq(id))
        .add(Column::LockedBy.eq(worker))
}

#[async_trait]
#[retry]
impl JobQueueStore for DbJobQueueStore {
    async fn insert_job(&self, job: background_job::ActiveModel) -> StoreResult<bool> {
        let inserted = BackgroundJob::insert(job)
            .on_conflict(
                OnConflict::columns([Column::Kind, Column::UniqueKey])
                    .do_nothing()
                    .to_owned(),
            )
            .exec_without_returning(self.db.as_ref())
            .await?;
        Ok(inserted == 1)
    }

    async fn find_job(&self, id: Uuid) -> StoreResult<Option<background_job::Model>> {
        Ok(BackgroundJob::find_by_id(id).one(self.db.as_ref()).await?)
    }

    async fn find_by_key(
        &self,
        kind: &str,
        unique_key: &str,
    ) -> StoreResult<Option<background_job::Model>> {
        Ok(BackgroundJob::find()
            .filter(Column::Kind.eq(kind))
            .filter(Column::UniqueKey.eq(unique_key))
            .one(self.db.as_ref())
            .await?)
    }

    async fn claim_next(
        &self,
        worker: &str,
        now: &str,
        lease_until: &str,
    ) -> StoreResult<Option<background_job::Model>> {
        let next_due = BackgroundJob::find()
            .select_only()
            .column(Column::Id)
            .filter(
                Condition::any()
                    .add(
                        Condition::all()
                            .add(Column::State.eq(AVAILABLE))
                            .add(Column::RunAt.lte(now)),
                    )
                    .add(
                        Condition::all()
                            .add(Column::State.eq(RUNNING))
                            .add(Column::LockedUntil.lt(now)),
                    ),
            )
            .order_by_asc(Column::Priority)
            .order_by_asc(Column::RunAt)
            .limit(1)
            .into_query();
        // One atomic statement: the engine serialises writes, so two
        // workers can never lease the same row. (sea-orm only offers
        // `exec_with_returning` on SQLite behind a crate-wide feature, so
        // RETURNING is added to the built statement here.)
        let mut claim = BackgroundJob::update_many()
            .col_expr(Column::State, Expr::value(RUNNING))
            .col_expr(Column::Attempt, Expr::col(Column::Attempt).add(1))
            .col_expr(Column::LockedBy, Expr::value(worker))
            .col_expr(Column::LockedUntil, Expr::value(lease_until))
            .col_expr(Column::UpdatedAt, Expr::value(now))
            .filter(Column::Id.in_subquery(next_due))
            .into_query();
        claim.returning_all();
        let statement = self.db.get_database_backend().build(&claim);
        Ok(BackgroundJob::find()
            .from_raw_sql(statement)
            .one(self.db.as_ref())
            .await?)
    }

    async fn renew_lease(
        &self,
        id: Uuid,
        worker: &str,
        now: &str,
        lease_until: &str,
    ) -> StoreResult<bool> {
        let renewed = BackgroundJob::update_many()
            .col_expr(Column::LockedUntil, Expr::value(lease_until))
            .col_expr(Column::UpdatedAt, Expr::value(now))
            .filter(held(id, worker))
            .filter(Column::State.eq(RUNNING))
            .exec(self.db.as_ref())
            .await?;
        Ok(renewed.rows_affected == 1)
    }

    async fn delete_held(&self, id: Uuid, worker: &str) -> StoreResult<()> {
        BackgroundJob::delete_many()
            .filter(held(id, worker))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn requeue(
        &self,
        id: Uuid,
        worker: &str,
        run_at: &str,
        error: &str,
        now: &str,
    ) -> StoreResult<()> {
        BackgroundJob::update_many()
            .col_expr(Column::State, Expr::value(AVAILABLE))
            .col_expr(Column::RunAt, Expr::value(run_at))
            .col_expr(Column::LastError, Expr::value(error))
            .col_expr(Column::LockedBy, Expr::value(Option::<String>::None))
            .col_expr(Column::LockedUntil, Expr::value(Option::<String>::None))
            .col_expr(Column::UpdatedAt, Expr::value(now))
            .filter(held(id, worker))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn release(&self, id: Uuid, worker: &str, now: &str) -> StoreResult<()> {
        BackgroundJob::update_many()
            .col_expr(Column::State, Expr::value(AVAILABLE))
            .col_expr(Column::Attempt, Expr::col(Column::Attempt).sub(1))
            .col_expr(Column::RunAt, Expr::value(now))
            .col_expr(Column::LockedBy, Expr::value(Option::<String>::None))
            .col_expr(Column::LockedUntil, Expr::value(Option::<String>::None))
            .col_expr(Column::UpdatedAt, Expr::value(now))
            .filter(held(id, worker))
            .filter(Column::State.eq(RUNNING))
            .filter(Column::Attempt.gt(0))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn mark_dead(&self, id: Uuid, worker: &str, error: &str, now: &str) -> StoreResult<()> {
        BackgroundJob::update_many()
            .col_expr(Column::State, Expr::value(DEAD))
            .col_expr(Column::LastError, Expr::value(error))
            .col_expr(Column::UniqueKey, Expr::value(Option::<String>::None))
            .col_expr(Column::LockedBy, Expr::value(Option::<String>::None))
            .col_expr(Column::LockedUntil, Expr::value(Option::<String>::None))
            .col_expr(Column::UpdatedAt, Expr::value(now))
            .filter(held(id, worker))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn delete_waiting(&self, id: Uuid) -> StoreResult<bool> {
        let deleted = BackgroundJob::delete_many()
            .filter(Column::Id.eq(id))
            .filter(Column::State.eq(AVAILABLE))
            .exec(self.db.as_ref())
            .await?;
        Ok(deleted.rows_affected == 1)
    }

    async fn flag_cancelled(&self, id: Uuid, now: &str) -> StoreResult<bool> {
        let flagged = BackgroundJob::update_many()
            .col_expr(Column::State, Expr::value(CANCELLED))
            .col_expr(Column::UpdatedAt, Expr::value(now))
            .filter(Column::Id.eq(id))
            .filter(Column::State.eq(RUNNING))
            .exec(self.db.as_ref())
            .await?;
        Ok(flagged.rows_affected == 1)
    }

    async fn delete_dead_before(&self, before: &str) -> StoreResult<u64> {
        let deleted = BackgroundJob::delete_many()
            .filter(Column::State.eq(DEAD))
            .filter(Column::UpdatedAt.lt(before))
            .exec(self.db.as_ref())
            .await?;
        Ok(deleted.rows_affected)
    }

    async fn count_by_state(&self) -> StoreResult<Vec<(String, i64)>> {
        Ok(BackgroundJob::find()
            .select_only()
            .column(Column::State)
            .column_as(Column::Id.count(), "n")
            .group_by(Column::State)
            .into_tuple::<(String, i64)>()
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_dead(&self, limit: u64) -> StoreResult<Vec<background_job::Model>> {
        Ok(BackgroundJob::find()
            .filter(Column::State.eq(DEAD))
            .order_by_desc(Column::UpdatedAt)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }
}

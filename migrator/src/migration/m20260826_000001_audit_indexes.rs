//! Audit indexes — adds missing indexes flagged by the performance audit
//! (Task ID: 2 in worklog.md).
//!
//! Indexes added:
//!   - `Place_name_idx`, `Place_nameNoTones_idx` (PERF-006) — fixes the
//!     ~50-200ms full-table scan on every place-autocomplete keystroke
//!     when Tantivy isn't configured (i.e. most dev/test deploys).
//!   - `User_createdAt_idx` (PERF-008) — fixes the filesort on every
//!     `GET /api/users` admin page.
//!   - `Posts_createdAt_idx` (PERF-009) — fixes the filesort on every
//!     `GET /api/posts` page view.
//!   - `ChatMessage_senderType_idx` (PERF-010) — fixes the
//!     `avg_first_response_time_secs` admin metric, which currently
//!     scans every chat_message row in the DB.
//!   - `Booking_status_createdAt_id_idx` (PERF-007 prep) — composite
//!     index to enable future keyset pagination on booking exports,
//!     replacing the O(n²) OFFSET approach.
//!
//! All `CREATE INDEX IF NOT EXISTS` for idempotency on both backends.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        // ── Place autocomplete (PERF-006) ──────────────────────────────
        // The Tantivy path is fast, but it's not built in dev/test deploys,
        // so the SQL fallback runs. Without these indexes the fallback
        // does a full-table scan of `place` (Vietnam OSM has ~30k-100k rows).
        //
        // Note: B-tree indexes on `name`/`name_no_tones` help equality +
        // prefix-`LIKE 'pattern%'` queries but not `LIKE '%pattern%'`
        // (leading wildcard). For true contains-search on Postgres,
        // upgrade to a `pg_trgm` GIN index later. On SQLite, use FTS5.
        // The B-tree here still helps the equality + ORDER BY paths.
        conn.execute_unprepared(r#"CREATE INDEX IF NOT EXISTS Place_name_idx ON "place" (name)"#)
            .await?;
        conn.execute_unprepared(
            r#"CREATE INDEX IF NOT EXISTS Place_nameNoTones_idx ON "place" (name_no_tones)"#,
        )
        .await?;

        // ── Users list (PERF-008) ───────────────────────────────────────
        // `GET /api/users` orders by `created_at DESC` + paginates.
        // Without this index, every call filesorts the entire user table.
        conn.execute_unprepared(
            r#"CREATE INDEX IF NOT EXISTS User_createdAt_idx ON "user" (created_at DESC)"#,
        )
        .await?;

        // ── Posts list (PERF-009) ────────────────────────────────────────
        // `GET /api/posts` (unauthenticated) orders by `created_at DESC`.
        conn.execute_unprepared(
            r#"CREATE INDEX IF NOT EXISTS Posts_createdAt_idx ON posts (created_at DESC)"#,
        )
        .await?;

        // ── Chat first-response-time metric (PERF-010) ─────────────────
        // The admin dashboard computes `avg_first_response_time_secs` by
        // filtering `chat_message WHERE sender_type = 'employee'`. Without
        // this index, that query scans every chat_message row in the DB.
        conn.execute_unprepared(
            r#"CREATE INDEX IF NOT EXISTS ChatMessage_senderType_idx ON chat_message (sender_type)"#,
        )
        .await?;

        // ── Bookings export keyset pagination (PERF-007 prep) ──────────
        // The current `list_bookings_by_status(status, limit, offset)`
        // uses OFFSET pagination which is O(n²) at high row counts. The
        // existing `Booking_status_createdAt_idx` index handles the
        // `status + created_at` filter but lacks `id` — switch to
        // keyset pagination `(created_at, id) < (?, ?)` once we add a
        // composite index. (Behavior change is deferred; this migration
        // only prepares the index.)
        conn.execute_unprepared(
            r#"CREATE INDEX IF NOT EXISTS Booking_status_createdAt_id_idx
                ON booking (status, created_at DESC, id DESC)"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        for stmt in [
            r#"DROP INDEX IF EXISTS Place_name_idx"#,
            r#"DROP INDEX IF EXISTS Place_nameNoTones_idx"#,
            r#"DROP INDEX IF EXISTS User_createdAt_idx"#,
            r#"DROP INDEX IF EXISTS Posts_createdAt_idx"#,
            r#"DROP INDEX IF EXISTS ChatMessage_senderType_idx"#,
            r#"DROP INDEX IF EXISTS Booking_status_createdAt_id_idx"#,
        ] {
            conn.execute_unprepared(stmt).await?;
        }
        Ok(())
    }
}

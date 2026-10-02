//! Query-plan indexes for the hot listing/aggregation queries.
//!
//! The 2026-08 code audit flagged four missing indexes (PERF-006/008/
//! 009/010) and scheduled them for a migration that was never merged;
//! production has been running the queries below with full table scans
//! ever since. This migration closes the set with `CREATE INDEX IF
//! NOT EXISTS` (idempotent — safe on databases that already created a
//! subset via the table-creation migrations, and safe to re-run).
//!
//! Index plan, query by query (see the store methods for the shapes):
//!
//! * `chat_message(channel_id, created_at)` — the chat history pager:
//!   `WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?`. The
//!   composite turns a per-message-page full scan into an index
//!   range scan; also serves the `client_msg_id` idempotency lookup
//!   (same channel filter, residual predicate on the narrowed rows).
//! * `chat_message(sender_type, channel_id, created_at)` — the
//!   `avg_first_response_time_secs` dashboard query: two
//!   `WHERE sender_type = ? GROUP BY channel_id` subqueries with
//!   `MIN(created_at)`. This index covers both subqueries entirely
//!   (no table access at all).
//! * `booking(user_id, created_at)` — the user's booking history:
//!   `WHERE user_id = ? [AND status = ?] ORDER BY created_at DESC`.
//! * `booking(status, created_at)` — admin dashboards and the
//!   status-filtered booking lists.
//! * `notification(user_id, created_at)` — the per-user notification
//!   bell: `WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`.
//! * `user(created_at)`, `posts(created_at)`, `review(created_at)`,
//!   `route(created_at)`, `brand(created_at)` — the created_at
//!   sort keys for the list endpoints (PERF-008/009 and friends).
//!   `User_createdAt_idx` keeps the create-table migration's name so
//!   IF NOT EXISTS collapses the two on fresh databases.
//! * `place(name_no_tones)` — the SQL-fallback autocomplete
//!   (`LIKE '%pattern%'`). A leading wildcard cannot seek a B-tree,
//!   but the index makes the scan COVERING (narrow string pages
//!   instead of the wide table rows), which is the best a B-tree can
//!   do for that shape. The primary autocomplete path is the Tantivy
//!   place index; this covers the fallback.
//!
//! Build cost: one bounded scan per table on first run (the engine
//! writes indexes transactionally); afterwards all maintenance is
//! incremental. The shared page cache (see `apply_sqlite_pragmas`)
//! keeps the hot index pages resident.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// (statement, human note) — executed in order, first failure aborts.
const INDEXES: &[(&str, &str)] = &[
    (
        "CREATE INDEX IF NOT EXISTS idx_chat_message_channel_created ON chat_message (channel_id, created_at);",
        "chat history pager",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_chat_message_sender_channel_created ON chat_message (sender_type, channel_id, created_at);",
        "avg first-response-time (covering)",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_booking_user_created ON booking (user_id, created_at);",
        "user booking history",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_booking_status_created ON booking (status, created_at);",
        "admin booking lists",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_notification_user_created ON notification (user_id, created_at);",
        "per-user notification list",
    ),
    (
        "CREATE INDEX IF NOT EXISTS User_createdAt_idx ON \"user\" (created_at);",
        "user list sort key (name matches create_users_auth)",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at);",
        "posts list sort key",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_review_created ON review (created_at);",
        "review list sort key",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_route_created ON route (created_at);",
        "route list sort key",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_brand_created ON brand (created_at);",
        "brand list sort key",
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_place_name_no_tones ON place (name_no_tones);",
        "covering scan for SQL-fallback autocomplete",
    ),
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        for (stmt, note) in INDEXES {
            db.execute_unprepared(stmt)
                .await
                .map_err(|e| DbErr::Custom(format!("add_query_indexes [{note}]: {e}")))?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        for (stmt, note) in INDEXES {
            // Extract the index name from the CREATE statement and drop
            // it (same IF EXISTS idempotency).
            let name = stmt
                .split_whitespace()
                .nth(5)
                .unwrap_or_default()
                .to_string();
            let drop = format!("DROP INDEX IF EXISTS {name};");
            db.execute_unprepared(&drop)
                .await
                .map_err(|e| DbErr::Custom(format!("add_query_indexes down [{note}]: {e}")))?;
        }
        Ok(())
    }
}

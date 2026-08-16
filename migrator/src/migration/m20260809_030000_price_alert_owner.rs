use sea_orm_migration::{prelude::*, schema::text_null};

/// Add `user_id` and `last_triggered_at` columns to the `price_alert`
/// table.
///
/// - `user_id` links an alert to the authenticated user who created it
///   (nullable for backwards compat with legacy phone-only alerts).
/// - `last_triggered_at` records when the alert last fired.
///
/// Also adds an index on `user_id` for the "my alerts" query.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // user_id (nullable text — stores the UUID as a string, matching
        // the rest of the schema's text-typed FK columns).
        //
        // Guard with `has_column` because SQLite's `ALTER TABLE ADD
        // COLUMN` does NOT support `IF NOT EXISTS` — a partially-applied
        // migration (column added, later step failed) would otherwise
        // crash on re-run with "duplicate column name".
        if !manager.has_column("price_alert", "user_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(PriceAlert::Table)
                        .add_column(text_null(PriceAlert::UserId))
                        .to_owned(),
                )
                .await?;
        }

        // last_triggered_at (nullable text — ISO timestamp).
        if !manager
            .has_column("price_alert", "last_triggered_at")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(PriceAlert::Table)
                        .add_column(text_null(PriceAlert::LastTriggeredAt))
                        .to_owned(),
                )
                .await?;
        }

        // FK: price_alert.user_id → user.id (cascade on delete).
        //
        // NOTE: SQLite does NOT support `ALTER TABLE ADD FOREIGN KEY`
        // on an existing table (panics in sea-query's SQLite backend).
        // The FK relationship is declared in the SeaORM entity
        // (`entity::price_alert::Relation::User`) for ORM-level joins;
        // DB-level enforcement is only available when the table is
        // created inline (see `m20260809_021431_*` for the original
        // `price_alert` table). On Postgres this alter would work —
        // re-enable there if needed.
        //
        // (Intentionally no `alter_table(... add_foreign_key ...)` here.)

        // Index for the "my alerts" query (filter by user_id).
        // `if_not_exists` makes this idempotent.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("PriceAlert_userId_idx")
                    .table(PriceAlert::Table)
                    .col(PriceAlert::UserId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // The columns are additive and nullable; leaving them in place
        // on rollback is safe. Dropping the FK + columns would require
        // dialect-specific DROP COLUMN syntax.
        Ok(())
    }
}

#[derive(DeriveIden)]
pub enum PriceAlert {
    Table,
    UserId,
    LastTriggeredAt,
}

//! Ad conversions — first-party, server-side conversion records for
//! Google Ads.
//!
//! Completes the conversion pipeline documented in `docs/GOOGLE_ADS.md`:
//! the SPA captures Google Ads click ids (`gclid` / `wbraid` / `gbraid`)
//! on landing and, at the money moment (booking confirmed / payment
//! completed), beacons the conversion to `POST /api/ads/conversions`
//! alongside the stored click ids. The server persists the record here
//! — durable, deduped by `(event, transaction_id)` — and, when the
//! Google Ads API credentials are configured (see `.env.example`),
//! uploads it via `customers/{cid}:uploadClickConversions` so the
//! conversion is measured server-side, immune to cookie/ITP loss.
//!
//! `status` lifecycle: `pending` → `uploaded` (API accepted) /
//! `unconfigured` (credentials absent — kept for later backfill) /
//! `error` (API rejected; retried by a future sweeper, never lost).
//!
//! No FK to `users`: a conversion is attributed to the ad CLICK, not
//! the (possibly anonymous) purchaser — the click ids are the join key
//! Google matches on.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // NOTE: no inline `.index(...)` inside create_table — the
        // rust-sql engine's parser rejects inline INDEX table
        // constraints (SQLite legacy extension; standard SQL wants
        // separate CREATE INDEX statements, which also keeps the
        // statement Postgres-compatible).
        manager
            .create_table(
                Table::create()
                    .table(AdConversion::Table)
                    .col(pk_uuid(AdConversion::Id))
                    .col(string_len(AdConversion::Event, 32))
                    .col(string_len(AdConversion::TransactionId, 128))
                    .col(text_null(AdConversion::ConversionValue))
                    .col(string_len_null(AdConversion::Currency, 8))
                    .col(text_null(AdConversion::Gclid))
                    .col(text_null(AdConversion::Wbraid))
                    .col(text_null(AdConversion::Gbraid))
                    .col(string_len(AdConversion::Status, 16).default("pending"))
                    .col(text(AdConversion::CreatedAt))
                    .col(text_null(AdConversion::UploadedAt))
                    .to_owned(),
            )
            .await?;

        // One record per (event, transaction_id): the browser may fire
        // the beacon twice (retry/double-tap) and the gtag path may
        // also land the same booking — Google dedupes server-side, we
        // dedupe at the storage boundary.
        manager
            .create_index(
                Index::create()
                    .name("idx_ad_conversion_event_txn_unique")
                    .unique()
                    .table(AdConversion::Table)
                    .col(AdConversion::Event)
                    .col(AdConversion::TransactionId)
                    .to_owned(),
            )
            .await?;

        // The upload sweeper scans for unfinished rows, newest first.
        manager
            .create_index(
                Index::create()
                    .name("idx_ad_conversion_status_created")
                    .table(AdConversion::Table)
                    .col(AdConversion::Status)
                    .col(AdConversion::CreatedAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AdConversion::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AdConversion {
    Table,
    Id,
    Event,
    TransactionId,
    ConversionValue,
    Currency,
    Gclid,
    Wbraid,
    Gbraid,
    Status,
    CreatedAt,
    UploadedAt,
}

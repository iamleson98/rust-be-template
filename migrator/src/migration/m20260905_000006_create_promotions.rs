//! Promotions — discount code campaigns and always-on discount programs.
//!
//!   1. `campaign`         — a code-based discount campaign
//!                           (percentage or fixed, usage-capped, dated)
//!   2. `discount_program` — brand-level sale programs shown on the
//!                           public site (managed by employees)

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── campaign ─────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Campaign::Table)
                    .col(pk_uuid(Campaign::Id))
                    .col(uuid(Campaign::BrandId))
                    .col(string_len_uniq(Campaign::Code, 50))
                    .col(string_len(Campaign::DiscountType, 10))
                    .col(big_integer(Campaign::DiscountValue))
                    .col(big_integer_null(Campaign::MaxUses))
                    .col(big_integer(Campaign::UsedCount).default(0))
                    .col(text_null(Campaign::StartsAt))
                    .col(text_null(Campaign::EndsAt))
                    .col(string_len(Campaign::Status, 30).default("active"))
                    .col(text(Campaign::CreatedAt))
                    .col(text(Campaign::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_campaign_brand")
                            .from(Campaign::Table, Campaign::BrandId)
                            .to(Brand::Table, Brand::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("Campaign_brandId_idx")
                    .table(Campaign::Table)
                    .col(Campaign::BrandId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Campaign_status_idx")
                    .table(Campaign::Table)
                    .col(Campaign::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Campaign_date_range_status_idx")
                    .table(Campaign::Table)
                    .col(Campaign::StartsAt)
                    .col(Campaign::EndsAt)
                    .col(Campaign::Status)
                    .to_owned(),
            )
            .await?;

        // ── discount_program ─────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(DiscountProgram::Table)
                    .col(pk_uuid(DiscountProgram::Id))
                    .col(uuid_null(DiscountProgram::BrandId))
                    .col(string_len(DiscountProgram::Name, 255))
                    .col(text_null(DiscountProgram::Description))
                    .col(string_len(DiscountProgram::DiscountType, 10))
                    .col(integer(DiscountProgram::DiscountValue))
                    .col(text_null(DiscountProgram::StartsAt))
                    .col(text_null(DiscountProgram::EndsAt))
                    .col(string_len(DiscountProgram::Status, 30).default("active"))
                    .col(text(DiscountProgram::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_discount_brand")
                            .from(DiscountProgram::Table, DiscountProgram::BrandId)
                            .to(Brand::Table, Brand::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("DiscountProgram_brandId_idx")
                    .table(DiscountProgram::Table)
                    .col(DiscountProgram::BrandId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("DiscountProgram_status_idx")
                    .table(DiscountProgram::Table)
                    .col(DiscountProgram::Status)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            DiscountProgram::Table.into_iden(),
            Campaign::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().cascade().to_owned())
                .await?;
        }
        Ok(())
    }
}

// ── Iden enums ──────────────────────────────────────────────────────────

/// Minimal reference to the `brand` table (created in
/// `m20260905_000003_create_catalog`).
#[derive(DeriveIden)]
enum Brand {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Campaign {
    Table,
    Id,
    BrandId,
    Code,
    DiscountType,
    DiscountValue,
    MaxUses,
    UsedCount,
    StartsAt,
    EndsAt,
    Status,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum DiscountProgram {
    Table,
    Id,
    BrandId,
    Name,
    Description,
    DiscountType,
    DiscountValue,
    StartsAt,
    EndsAt,
    Status,
    CreatedAt,
}

use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::m20260809_013648_places_brands::Brand;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum DiscountProgram {
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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DiscountProgram::Table)
                    .if_not_exists()
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
                    .if_not_exists()
                    .name("DiscountProgram_brandId_idx")
                    .table(DiscountProgram::Table)
                    .col(DiscountProgram::BrandId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("DiscountProgram_status_idx")
                    .table(DiscountProgram::Table)
                    .col(DiscountProgram::Status)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(DiscountProgram::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

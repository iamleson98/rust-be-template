//! Brands: the child discount becomes an amount, and the brand colour goes.
//!
//! - `brand.child_discount_amount`: VND off the adult fare for a child
//!   ticket (a fixed amount is easier to check against a fare than a
//!   percentage). It replaces `child_discount_percent`, which cannot be
//!   turned into an amount without the fare it applied to: a brand that
//!   had a percentage keeps its child age limit and starts at 0 off until
//!   an admin enters the amount.
//! - `brand.accent_color` is dropped; the apps no longer colour brands.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Brand::Table)
                    .add_column(big_integer_null(Brand::ChildDiscountAmount))
                    .to_owned(),
            )
            .await?;
        // SQLite takes one column per ALTER TABLE.
        for column in [Brand::ChildDiscountPercent, Brand::AccentColor] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Brand::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Brand::Table)
                    .add_column(string_len_null(Brand::AccentColor, 9))
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Brand::Table)
                    .add_column(small_integer_null(Brand::ChildDiscountPercent))
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Brand::Table)
                    .drop_column(Brand::ChildDiscountAmount)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Brand {
    Table,
    AccentColor,
    ChildDiscountPercent,
    ChildDiscountAmount,
}

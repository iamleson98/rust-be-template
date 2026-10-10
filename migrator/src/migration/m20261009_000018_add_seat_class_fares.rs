//! Fares by seat class, and each brand's child-fare policy.
//!
//! - `schedule_fare`: what a seat of one class costs on one schedule
//!   (`vip`, `premium`, `bed_upper`, …). Standard seats, and any class
//!   without a row, keep using `schedule.base_price_adult`.
//! - `brand.child_max_age` + `brand.child_discount_percent`: who counts
//!   as a child and how much less they pay. Both NULL = the brand sells
//!   every seat at the adult fare.
//!
//! `schedule.base_price_child` becomes an optional override of the
//! brand's child discount for standard seats. The admin form used to
//! store 0 for "no child fare"; those rows are cleared so they do not
//! turn into free tickets.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ScheduleFare::Table)
                    .col(pk_uuid(ScheduleFare::Id))
                    .col(uuid(ScheduleFare::ScheduleId))
                    .col(string_len(ScheduleFare::SeatClass, 30))
                    .col(big_integer(ScheduleFare::PriceAdult))
                    .col(big_integer_null(ScheduleFare::PriceChild))
                    .col(text(ScheduleFare::CreatedAt))
                    .col(text(ScheduleFare::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_schedule_fare_schedule")
                            .from(ScheduleFare::Table, ScheduleFare::ScheduleId)
                            .to(Schedule::Table, Schedule::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_schedule_fare_schedule_class")
                    .unique()
                    .table(ScheduleFare::Table)
                    .col(ScheduleFare::ScheduleId)
                    .col(ScheduleFare::SeatClass)
                    .to_owned(),
            )
            .await?;

        // SQLite takes one column per ALTER TABLE.
        for column in [Brand::ChildMaxAge, Brand::ChildDiscountPercent] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Brand::Table)
                        .add_column(small_integer_null(column))
                        .to_owned(),
                )
                .await?;
        }

        manager
            .exec_stmt(
                Query::update()
                    .table(Schedule::Table)
                    .value(Schedule::BasePriceChild, Option::<i64>::None)
                    .and_where(Expr::col(Schedule::BasePriceChild).eq(0))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [Brand::ChildDiscountPercent, Brand::ChildMaxAge] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Brand::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(Table::drop().table(ScheduleFare::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ScheduleFare {
    Table,
    Id,
    ScheduleId,
    SeatClass,
    PriceAdult,
    PriceChild,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Schedule {
    Table,
    Id,
    BasePriceChild,
}

#[derive(DeriveIden)]
enum Brand {
    Table,
    ChildMaxAge,
    ChildDiscountPercent,
}

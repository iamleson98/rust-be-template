use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::{
    m20260809_013648_places_brands::Brand,
    m20260809_014716_routes_pickups_buslayout_seats::{BusLayout, Route},
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum Schedule {
    Table,
    Id,
    RouteId,
    DepartureTime,
    EffectiveFrom,
    EffectiveTo,
    DaysOfWeek,
    BusLayoutId,
    BasePriceAdult,
    BasePriceChild,
    Amenities,
    CreatedAt,
}

#[derive(DeriveIden)]
pub enum TripSession {
    Table,
    Id,
    ScheduleId,
    DepartureDate,
    ActualDepartureAt,
    DriverName,
    DriverPhone,
    Status,
    TotalSeats,
    AvailableSeats,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
pub enum Campaign {
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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Schedule
        manager
            .create_table(
                Table::create()
                    .table(Schedule::Table)
                    .if_not_exists()
                    .col(pk_uuid(Schedule::Id))
                    .col(text(Schedule::RouteId))
                    .col(string_len(Schedule::DepartureTime, 10))
                    .col(text_null(Schedule::EffectiveFrom))
                    .col(text_null(Schedule::EffectiveTo))
                    .col(text_null(Schedule::DaysOfWeek))
                    .col(text_null(Schedule::BusLayoutId))
                    .col(integer(Schedule::BasePriceAdult).default(0))
                    .col(integer_null(Schedule::BasePriceChild))
                    .col(text_null(Schedule::Amenities))
                    .col(text(Schedule::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_schedule_route")
                            .from(Schedule::Table, Schedule::RouteId)
                            .to(Route::Table, Route::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_schedule_buslayout")
                            .from(Schedule::Table, Schedule::BusLayoutId)
                            .to(BusLayout::Table, BusLayout::Id)
                            .on_delete(ForeignKeyAction::Restrict)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Schedule_routeId_idx")
                    .table(Schedule::Table)
                    .col(Schedule::RouteId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Schedule_route_departure_idx")
                    .table(Schedule::Table)
                    .col(Schedule::RouteId)
                    .col(Schedule::DepartureTime)
                    .to_owned(),
            )
            .await?;

        // TripSession
        manager
            .create_table(
                Table::create()
                    .table(TripSession::Table)
                    .if_not_exists()
                    .col(pk_uuid(TripSession::Id))
                    .col(text(TripSession::ScheduleId))
                    .col(text(TripSession::DepartureDate))
                    .col(text_null(TripSession::ActualDepartureAt))
                    .col(string_len_null(TripSession::DriverName, 255))
                    .col(string_len_null(TripSession::DriverPhone, 20))
                    .col(string_len(TripSession::Status, 30).default("scheduled"))
                    .col(small_integer(TripSession::TotalSeats).default(0))
                    .col(integer(TripSession::AvailableSeats).default(0))
                    .col(text(TripSession::CreatedAt))
                    .col(text(TripSession::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_trip_schedule")
                            .from(TripSession::Table, TripSession::ScheduleId)
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
                    .if_not_exists()
                    .name("TripSession_scheduleId_idx")
                    .table(TripSession::Table)
                    .col(TripSession::ScheduleId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("TripSession_departureDate_idx")
                    .table(TripSession::Table)
                    .col(TripSession::DepartureDate)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("TripSession_schedule_date_idx")
                    .table(TripSession::Table)
                    .col(TripSession::ScheduleId)
                    .col(TripSession::DepartureDate)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("TripSession_departureDate_status_idx")
                    .table(TripSession::Table)
                    .col(TripSession::DepartureDate)
                    .col(TripSession::Status)
                    .to_owned(),
            )
            .await?;

        // Campaign
        manager
            .create_table(
                Table::create()
                    .table(Campaign::Table)
                    .if_not_exists()
                    .col(pk_uuid(Campaign::Id))
                    .col(text_null(Campaign::BrandId))
                    .col(string_len_uniq(Campaign::Code, 50))
                    .col(string_len(Campaign::DiscountType, 10))
                    .col(integer(Campaign::DiscountValue))
                    .col(small_integer_null(Campaign::MaxUses))
                    .col(integer(Campaign::UsedCount).default(0))
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
                    .if_not_exists()
                    .name("Campaign_brandId_idx")
                    .table(Campaign::Table)
                    .col(Campaign::BrandId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Campaign_status_idx")
                    .table(Campaign::Table)
                    .col(Campaign::Status)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Campaign::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(TripSession::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Schedule::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}

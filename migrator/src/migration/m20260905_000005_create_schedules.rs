//! Scheduling — schedule templates, their ordered stop points and
//! concrete trip sessions.
//!
//!   1. `schedule`      — a recurring departure template for a route
//!                        (time, effective range, days-of-week, prices,
//!                        optional bus layout + explicit vehicle type)
//!   2. `schedule_point`— ordered address sequence for a schedule;
//!                        first = departure, last = final drop, middle =
//!                        midway stops. `arrival_time` publishes when the
//!                        vehicle reaches each stop.
//!   3. `trip_session`  — one concrete departure (schedule × date),
//!                        materialised with live seat counters.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── schedule ─────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Schedule::Table)
                    .col(pk_uuid(Schedule::Id))
                    .col(uuid(Schedule::RouteId))
                    .col(text(Schedule::DepartureTime))
                    .col(text_null(Schedule::EffectiveFrom))
                    .col(text_null(Schedule::EffectiveTo))
                    .col(text_null(Schedule::DaysOfWeek))
                    .col(uuid_null(Schedule::BusLayoutId))
                    .col(big_integer(Schedule::BasePriceAdult).default(0))
                    .col(big_integer_null(Schedule::BasePriceChild))
                    .col(text_null(Schedule::Amenities))
                    .col(text(Schedule::CreatedAt))
                    // Explicit vehicle class for the schedule (nullable —
                    // falls back to resolving via the bus layout).
                    .col(uuid_null(Schedule::VehicleTypeId))
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
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_schedule_vehicle_type")
                            .from(Schedule::Table, Schedule::VehicleTypeId)
                            .to(VehicleType::Table, VehicleType::Id)
                            // Deleting a vehicle type clears the
                            // reference; it never deletes schedules.
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("Schedule_routeId_idx")
                    .table(Schedule::Table)
                    .col(Schedule::RouteId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Schedule_route_departure_idx")
                    .table(Schedule::Table)
                    .col(Schedule::RouteId)
                    .col(Schedule::DepartureTime)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Schedule_effective_range_idx")
                    .table(Schedule::Table)
                    .col(Schedule::EffectiveFrom)
                    .col(Schedule::EffectiveTo)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Schedule_vehicle_type_idx")
                    .table(Schedule::Table)
                    .col(Schedule::VehicleTypeId)
                    .to_owned(),
            )
            .await?;

        // ── schedule_point ───────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(SchedulePoint::Table)
                    .col(pk_uuid(SchedulePoint::Id))
                    .col(uuid(SchedulePoint::ScheduleId))
                    .col(uuid(SchedulePoint::AddressId))
                    .col(integer(SchedulePoint::StopOrder).default(0))
                    .col(string_len(SchedulePoint::Kind, 20))
                    .col(text(SchedulePoint::CreatedAt))
                    // Optional HH:MM — when the vehicle reaches this stop.
                    .col(text_null(SchedulePoint::ArrivalTime))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_schedule_point_schedule")
                            .from(SchedulePoint::Table, SchedulePoint::ScheduleId)
                            .to(Schedule::Table, Schedule::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_schedule_point_address")
                            .from(SchedulePoint::Table, SchedulePoint::AddressId)
                            .to(Address::Table, Address::Id)
                            // An address referenced by any point is
                            // protected from deletion.
                            .on_delete(ForeignKeyAction::Restrict)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("SchedulePoint_schedule_idx")
                    .table(SchedulePoint::Table)
                    .col(SchedulePoint::ScheduleId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("SchedulePoint_address_idx")
                    .table(SchedulePoint::Table)
                    .col(SchedulePoint::AddressId)
                    .to_owned(),
            )
            .await?;

        // ── trip_session ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(TripSession::Table)
                    .col(pk_uuid(TripSession::Id))
                    .col(uuid(TripSession::ScheduleId))
                    .col(text(TripSession::DepartureDate))
                    .col(text_null(TripSession::ActualDepartureAt))
                    .col(string_len_null(TripSession::DriverName, 255))
                    .col(string_len_null(TripSession::DriverPhone, 20))
                    .col(string_len(TripSession::Status, 30).default("scheduled"))
                    .col(big_integer(TripSession::TotalSeats).default(0))
                    .col(big_integer(TripSession::AvailableSeats).default(0))
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
                    .name("TripSession_scheduleId_idx")
                    .table(TripSession::Table)
                    .col(TripSession::ScheduleId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("TripSession_departureDate_idx")
                    .table(TripSession::Table)
                    .col(TripSession::DepartureDate)
                    .to_owned(),
            )
            .await?;
        // One trip per schedule per date.
        manager
            .create_index(
                Index::create()
                    .name("TripSession_schedule_date_uniq")
                    .table(TripSession::Table)
                    .col(TripSession::ScheduleId)
                    .col(TripSession::DepartureDate)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("TripSession_date_status_idx")
                    .table(TripSession::Table)
                    .col(TripSession::DepartureDate)
                    .col(TripSession::Status)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            TripSession::Table.into_iden(),
            SchedulePoint::Table.into_iden(),
            Schedule::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().cascade().to_owned())
                .await?;
        }
        Ok(())
    }
}

// ── Iden enums ──────────────────────────────────────────────────────────

/// Minimal reference to the `route` table (created in
/// `m20260905_000004_create_route_network`).
#[derive(DeriveIden)]
enum Route {
    Table,
    Id,
}

/// Minimal reference to the `bus_layout` table (same migration as route).
#[derive(DeriveIden)]
enum BusLayout {
    Table,
    Id,
}

/// Minimal reference to the `vehicle_type` table (created in
/// `m20260905_000003_create_catalog`).
#[derive(DeriveIden)]
enum VehicleType {
    Table,
    Id,
}

/// Minimal reference to the `address` table (same migration as
/// vehicle_type).
#[derive(DeriveIden)]
enum Address {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Schedule {
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
    VehicleTypeId,
}

#[derive(DeriveIden)]
enum SchedulePoint {
    Table,
    Id,
    ScheduleId,
    AddressId,
    StopOrder,
    Kind,
    CreatedAt,
    ArrivalTime,
}

#[derive(DeriveIden)]
enum TripSession {
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

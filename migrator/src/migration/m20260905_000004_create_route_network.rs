//! Route network — routes, pickup points, bus layouts and seats.
//!
//!   1. `route`        — brand route between two city slugs
//!      (`start_location_id` / `end_location_id` are
//!      VARCHAR(20) slugs, NOT FKs — resolved via
//!      `crate::cities` in the service layer)
//!   2. `pickup_point` — ordered stops along a route
//!   3. `bus_layout`   — seat map definition per brand/vehicle class
//!   4. `seat`         — concrete seat in a layout

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── route ────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Route::Table)
                    .col(pk_uuid(Route::Id))
                    .col(uuid_null(Route::BrandId))
                    .col(string_len(Route::Name, 255))
                    .col(string_len(Route::StartLocationId, 20))
                    .col(string_len(Route::EndLocationId, 20))
                    .col(string_len(Route::Status, 30).default("active"))
                    .col(text(Route::CreatedAt))
                    .col(text(Route::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_route_brand")
                            .from(Route::Table, Route::BrandId)
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
                    .name("Route_brandId_idx")
                    .table(Route::Table)
                    .col(Route::BrandId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Route_startEnd_idx")
                    .table(Route::Table)
                    .col(Route::StartLocationId)
                    .col(Route::EndLocationId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Route_status_idx")
                    .table(Route::Table)
                    .col(Route::Status)
                    .to_owned(),
            )
            .await?;

        // ── pickup_point ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(PickupPoint::Table)
                    .col(pk_uuid(PickupPoint::Id))
                    .col(uuid(PickupPoint::RouteId))
                    .col(string_len_null(PickupPoint::Name, 255))
                    .col(text_null(PickupPoint::Address))
                    .col(double_null(PickupPoint::Lat))
                    .col(double_null(PickupPoint::Lon))
                    .col(integer(PickupPoint::StopOrder).default(0))
                    .col(string_len_null(PickupPoint::Kind, 20))
                    .col(text(PickupPoint::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_pickup_route")
                            .from(PickupPoint::Table, PickupPoint::RouteId)
                            .to(Route::Table, Route::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("PickupPoint_routeId_idx")
                    .table(PickupPoint::Table)
                    .col(PickupPoint::RouteId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("PickupPoint_route_order_idx")
                    .table(PickupPoint::Table)
                    .col(PickupPoint::RouteId)
                    .col(PickupPoint::StopOrder)
                    .to_owned(),
            )
            .await?;

        // ── bus_layout ───────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(BusLayout::Table)
                    .col(pk_uuid(BusLayout::Id))
                    .col(uuid_null(BusLayout::BrandId))
                    .col(string_len_null(BusLayout::Name, 255))
                    .col(string_len_null(BusLayout::VehicleType, 30))
                    .col(small_integer_null(BusLayout::TotalSeats))
                    .col(text_null(BusLayout::LayoutData))
                    .col(text(BusLayout::CreatedAt))
                    .col(text(BusLayout::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_buslayout_brand")
                            .from(BusLayout::Table, BusLayout::BrandId)
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
                    .name("BusLayout_brandId_idx")
                    .table(BusLayout::Table)
                    .col(BusLayout::BrandId)
                    .to_owned(),
            )
            .await?;

        // ── seat ─────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Seat::Table)
                    .col(pk_uuid(Seat::Id))
                    .col(uuid(Seat::BusLayoutId))
                    .col(string_len(Seat::SeatLabel, 10))
                    .col(string_len_null(Seat::SeatClass, 30))
                    .col(small_integer_null(Seat::RowNum))
                    .col(small_integer_null(Seat::ColNum))
                    .col(boolean(Seat::IsWindow).default(false))
                    .col(small_integer(Seat::Floor).default(1))
                    .col(text(Seat::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_seat_buslayout")
                            .from(Seat::Table, Seat::BusLayoutId)
                            .to(BusLayout::Table, BusLayout::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("Seat_busLayoutId_idx")
                    .table(Seat::Table)
                    .col(Seat::BusLayoutId)
                    .to_owned(),
            )
            .await?;
        // A seat label appears at most once per layout.
        manager
            .create_index(
                Index::create()
                    .name("Seat_layout_label_uniq")
                    .table(Seat::Table)
                    .col(Seat::BusLayoutId)
                    .col(Seat::SeatLabel)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            Seat::Table.into_iden(),
            BusLayout::Table.into_iden(),
            PickupPoint::Table.into_iden(),
            Route::Table.into_iden(),
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
enum Route {
    Table,
    Id,
    BrandId,
    Name,
    StartLocationId,
    EndLocationId,
    Status,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum PickupPoint {
    Table,
    Id,
    RouteId,
    Name,
    Address,
    Lat,
    Lon,
    StopOrder,
    Kind,
    CreatedAt,
}

#[derive(DeriveIden)]
enum BusLayout {
    Table,
    Id,
    BrandId,
    Name,
    VehicleType,
    TotalSeats,
    LayoutData,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)] // SeaORM Iden: variant name = SQL identifier
enum Seat {
    Table,
    Id,
    BusLayoutId,
    SeatLabel,
    SeatClass,
    RowNum,
    ColNum,
    IsWindow,
    Floor,
    CreatedAt,
}

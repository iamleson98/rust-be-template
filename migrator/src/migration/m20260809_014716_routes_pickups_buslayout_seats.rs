use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::m20260809_013648_places_brands::{Brand, Place};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum Route {
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
pub enum PickupPoint {
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
pub enum BusLayout {
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
#[allow(clippy::enum_variant_names)]
pub enum Seat {
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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Route
        manager
            .create_table(
                Table::create()
                    .table(Route::Table)
                    .if_not_exists()
                    .col(pk_uuid(Route::Id))
                    .col(uuid_null(Route::BrandId))
                    .col(string_len(Route::Name, 255))
                    .col(uuid_null(Route::StartLocationId))
                    .col(uuid_null(Route::EndLocationId))
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
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_route_start_loc")
                            .from(Route::Table, Route::StartLocationId)
                            .to(Place::Table, Place::Id)
                            .on_delete(ForeignKeyAction::Restrict)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_route_end_loc")
                            .from(Route::Table, Route::EndLocationId)
                            .to(Place::Table, Place::Id)
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
                    .name("Route_brandId_idx")
                    .table(Route::Table)
                    .col(Route::BrandId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
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
                    .if_not_exists()
                    .name("Route_status_idx")
                    .table(Route::Table)
                    .col(Route::Status)
                    .to_owned(),
            )
            .await?;

        // PickupPoint
        manager
            .create_table(
                Table::create()
                    .table(PickupPoint::Table)
                    .if_not_exists()
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
                    .if_not_exists()
                    .name("PickupPoint_routeId_idx")
                    .table(PickupPoint::Table)
                    .col(PickupPoint::RouteId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("PickupPoint_route_order_idx")
                    .table(PickupPoint::Table)
                    .col(PickupPoint::RouteId)
                    .col(PickupPoint::StopOrder)
                    .to_owned(),
            )
            .await?;

        // BusLayout
        manager
            .create_table(
                Table::create()
                    .table(BusLayout::Table)
                    .if_not_exists()
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
                    .if_not_exists()
                    .name("BusLayout_brandId_idx")
                    .table(BusLayout::Table)
                    .col(BusLayout::BrandId)
                    .to_owned(),
            )
            .await?;

        // Seat
        manager
            .create_table(
                Table::create()
                    .table(Seat::Table)
                    .if_not_exists()
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
                    .if_not_exists()
                    .name("Seat_busLayoutId_idx")
                    .table(Seat::Table)
                    .col(Seat::BusLayoutId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
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
        manager
            .drop_table(Table::drop().table(Seat::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(BusLayout::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(PickupPoint::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Route::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}

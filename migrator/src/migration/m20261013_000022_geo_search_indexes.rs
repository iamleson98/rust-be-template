//! Latitude indexes for the smart (coordinate) search.
//!
//! The search looks for stops inside a box around the customer's pickup
//! and drop-off: `lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`. Without
//! an index both tables were scanned in full on every search; with
//! `(lat, lon)` the engine reads only the latitude band.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .name("Address_lat_lon_idx")
                    .table(Address::Table)
                    .col(Address::Lat)
                    .col(Address::Lon)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("PickupPoint_lat_lon_idx")
                    .table(PickupPoint::Table)
                    .col(PickupPoint::Lat)
                    .col(PickupPoint::Lon)
                    .if_not_exists()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("PickupPoint_lat_lon_idx")
                    .table(PickupPoint::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name("Address_lat_lon_idx")
                    .table(Address::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Address {
    Table,
    Lat,
    Lon,
}

#[derive(DeriveIden)]
enum PickupPoint {
    Table,
    Lat,
    Lon,
}

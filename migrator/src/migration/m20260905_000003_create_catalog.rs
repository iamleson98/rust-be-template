//! Reference/catalog tables — places, transport brands, vehicle classes
//! and brand-owned addresses.
//!
//!   1. `place`        — Vietnam OSM gazetteer used by autocomplete
//!      (populated by the import job, not seeded here)
//!   2. `brand`        — transport brands (slug-addressed)
//!   3. `vehicle_type` — admin-managed vehicle class catalogue (seeded
//!      with the five legacy codes in the seed migration)
//!   4. `address`      — named geographic points owned by a brand, used
//!      as schedule stops
//!
//! No table here depends on another table in this migration except
//! `address` → `brand`.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── place ────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Place::Table)
                    .col(pk_uuid(Place::Id))
                    .col(big_integer(Place::OsmId).unique_key())
                    .col(string_len(Place::Name, 255))
                    .col(string_len_null(Place::NameAscii, 255))
                    .col(string_len_null(Place::NameNoTones, 255))
                    .col(string_len(Place::Type, 30))
                    .col(string_len_null(Place::Province, 255))
                    .col(string_len_null(Place::District, 255))
                    .col(string_len_null(Place::Ward, 255))
                    .col(double(Place::Lat))
                    .col(double(Place::Lon))
                    .col(integer(Place::Population).default(0))
                    .col(text(Place::CreatedAt))
                    .to_owned(),
            )
            .await?;

        // Autocomplete fallback path (equality + prefix LIKE + ORDER BY).
        // For true contains-search upgrade to FTS5 (SQLite) / pg_trgm GIN
        // (Postgres) later; B-tree still fixes the filesort.
        for (idx, col) in [
            ("Place_name_idx", Place::Name),
            ("Place_nameNoTones_idx", Place::NameNoTones),
            ("Place_nameAscii_idx", Place::NameAscii),
        ] {
            manager
                .create_index(
                    Index::create()
                        .name(idx)
                        .table(Place::Table)
                        .col(col)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .create_index(
                Index::create()
                    .name("Place_province_idx")
                    .table(Place::Table)
                    .col(Place::Province)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Place_type_idx")
                    .table(Place::Table)
                    .col(Place::Type)
                    .to_owned(),
            )
            .await?;

        // ── brand ────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Brand::Table)
                    .col(pk_uuid(Brand::Id))
                    .col(string_len_uniq(Brand::Slug, 120))
                    .col(string_len(Brand::Name, 255))
                    .col(string_len_null(Brand::LogoUrl, 500))
                    .col(text_null(Brand::Description))
                    .col(string_len_null(Brand::ContactPhone, 20))
                    .col(string_len_null(Brand::ContactEmail, 255))
                    .col(double_null(Brand::Rating))
                    .col(string_len(Brand::Status, 30).default("active"))
                    .col(string_len_null(Brand::AccentColor, 9))
                    .col(integer(Brand::TotalTrips).default(0))
                    .col(text(Brand::CreatedAt))
                    .col(text(Brand::UpdatedAt))
                    .to_owned(),
            )
            .await?;

        // ── vehicle_type ─────────────────────────────────────────────
        // Catalog of vehicle classes; `schedule.vehicle_type_id`
        // references this from the schedules migration. Seeded with the
        // five legacy codes by the seed migration.
        manager
            .create_table(
                Table::create()
                    .table(VehicleType::Table)
                    .col(pk_uuid(VehicleType::Id))
                    .col(string_len_uniq(VehicleType::Code, 60))
                    .col(string_len(VehicleType::Label, 120))
                    .col(text_null(VehicleType::Description))
                    .col(small_integer_null(VehicleType::TotalSeats))
                    .col(small_integer(VehicleType::SortOrder).default(0))
                    .col(string_len(VehicleType::Status, 20).default("active"))
                    .col(text(VehicleType::CreatedAt))
                    .col(text(VehicleType::UpdatedAt))
                    .to_owned(),
            )
            .await?;

        // ── address ──────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Address::Table)
                    .col(pk_uuid(Address::Id))
                    .col(uuid(Address::BrandId))
                    .col(string_len(Address::Name, 255))
                    .col(text_null(Address::Address))
                    .col(double(Address::Lat))
                    .col(double(Address::Lon))
                    .col(text_null(Address::Province))
                    .col(text_null(Address::District))
                    .col(text_null(Address::Ward))
                    .col(text(Address::CreatedAt))
                    .col(text(Address::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_address_brand")
                            .from(Address::Table, Address::BrandId)
                            .to(Brand::Table, Brand::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("Address_brand_idx")
                    .table(Address::Table)
                    .col(Address::BrandId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            Address::Table.into_iden(),
            VehicleType::Table.into_iden(),
            Brand::Table.into_iden(),
            Place::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().cascade().to_owned())
                .await?;
        }
        Ok(())
    }
}

// ── Iden enums ──────────────────────────────────────────────────────────

#[derive(DeriveIden)]
enum Place {
    Table,
    Id,
    OsmId,
    Name,
    NameAscii,
    NameNoTones,
    Type,
    Province,
    District,
    Ward,
    Lat,
    Lon,
    Population,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Brand {
    Table,
    Id,
    Slug,
    Name,
    LogoUrl,
    Description,
    ContactPhone,
    ContactEmail,
    Rating,
    Status,
    AccentColor,
    TotalTrips,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum VehicleType {
    Table,
    Id,
    Code,
    Label,
    Description,
    TotalSeats,
    SortOrder,
    Status,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)] // SeaORM Iden: variant name = SQL identifier
enum Address {
    Table,
    Id,
    BrandId,
    Name,
    Address,
    Lat,
    Lon,
    Province,
    District,
    Ward,
    CreatedAt,
    UpdatedAt,
}

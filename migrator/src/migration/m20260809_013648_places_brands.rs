use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum Place {
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
pub enum Brand {
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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Place::Table)
                    .if_not_exists()
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
                    .col(text(Place::CreatedAt)) // You can use timestamp(Place::CreatedAt).default(Expr::current_timestamp()) if you switch to native dates
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Place_nameAscii_idx")
                    .table(Place::Table)
                    .col(Place::NameAscii)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Place_province_idx")
                    .table(Place::Table)
                    .col(Place::Province)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Place_type_idx")
                    .table(Place::Table)
                    .col(Place::Type)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Brand::Table)
                    .if_not_exists()
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

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Brand::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Place::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}

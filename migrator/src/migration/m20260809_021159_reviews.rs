use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::{
    m20250101_000001_create_users::User, m20260809_013648_places_brands::Brand,
    m20260809_014716_routes_pickups_buslayout_seats::Route,
    m20260809_020540_schedules_trips_campaigns::TripSession, m20260809_020741_bookings::Booking,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum Review {
    Table,
    Id,
    BookingId,
    TripSessionId,
    RouteId,
    BrandId,
    AuthorName,
    AuthorPhone,
    Rating,
    Title,
    Content,
    Tags,
    Photos,
    Status,
    HelpfulCount,
    Reply,
    RepliedAt,
    CreatedAt,
    UpdatedAt,
    UserId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Review::Table)
                    .if_not_exists()
                    .col(pk_uuid(Review::Id))
                    .col(text_null(Review::BookingId))
                    .col(text_null(Review::TripSessionId))
                    .col(text_null(Review::RouteId))
                    .col(text_null(Review::BrandId))
                    .col(string_len_null(Review::AuthorName, 255))
                    .col(string_len_null(Review::AuthorPhone, 20))
                    .col(integer(Review::Rating))
                    .col(string_len_null(Review::Title, 255))
                    .col(text_null(Review::Content))
                    .col(text_null(Review::Tags))
                    .col(text_null(Review::Photos))
                    .col(string_len(Review::Status, 30).default("published"))
                    .col(integer(Review::HelpfulCount).default(0))
                    .col(text_null(Review::Reply))
                    .col(text_null(Review::RepliedAt))
                    .col(text(Review::CreatedAt))
                    .col(text(Review::UpdatedAt))
                    .col(text_null(Review::UserId))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_booking")
                            .from(Review::Table, Review::BookingId)
                            .to(Booking::Table, Booking::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_trip")
                            .from(Review::Table, Review::TripSessionId)
                            .to(TripSession::Table, TripSession::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_route")
                            .from(Review::Table, Review::RouteId)
                            .to(Route::Table, Route::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_brand")
                            .from(Review::Table, Review::BrandId)
                            .to(Brand::Table, Brand::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_review_user")
                            .from(Review::Table, Review::UserId)
                            .to(User::Table, User::Id)
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
                    .name("Review_routeId_idx")
                    .table(Review::Table)
                    .col(Review::RouteId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Review_brandId_idx")
                    .table(Review::Table)
                    .col(Review::BrandId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Review_status_idx")
                    .table(Review::Table)
                    .col(Review::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Review_userId_idx")
                    .table(Review::Table)
                    .col(Review::UserId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Review_routeId_createdAt_idx")
                    .table(Review::Table)
                    .col(Review::RouteId)
                    .col(Review::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Review_brandId_createdAt_idx")
                    .table(Review::Table)
                    .col(Review::BrandId)
                    .col(Review::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Review_status_createdAt_idx")
                    .table(Review::Table)
                    .col(Review::Status)
                    .col(Review::CreatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Review::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}

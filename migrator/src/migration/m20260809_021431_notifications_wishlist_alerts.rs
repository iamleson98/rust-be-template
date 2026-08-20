use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::{
    m20250101_000001_create_users::User, m20260809_014716_routes_pickups_buslayout_seats::Route,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum Notification {
    Table,
    Id,
    UserId,
    Type,
    Title,
    Body,
    Data,
    Read,
    CreatedAt,
}

#[derive(DeriveIden)]
pub enum WishlistItem {
    Table,
    Id,
    UserId,
    RouteId,
    CreatedAt,
}

#[derive(DeriveIden)]
pub enum PriceAlert {
    Table,
    Id,
    Phone,
    Email,
    FromName,
    ToName,
    RouteId,
    TargetPrice,
    Frequency,
    Status,
    CreatedAt,
    ExpiresAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Notification
        manager
            .create_table(
                Table::create()
                    .table(Notification::Table)
                    .if_not_exists()
                    .col(pk_uuid(Notification::Id))
                    .col(uuid(Notification::UserId))
                    .col(string_len(Notification::Type, 50))
                    .col(string_len_null(Notification::Title, 255))
                    .col(text_null(Notification::Body))
                    .col(text_null(Notification::Data))
                    .col(boolean(Notification::Read).default(false))
                    .col(text(Notification::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_notification_user")
                            .from(Notification::Table, Notification::UserId)
                            .to(User::Table, User::Id)
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
                    .name("Notification_userId_idx")
                    .table(Notification::Table)
                    .col(Notification::UserId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Notification_user_read_idx")
                    .table(Notification::Table)
                    .col(Notification::UserId)
                    .col(Notification::Read)
                    .to_owned(),
            )
            .await?;

        // WishlistItem
        manager
            .create_table(
                Table::create()
                    .table(WishlistItem::Table)
                    .if_not_exists()
                    .col(pk_uuid(WishlistItem::Id))
                    .col(uuid(WishlistItem::UserId))
                    .col(uuid(WishlistItem::RouteId))
                    .col(text(WishlistItem::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_wishlist_user")
                            .from(WishlistItem::Table, WishlistItem::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_wishlist_route")
                            .from(WishlistItem::Table, WishlistItem::RouteId)
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
                    .name("WishlistItem_userId_idx")
                    .table(WishlistItem::Table)
                    .col(WishlistItem::UserId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("WishlistItem_user_route_uniq")
                    .table(WishlistItem::Table)
                    .col(WishlistItem::UserId)
                    .col(WishlistItem::RouteId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // PriceAlert
        manager
            .create_table(
                Table::create()
                    .table(PriceAlert::Table)
                    .if_not_exists()
                    .col(pk_uuid(PriceAlert::Id))
                    .col(string_len(PriceAlert::Phone, 20))
                    .col(string_len_null(PriceAlert::Email, 255))
                    .col(string_len_null(PriceAlert::FromName, 255))
                    .col(string_len_null(PriceAlert::ToName, 255))
                    .col(uuid_null(PriceAlert::RouteId))
                    .col(integer_null(PriceAlert::TargetPrice))
                    .col(string_len(PriceAlert::Frequency, 10).default("daily"))
                    .col(string_len(PriceAlert::Status, 30).default("active"))
                    .col(text(PriceAlert::CreatedAt))
                    .col(text_null(PriceAlert::ExpiresAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_pricealert_route")
                            .from(PriceAlert::Table, PriceAlert::RouteId)
                            .to(Route::Table, Route::Id)
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
                    .name("PriceAlert_phone_idx")
                    .table(PriceAlert::Table)
                    .col(PriceAlert::Phone)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("PriceAlert_status_idx")
                    .table(PriceAlert::Table)
                    .col(PriceAlert::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("PriceAlert_routeId_idx")
                    .table(PriceAlert::Table)
                    .col(PriceAlert::RouteId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PriceAlert::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(WishlistItem::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(Notification::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

//! Drop the `wishlist_item` table — the wishlist ("favorite routes")
//! feature is being removed from the product.
//!
//! The table was created by `m20260905_000009_create_engagement_jobs`.
//! All backend code (routes / service / store / entity) has been
//! deleted; this migration removes the now-orphaned data so fresh
//! installs and upgrades land on the same schema.
//!
//! `down` recreates the original table shape for rollback parity with
//! the creating migration (indexes included).

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(WishlistItem::Table).to_owned())
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(WishlistItem::Table)
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
                    .name("WishlistItem_userId_idx")
                    .table(WishlistItem::Table)
                    .col(WishlistItem::UserId)
                    .to_owned(),
            )
            .await?;
        // A route is saved at most once per user.
        manager
            .create_index(
                Index::create()
                    .name("WishlistItem_user_route_uniq")
                    .table(WishlistItem::Table)
                    .col(WishlistItem::UserId)
                    .col(WishlistItem::RouteId)
                    .unique()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

// ── Minimal Iden enums (tables owned by earlier migrations) ─────────

#[derive(DeriveIden)]
enum WishlistItem {
    Table,
    Id,
    UserId,
    RouteId,
    CreatedAt,
}

#[derive(DeriveIden)]
enum User {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Route {
    Table,
    Id,
}

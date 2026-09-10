//! Route pictures — photo gallery per bus route.
//!
//! Backs the route-media feature: each route carries a few photos
//! (vehicle, stations, scenery) shown on the route detail page and as
//! cover thumbnails on list/search pages.
//!
//! Design notes:
//!   * Separate table (NOT a JSON column like `review.photos`) because
//!     the gallery is ordered, per-image metadata is queried by the
//!     public read path, and object storage keys need DB-driven
//!     garbage collection when rows go away.
//!   * `storage_key` is content-addressed (`routes/{route_id}/{hash16}.{ext}`):
//!     the content hash makes the object IMMUTABLE — uploads with the
//!     same bytes for the same route dedupe into the same key, and the
//!     API can emit `Cache-Control: public, max-age=31536000, immutable`
//!     + a strong ETag without ever needing a cache purge.
//!   * `thumb_key` points at a JPEG re-encode (long edge 640px) written
//!     at upload time — route lists must not download 4 MB phone
//!     photos.
//!   * `sort_order` — 0 is the cover picture. Reordering is a plain
//!     `UPDATE`, never a re-upload.
//!   * FK `ON DELETE CASCADE` on `route_id`: dropping a route removes
//!     its picture rows; the service layer deletes the objects first
//!     (rows are the only index of which objects exist).

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // NOTE: no inline `.index(...)` inside create_table — the
        // rust-sql engine's parser rejects inline INDEX table
        // constraints (SQLite legacy extension; standard SQL wants
        // separate CREATE INDEX statements).
        manager
            .create_table(
                Table::create()
                    .table(RoutePicture::Table)
                    .col(pk_uuid(RoutePicture::Id))
                    .col(uuid(RoutePicture::RouteId))
                    .col(integer(RoutePicture::SortOrder).default(0))
                    .col(text(RoutePicture::StorageKey))
                    .col(text(RoutePicture::ThumbKey))
                    .col(string_len(RoutePicture::ContentHash, 64))
                    .col(string_len(RoutePicture::MimeType, 30))
                    .col(big_integer(RoutePicture::SizeBytes))
                    .col(big_integer(RoutePicture::ThumbBytes))
                    .col(integer(RoutePicture::Width))
                    .col(integer(RoutePicture::Height))
                    .col(string_len_null(RoutePicture::AltText, 255))
                    .col(text(RoutePicture::CreatedAt))
                    .col(text(RoutePicture::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_route_picture_route")
                            .from(RoutePicture::Table, RoutePicture::RouteId)
                            .to(Route::Table, Route::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Gallery read path: all pictures of one route in display order.
        manager
            .create_index(
                Index::create()
                    .name("idx_route_picture_route_sort")
                    .table(RoutePicture::Table)
                    .col(RoutePicture::RouteId)
                    .col(RoutePicture::SortOrder)
                    .to_owned(),
            )
            .await?;

        // Content-addressed dedupe: uploading the exact same bytes for
        // the same route twice must resolve to the existing row.
        manager
            .create_index(
                Index::create()
                    .name("idx_route_picture_route_hash_unique")
                    .unique()
                    .table(RoutePicture::Table)
                    .col(RoutePicture::RouteId)
                    .col(RoutePicture::ContentHash)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RoutePicture::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum RoutePicture {
    Table,
    Id,
    RouteId,
    SortOrder,
    StorageKey,
    ThumbKey,
    ContentHash,
    MimeType,
    SizeBytes,
    ThumbBytes,
    Width,
    Height,
    AltText,
    CreatedAt,
    UpdatedAt,
}

/// Minimal reference to the table created by the route-network migration.
#[derive(DeriveIden)]
enum Route {
    Table,
    Id,
}

//! Wishlist store — read/write access to the `wishlist_item` table.
//!
//! Follows the template's store pattern: `WishlistStore` trait +
//! `DbWishlistStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::wishlist_item;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

/// Parse a uuid string for a query filter BIND. SQLite stores Uuid
/// columns as 16-byte BLOBs — binding a TEXT value never matches, so
/// every uuid filter must bind the parsed `Uuid` (Postgres casts
/// text->uuid implicitly, SQLite does not).
fn parse_uuid(s: &str) -> StoreResult<uuid::Uuid> {
    uuid::Uuid::parse_str(s).map_err(|_| StoreError::Validation(format!("invalid uuid: {s}")))
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait WishlistStore: Send + Sync {
    /// List wishlist items for a user, newest first.
    async fn list_by_user(
        &self,
        user_id: &str,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<wishlist_item::Model>>;

    /// Count all wishlist items for a user (for the `total` field).
    async fn count_by_user(&self, user_id: &str) -> StoreResult<u64>;

    /// Find a wishlist item by id (returns None if not found or owned
    /// by a different user — caller passes `user_id` for ownership check).
    async fn find_by_id_for_user(
        &self,
        id: Uuid,
        user_id: &str,
    ) -> StoreResult<Option<wishlist_item::Model>>;

    /// Find an existing wishlist item for a (user_id, route_id) pair —
    /// used by the toggle endpoint to dedupe.
    async fn find_by_user_and_route(
        &self,
        user_id: &str,
        route_id: &str,
    ) -> StoreResult<Option<wishlist_item::Model>>;

    /// Insert a new wishlist item.
    async fn insert(&self, model: wishlist_item::ActiveModel) -> StoreResult<wishlist_item::Model>;

    /// Delete a wishlist item by id. Returns true if a row was deleted.
    async fn delete(&self, id: Uuid) -> StoreResult<bool>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbWishlistStore {
    db: Arc<DatabaseConnection>,
}

impl DbWishlistStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbWishlistStore {}

#[async_trait]
#[retry]
impl WishlistStore for DbWishlistStore {
    async fn list_by_user(
        &self,
        user_id: &str,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<wishlist_item::Model>> {
        Ok(wishlist_item::Entity::find()
            .filter(wishlist_item::Column::UserId.eq(parse_uuid(user_id)?))
            .order_by_desc(wishlist_item::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_by_user(&self, user_id: &str) -> StoreResult<u64> {
        Ok(wishlist_item::Entity::find()
            .filter(wishlist_item::Column::UserId.eq(parse_uuid(user_id)?))
            .count(self.db.as_ref())
            .await?)
    }

    async fn find_by_id_for_user(
        &self,
        id: Uuid,
        user_id: &str,
    ) -> StoreResult<Option<wishlist_item::Model>> {
        Ok(wishlist_item::Entity::find_by_id(id)
            .filter(wishlist_item::Column::UserId.eq(parse_uuid(user_id)?))
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_by_user_and_route(
        &self,
        user_id: &str,
        route_id: &str,
    ) -> StoreResult<Option<wishlist_item::Model>> {
        Ok(wishlist_item::Entity::find()
            .filter(wishlist_item::Column::UserId.eq(parse_uuid(user_id)?))
            .filter(wishlist_item::Column::RouteId.eq(parse_uuid(route_id)?))
            .one(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert(&self, model: wishlist_item::ActiveModel) -> StoreResult<wishlist_item::Model> {
        Ok(model.insert(self.db.as_ref()).await?)
    }

    #[store_macros::no_retry]
    async fn delete(&self, id: Uuid) -> StoreResult<bool> {
        let res = wishlist_item::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected > 0)
    }
}

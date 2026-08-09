//! Review store — read/write access to the `review` table.
//!
//! Follows the template's store pattern: `ReviewStore` trait +
//! `DbReviewStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::review;

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait ReviewStore: Send + Sync {
    async fn find_review_by_id(&self, id: Uuid) -> StoreResult<Option<review::Model>>;
    async fn list_reviews(
        &self,
        brand_id: Option<&str>,
        route_id: Option<&str>,
        user_id: Option<&str>,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<review::Model>>;
    async fn list_all_reviews(&self) -> StoreResult<Vec<review::Model>>;
    async fn list_reviews_by_brand(&self, brand_id: &str, status: &str) -> StoreResult<Vec<review::Model>>;
    async fn insert_review(&self, model: review::ActiveModel) -> StoreResult<()>;
    async fn update_review(&self, model: review::ActiveModel) -> StoreResult<review::Model>;
    async fn delete_review(&self, id: Uuid) -> StoreResult<()>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbReviewStore {
    db: Arc<DatabaseConnection>,
}

impl DbReviewStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbReviewStore {}

#[async_trait]
#[retry]
impl ReviewStore for DbReviewStore {
    async fn find_review_by_id(&self, id: Uuid) -> StoreResult<Option<review::Model>> {
        Ok(review::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_reviews(
        &self,
        brand_id: Option<&str>,
        route_id: Option<&str>,
        user_id: Option<&str>,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<review::Model>> {
        let mut query = review::Entity::find();

        if let Some(bid) = brand_id {
            query = query.filter(review::Column::BrandId.eq(bid.to_string()));
        }
        if let Some(rid) = route_id {
            query = query.filter(review::Column::RouteId.eq(rid.to_string()));
        }
        if let Some(uid) = user_id {
            query = query.filter(review::Column::UserId.eq(uid.to_string()));
        }
        if let Some(s) = status {
            query = query.filter(review::Column::Status.eq(s.to_string()));
        }

        Ok(query
            .order_by_desc(review::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_all_reviews(&self) -> StoreResult<Vec<review::Model>> {
        Ok(review::Entity::find().all(self.db.as_ref()).await?)
    }

    async fn list_reviews_by_brand(&self, brand_id: &str, status: &str) -> StoreResult<Vec<review::Model>> {
        Ok(review::Entity::find()
            .filter(review::Column::BrandId.eq(brand_id.to_string()))
            .filter(review::Column::Status.eq(status.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_review(&self, model: review::ActiveModel) -> StoreResult<()> {
        review::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update_review(&self, model: review::ActiveModel) -> StoreResult<review::Model> {
        Ok(review::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn delete_review(&self, id: Uuid) -> StoreResult<()> {
        review::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }
}

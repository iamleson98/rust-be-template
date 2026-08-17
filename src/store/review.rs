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

    /// Fetch the distinct set of tag strings across all reviews (or
    /// filtered by status). Replaces the previous `list_all_reviews()`
    /// + `split(',')` + `HashSet` pattern that loaded every review row
    /// into memory just to extract the distinct tag set.
    ///
    /// Note: tags are stored as a comma-separated `Option<String>` column.
    /// On Postgres this would use `regexp_split_to_table`; on SQLite we
    /// fetch only the `tags` column (much smaller than full rows) and
    /// split client-side. Either way, the result is at most a few dozen
    /// unique tag strings — never the full table.
    async fn list_distinct_tags(&self, status: Option<&str>) -> StoreResult<Vec<String>>;
    async fn list_reviews_by_brand(
        &self,
        brand_id: &str,
        status: &str,
    ) -> StoreResult<Vec<review::Model>>;
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
        Ok(review::Entity::find_by_id(id).one(self.db.as_ref()).await?)
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

    async fn list_distinct_tags(&self, status: Option<&str>) -> StoreResult<Vec<String>> {
        // Project only the `tags` column (much smaller payload than full rows)
        // and split client-side. The previous pattern loaded every review row
        // in full — at 10k reviews that's MBs per call just to extract a
        // handful of unique tag strings.
        let mut q = review::Entity::find()
            .filter(review::Column::Tags.is_not_null())
            .select_only();
        q = q.column(review::Column::Tags);
        if let Some(s) = status {
            q = q.filter(review::Column::Status.eq(s.to_string()));
        }
        let rows: Vec<Option<String>> = q
            .into_tuple::<Option<String>>()
            .all(self.db.as_ref())
            .await?;
        let mut tags: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for s in rows.into_iter().flatten() {
            for tag in s.split(',') {
                let t = tag.trim();
                if !t.is_empty() {
                    tags.insert(t.to_string());
                }
            }
        }
        Ok(tags.into_iter().collect())
    }

    async fn list_reviews_by_brand(
        &self,
        brand_id: &str,
        status: &str,
    ) -> StoreResult<Vec<review::Model>> {
        Ok(review::Entity::find()
            .filter(review::Column::BrandId.eq(brand_id.to_string()))
            .filter(review::Column::Status.eq(status.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_review(&self, model: review::ActiveModel) -> StoreResult<()> {
        review::Entity::insert(model).exec(self.db.as_ref()).await?;
        Ok(())
    }

    async fn update_review(&self, model: review::ActiveModel) -> StoreResult<review::Model> {
        Ok(review::Entity::update(model).exec(self.db.as_ref()).await?)
    }

    async fn delete_review(&self, id: Uuid) -> StoreResult<()> {
        review::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }
}

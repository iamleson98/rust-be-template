//! Review store — read/write access to the `review` table.
//!
//! Follows the template's store pattern: `ReviewStore` trait +
//! `DbReviewStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::sea_query::{Expr, Func};
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::review;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

/// Per-brand `(brand_id, status, count)` aggregate row.
pub type BrandStatusCount = (Option<Uuid>, String, i64);

/// Per-brand `(brand_id, avg_rating)` aggregate row.
pub type BrandRatingAvg = (Option<Uuid>, Option<f64>);

#[async_trait]
pub trait ReviewStore: Send + Sync {
    async fn find_review_by_id(&self, id: Uuid) -> StoreResult<Option<review::Model>>;
    #[allow(clippy::too_many_arguments)] // explicit filter tuple; a filter struct would obscure the SQL
    async fn list_reviews(
        &self,
        brand_id: Option<&str>,
        route_id: Option<&str>,
        user_id: Option<&str>,
        status: Option<&str>,
        search: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<review::Model>>;
    /// Count rows matching the SAME filters as [`ReviewStore::list_reviews`]
    /// (minus paging) — backs the admin feedback table's server-side
    /// pagination total.
    async fn count_reviews(
        &self,
        brand_id: Option<&str>,
        route_id: Option<&str>,
        user_id: Option<&str>,
        status: Option<&str>,
        search: Option<&str>,
    ) -> StoreResult<u64>;
    async fn list_all_reviews(&self) -> StoreResult<Vec<review::Model>>;

    /// `GROUP BY (brand_id, status) → count` — the per-brand feedback
    /// summary building block. Includes a `brand_id = NULL` bucket for
    /// reviews not linked to any brand.
    async fn count_reviews_grouped_by_brand_status(&self) -> StoreResult<Vec<BrandStatusCount>>;

    /// `GROUP BY brand_id → AVG(rating)` — the per-brand average star
    /// rating across ALL moderation statuses (the admin summary shows
    /// overall sentiment; the public brand rating shown to customers
    /// is computed from approved reviews only elsewhere).
    async fn avg_rating_grouped_by_brand(&self) -> StoreResult<Vec<BrandRatingAvg>>;

    /// Fetch the distinct set of tag strings across all reviews (or
    /// filtered by status). Replaces the previous `list_all_reviews()`
    /// + `split(',')` + `HashSet` pattern that loaded every review row
    /// into memory just to extract the distinct tag set.
    ///
    /// Note: tags are stored as a comma-separated `Option<String>` column.
    /// On Postgres this would be `regexp_split_to_table`; with the rust-sql
    /// engine we
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
//  Shared filter builders
// ────────────────────────────────────────────────────────────────

/// Apply the shared list filters (brand/route/user/status) to a query.
/// Kept as a free function so `list_reviews` and `count_reviews`
/// build identical WHERE clauses — a mismatch between the two would
/// desync the pagination total from the page contents.
///
/// UUID filters bind as `Uuid` VALUES, never strings: the engine
/// stores Uuid columns as 16-byte BLOBs, and a TEXT bind never
/// matches a BLOB column.
fn apply_review_filters<Q>(
    query: Q,
    brand_id: Option<&str>,
    route_id: Option<&str>,
    user_id: Option<&str>,
    status: Option<&str>,
) -> Q
where
    Q: QueryFilter,
{
    let mut query = query;
    if let Some(bid) = brand_id.and_then(|s| Uuid::parse_str(s).ok()) {
        query = query.filter(review::Column::BrandId.eq(bid));
    }
    if let Some(rid) = route_id.and_then(|s| Uuid::parse_str(s).ok()) {
        query = query.filter(review::Column::RouteId.eq(rid));
    }
    if let Some(uid) = user_id.and_then(|s| Uuid::parse_str(s).ok()) {
        query = query.filter(review::Column::UserId.eq(uid));
    }
    if let Some(s) = status {
        query = query.filter(review::Column::Status.eq(s.to_string()));
    }
    query
}

/// Apply the admin free-text search — matches author name, author
/// phone, title and content. SQLite's `LIKE` is ASCII-case-insensitive
/// natively via `LOWER()` on both sides for the same effect.
fn apply_review_search<Q>(query: Q, search: Option<&str>) -> Q
where
    Q: QueryFilter,
{
    let term = search.map(str::trim).filter(|s| !s.is_empty());
    if term.is_none() {
        return query;
    }
    let term = term.expect("checked above");
    let pattern = format!("%{}%", term);
    query.filter(
        sea_orm::Condition::any()
            .add(Expr::col(review::Column::AuthorName).like(pattern.clone()))
            .add(Expr::col(review::Column::AuthorPhone).like(pattern.clone()))
            .add(Expr::col(review::Column::Title).like(pattern.clone()))
            .add(Expr::col(review::Column::Content).like(pattern)),
    )
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
        search: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<review::Model>> {
        let query =
            apply_review_filters(review::Entity::find(), brand_id, route_id, user_id, status);
        let query = apply_review_search(query, search);
        let query = query
            .order_by_desc(review::Column::CreatedAt)
            .limit(limit)
            .offset(offset);
        Ok(query.all(self.db.as_ref()).await?)
    }

    async fn count_reviews(
        &self,
        brand_id: Option<&str>,
        route_id: Option<&str>,
        user_id: Option<&str>,
        status: Option<&str>,
        search: Option<&str>,
    ) -> StoreResult<u64> {
        let query =
            apply_review_filters(review::Entity::find(), brand_id, route_id, user_id, status);
        let query = apply_review_search(query, search);
        Ok(query.count(self.db.as_ref()).await?)
    }

    async fn list_all_reviews(&self) -> StoreResult<Vec<review::Model>> {
        Ok(review::Entity::find().all(self.db.as_ref()).await?)
    }

    async fn count_reviews_grouped_by_brand_status(&self) -> StoreResult<Vec<BrandStatusCount>> {
        let rows: Vec<(Option<Uuid>, String, i64)> = review::Entity::find()
            .select_only()
            .column(review::Column::BrandId)
            .column(review::Column::Status)
            .expr_as(Func::count(Expr::col(review::Column::Id)), "count")
            .group_by(review::Column::BrandId)
            .group_by(review::Column::Status)
            .into_tuple()
            .all(self.db.as_ref())
            .await?;
        Ok(rows)
    }

    async fn avg_rating_grouped_by_brand(&self) -> StoreResult<Vec<BrandRatingAvg>> {
        let rows: Vec<(Option<Uuid>, Option<f64>)> = review::Entity::find()
            .select_only()
            .column(review::Column::BrandId)
            .expr_as(Func::avg(Expr::col(review::Column::Rating)), "avg_rating")
            .group_by(review::Column::BrandId)
            .into_tuple()
            .all(self.db.as_ref())
            .await?;
        Ok(rows)
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
        // Bind the brand id as a Uuid VALUE (see apply_review_filters
        // for why TEXT binds never match on SQLite).
        let bid = Uuid::parse_str(brand_id)
            .map_err(|_| StoreError::Validation(format!("invalid brand id: {brand_id}")))?;
        Ok(review::Entity::find()
            .filter(review::Column::BrandId.eq(bid))
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

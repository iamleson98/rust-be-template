//! The DB layer — actual SeaORM interaction logic.
//!
//! Every async method here is wrapped by `#[retry]` to apply
//! exponential-backoff retry on transient DB failures. The struct
//! implements `RetryPolicy` (using defaults) so the macro knows the
//! policy.
//!
//! Methods that are NOT idempotent (e.g. INSERTs that generate new IDs)
//! are marked `#[store_macros::no_retry]` so retries don't create duplicates. A real
//! codebase would refactor those to accept caller-provided IDs, making
//! them idempotent and safe to retry — flagged in comments below.

use std::sync::Arc;

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, JoinType, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, RelationTrait, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::{permission, post, refresh_token, role, role_permission, user, user_role};

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;
use super::store::{Store, UserPermissions};

#[derive(Clone)]
pub struct DbStore {
    db: Arc<DatabaseConnection>,
}

impl DbStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }

    /// Helper: look up a user's roles + permissions via two queries joined
    /// in memory. Cached one level up by `CacheStore`.
    async fn fetch_user_permissions(
        &self,
        user_id: Uuid,
    ) -> StoreResult<UserPermissions> {
        let db = self.db.as_ref();
        let roles: Vec<role::Model> = role::Entity::find()
            .join_rev(JoinType::InnerJoin, user_role::Relation::Role.def())
            .filter(user_role::Column::UserId.eq(user_id))
            .all(db)
            .await?;

        let role_ids: Vec<Uuid> = roles.iter().map(|r| r.id).collect();
        let role_names: Vec<String> = roles.iter().map(|r| r.name.clone()).collect();

        let permissions: Vec<permission::Model> = if role_ids.is_empty() {
            Vec::new()
        } else {
            permission::Entity::find()
                .join_rev(
                    JoinType::InnerJoin,
                    role_permission::Relation::Permission.def(),
                )
                .filter(role_permission::Column::RoleId.is_in(role_ids))
                .all(db)
                .await?
        };

        Ok(UserPermissions {
            user_id,
            permission_names: permissions.iter().map(|p| p.name.clone()).collect(),
            role_names,
            fetched_at: Utc::now().naive_utc(),
        })
    }
}

/// Default retry policy: 3 retries, 100ms base, exponential backoff.
/// Override any method here to customize (e.g. `max_retries` for tests).
impl RetryPolicy for DbStore {}

/// `#[retry]` wraps every `async fn` body in a retry loop. Methods marked
/// `#[store_macros::no_retry]` are skipped (used for non-idempotent operations like
/// INSERTs that generate new UUIDs on each call).
#[async_trait]
#[retry]
impl Store for DbStore {
    // ---------- users ----------
    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model> {
        user::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("user {id}")))
    }

    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>> {
        Ok(user::Entity::find()
            .filter(user::Column::Email.eq(email))
            .one(self.db.as_ref())
            .await?)
    }

    /// Non-idempotent: generates a new UUID each call. Marked `#[store_macros::no_retry]`
    /// because retrying would create duplicate users with different IDs.
    /// Refactor to take an `id: Uuid` parameter to make it retry-safe.
    #[store_macros::no_retry]
    async fn create_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
    ) -> StoreResult<user::Model> {
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4();
        let model = user::ActiveModel {
            id: Set(id),
            email: Set(email.clone()),
            username: Set(username.clone()),
            password_hash: Set(password_hash.clone()),
            created_at: Set(now),
            updated_at: Set(now),
        };
        // Use `exec_without_returning` so sea-orm doesn't try to refetch
        // by last_insert_rowid (which returns the integer autoincrement
        // rowid, not our UUID PK).
        match user::Entity::insert(model).exec_without_returning(self.db.as_ref()).await {
            Ok(_) => Ok(user::Model {
                id,
                email,
                username,
                password_hash,
                created_at: now,
                updated_at: now,
            }),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("unique") || msg.contains("duplicate") {
                    Err(StoreError::Conflict(msg))
                } else {
                    Err(e.into())
                }
            }
        }
    }

    async fn delete_user(&self, id: Uuid) -> StoreResult<()> {
        user::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    // ---------- posts ----------
    async fn get_post(&self, id: Uuid) -> StoreResult<post::Model> {
        post::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("post {id}")))
    }

    async fn list_posts(&self, limit: u64, offset: u64) -> StoreResult<Vec<post::Model>> {
        let rows = post::Entity::find()
            .order_by_desc(post::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(self.db.as_ref())
            .await?;
        Ok(rows)
    }

    /// Non-idempotent: generates a new UUID each call. Marked `#[store_macros::no_retry]`.
    #[store_macros::no_retry]
    async fn create_post(
        &self,
        author_id: Uuid,
        title: String,
        body: String,
    ) -> StoreResult<post::Model> {
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4();
        let model = post::ActiveModel {
            id: Set(id),
            author_id: Set(author_id),
            title: Set(title.clone()),
            body: Set(body.clone()),
            created_at: Set(now),
            updated_at: Set(now),
        };
        // Use `exec_without_returning` so sea-orm doesn't try to refetch
        // by last_insert_rowid (which returns the integer autoincrement
        // rowid, not our UUID PK).
        post::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await?;
        Ok(post::Model {
            id,
            author_id,
            title,
            body,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update_post(
        &self,
        id: Uuid,
        title: Option<String>,
        body: Option<String>,
    ) -> StoreResult<post::Model> {
        let existing = post::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("post {id}")))?;
        let mut am: post::ActiveModel = existing.into();
        if let Some(t) = title {
            am.title = Set(t);
        }
        if let Some(b) = body {
            am.body = Set(b);
        }
        am.updated_at = Set(Utc::now().naive_utc());
        Ok(am.update(self.db.as_ref()).await?)
    }

    async fn delete_post(&self, id: Uuid) -> StoreResult<()> {
        post::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    // ---------- RBAC ----------
    async fn get_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions> {
        self.fetch_user_permissions(user_id).await
    }

    async fn assign_role(&self, user_id: Uuid, role_id: Uuid) -> StoreResult<()> {
        let am = user_role::ActiveModel {
            user_id: Set(user_id),
            role_id: Set(role_id),
            assigned_at: Set(Utc::now().naive_utc()),
        };
        user_role::Entity::insert(am)
            .on_conflict(
                sea_orm::sea_query::OnConflict::columns([
                    user_role::Column::UserId,
                    user_role::Column::RoleId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .do_nothing()
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn list_roles(&self) -> StoreResult<Vec<role::Model>> {
        Ok(role::Entity::find()
            .order_by_asc(role::Column::Name)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_permissions(&self) -> StoreResult<Vec<permission::Model>> {
        Ok(permission::Entity::find()
            .order_by_asc(permission::Column::Name)
            .all(self.db.as_ref())
            .await?)
    }

    // ---------- refresh tokens ----------
    /// Non-idempotent: INSERT with caller-generated ID. The ID is part of
    /// the input model so retry would actually be safe (INSERT with same
    /// idempotency key), but to avoid duplicate-row errors on partial
    /// failures we mark `#[store_macros::no_retry]` here. A real impl would use
    /// `ON CONFLICT DO NOTHING` and then retry safely.
    #[store_macros::no_retry]
    async fn save_refresh_token(&self, token: refresh_token::Model) -> StoreResult<()> {
        let am = refresh_token::ActiveModel {
            id: Set(token.id),
            user_id: Set(token.user_id),
            token_hash: Set(token.token_hash),
            issued_at: Set(token.issued_at),
            expires_at: Set(token.expires_at),
            revoked: Set(token.revoked),
            user_agent: Set(token.user_agent),
            ip: Set(token.ip),
        };
        refresh_token::Entity::insert(am).exec(self.db.as_ref()).await?;
        Ok(())
    }

    async fn get_refresh_token(
        &self,
        id: Uuid,
    ) -> StoreResult<Option<refresh_token::Model>> {
        Ok(refresh_token::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn revoke_refresh_token(&self, id: Uuid) -> StoreResult<()> {
        refresh_token::Entity::update_many()
            .col_expr(refresh_token::Column::Revoked, Expr::value(true))
            .filter(refresh_token::Column::Id.eq(id))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn revoke_all_refresh_tokens_for_user(&self, user_id: Uuid) -> StoreResult<()> {
        refresh_token::Entity::update_many()
            .col_expr(refresh_token::Column::Revoked, Expr::value(true))
            .filter(refresh_token::Column::UserId.eq(user_id))
            .filter(refresh_token::Column::Revoked.eq(false))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }
}

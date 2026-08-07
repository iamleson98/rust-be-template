use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, JoinType, QueryFilter, QueryOrder, QuerySelect,
    RelationTrait, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::entity::{permission, role, role_permission, user_role};

use super::error::StoreResult;
use super::retry::RetryPolicy;
use super::UserPermissions;

#[async_trait]
pub trait RbacStore: Send + Sync {
    async fn get_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions>;
    async fn assign_role(&self, user_id: Uuid, role_id: Uuid) -> StoreResult<()>;
    async fn list_roles(&self) -> StoreResult<Vec<role::Model>>;
    async fn list_permissions(&self) -> StoreResult<Vec<permission::Model>>;
}

#[derive(Clone)]
pub struct DbRbacStore {
    db: Arc<DatabaseConnection>,
}

impl DbRbacStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }

    async fn fetch_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions> {
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
                .join_rev(JoinType::InnerJoin, role_permission::Relation::Permission.def())
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

impl RetryPolicy for DbRbacStore {}

#[async_trait]
#[retry]
impl RbacStore for DbRbacStore {
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
}

pub struct CacheRbacStore<S: RbacStore> {
    pub inner: Arc<S>,
    pub cache: Arc<dyn CacheBackend>,
    pub ttl: Duration,
}

impl<S: RbacStore> CacheRbacStore<S> {
    pub fn new(inner: S, cache: Arc<dyn CacheBackend>, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(inner),
            cache,
            ttl,
        }
    }
}

impl<S: RbacStore> Clone for CacheRbacStore<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            cache: self.cache.clone(),
            ttl: self.ttl,
        }
    }
}

fn perms_key(id: Uuid) -> String {
    format!("rbac:perms:{id}")
}

#[async_trait]
impl<S: RbacStore> RbacStore for CacheRbacStore<S> {
    async fn get_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions> {
        let key = perms_key(user_id);
        match get_serializable::<UserPermissions>(self.cache.as_ref(), &key).await {
            Ok(Some(v)) => return Ok(v),
            Ok(None) => {}
            Err(e) => {
                tracing::warn!(key = %key, error = %e, "cache read failed; falling through to DB");
            }
        }

        let perms = self.inner.get_user_permissions(user_id).await?;
        if let Err(e) =
            set_serializable(self.cache.as_ref(), &key, &perms, Some(self.ttl)).await
        {
            tracing::warn!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
        }
        Ok(perms)
    }

    async fn assign_role(&self, user_id: Uuid, role_id: Uuid) -> StoreResult<()> {
        let result = self.inner.assign_role(user_id, role_id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&perms_key(user_id)).await;
        }
        result
    }

    async fn list_roles(&self) -> StoreResult<Vec<role::Model>> {
        self.inner.list_roles().await
    }

    async fn list_permissions(&self) -> StoreResult<Vec<permission::Model>> {
        self.inner.list_permissions().await
    }
}

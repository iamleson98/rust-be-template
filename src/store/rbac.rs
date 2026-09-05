use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, JoinType, QueryFilter, QueryOrder, QuerySelect,
    RelationTrait, Set,
};
use serde::{Deserialize, Serialize};
use store_macros::retry;
use uuid::Uuid;

use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::entity::{permissions, role_permissions, roles, user_roles};

use super::error::StoreResult;
use super::retry::RetryPolicy;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPermissions {
    pub user_id: uuid::Uuid,
    pub permission_names: Vec<String>,
    pub role_names: Vec<String>,
    pub fetched_at: DateTime<Utc>,
}

#[async_trait]
pub trait RbacStore: Send + Sync {
    async fn get_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions>;
    async fn assign_role(&self, user_id: Uuid, role_id: Uuid) -> StoreResult<()>;
    /// Remove EVERY role grant for a user (role-management rewrites).
    async fn revoke_all_roles(&self, user_id: Uuid) -> StoreResult<()>;
    async fn list_roles(&self) -> StoreResult<Vec<roles::Model>>;
    async fn list_permissions(&self) -> StoreResult<Vec<permissions::Model>>;
    async fn fetch_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions>;
}

#[derive(Clone)]
pub struct DbRbacStore {
    db: Arc<DatabaseConnection>,
}
impl RetryPolicy for DbRbacStore {}

impl DbRbacStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

#[async_trait]
#[retry]
impl RbacStore for DbRbacStore {
    async fn get_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions> {
        self.fetch_user_permissions(user_id).await
    }

    async fn assign_role(&self, user_id: Uuid, role_id: Uuid) -> StoreResult<()> {
        let am = user_roles::ActiveModel {
            user_id: Set(user_id),
            role_id: Set(role_id),
            assigned_at: Set(Utc::now()),
        };

        user_roles::Entity::insert(am)
            .on_conflict(
                sea_orm::sea_query::OnConflict::columns([
                    user_roles::Column::UserId,
                    user_roles::Column::RoleId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .do_nothing()
            .exec(self.db.as_ref())
            .await?;

        Ok(())
    }

    async fn revoke_all_roles(&self, user_id: Uuid) -> StoreResult<()> {
        user_roles::Entity::delete_many()
            .filter(user_roles::Column::UserId.eq(user_id))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn list_roles(&self) -> StoreResult<Vec<roles::Model>> {
        Ok(roles::Entity::find()
            .order_by_asc(roles::Column::Name)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_permissions(&self) -> StoreResult<Vec<permissions::Model>> {
        Ok(permissions::Entity::find()
            .order_by_asc(permissions::Column::Name)
            .all(self.db.as_ref())
            .await?)
    }

    async fn fetch_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions> {
        let db: &DatabaseConnection = self.db.as_ref();
        let roles: Vec<roles::Model> = roles::Entity::find()
            .join_rev(JoinType::InnerJoin, user_roles::Relation::Roles.def())
            .filter(user_roles::Column::UserId.eq(user_id))
            .all(db)
            .await?;

        let role_ids: Vec<Uuid> = roles.iter().map(|r| r.id).collect();
        let role_names: Vec<String> = roles.iter().map(|r| r.name.clone()).collect();

        let permissions: Vec<permissions::Model> = if role_ids.is_empty() {
            Vec::new()
        } else {
            permissions::Entity::find()
                .join_rev(
                    JoinType::InnerJoin,
                    role_permissions::Relation::Permissions.def(),
                )
                .filter(role_permissions::Column::RoleId.is_in(role_ids))
                .all(db)
                .await?
        };

        Ok(UserPermissions {
            user_id,
            permission_names: permissions.iter().map(|p| p.name.clone()).collect(),
            role_names,
            fetched_at: Utc::now(),
        })
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
                tracing::debug!(key = %key, error = %e, "cache read failed; falling through to DB");
            }
        }

        let perms = self.inner.get_user_permissions(user_id).await?;
        if let Err(e) = set_serializable(self.cache.as_ref(), &key, &perms, Some(self.ttl)).await {
            tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
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

    async fn list_roles(&self) -> StoreResult<Vec<roles::Model>> {
        self.inner.list_roles().await
    }

    async fn list_permissions(&self) -> StoreResult<Vec<permissions::Model>> {
        self.inner.list_permissions().await
    }

    async fn fetch_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions> {
        self.inner.fetch_user_permissions(user_id).await
    }

    async fn revoke_all_roles(&self, user_id: Uuid) -> StoreResult<()> {
        let result = self.inner.revoke_all_roles(user_id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&perms_key(user_id)).await;
        }
        result
    }
}

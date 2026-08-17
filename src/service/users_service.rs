//! User service — CRUD operations on user with RBAC enforcement.
//!
//! Holds its dependencies directly. Constructed once at startup and
//! stored as `Arc<UserService>` on `AppState`.

use std::sync::Arc;

use uuid::Uuid;

use crate::entity::user;
use crate::error::{AppError, AppResult};
use crate::rbac::model::consts as rbac;
use crate::rbac::RbacChecker;
use crate::store::CompositeStore;

pub struct UserService {
    store: Arc<CompositeStore>,
    rbac: Arc<RbacChecker>,
}

impl UserService {
    pub fn new(store: Arc<CompositeStore>, rbac: Arc<RbacChecker>) -> Self {
        Self { store, rbac }
    }

    /// List users with pagination. Caller must have `user:read`.
    ///
    /// Previously returned an empty `Vec` with a TODO comment — silently
    /// broken. Now actually fetches users from the store, paginated.
    pub async fn list(
        &self,
        caller_id: Uuid,
        limit: u64,
        offset: u64,
    ) -> AppResult<Vec<user::Model>> {
        self.rbac
            .require(caller_id, rbac::USERS_READ)
            .await
            .map_err(AppError::from)?;
        Ok(self.store.user_store().list_users(limit, offset).await?)
    }

    /// Get a single user by ID. Caller must have `user:read`.
    pub async fn get(&self, caller_id: Uuid, target_id: Uuid) -> AppResult<user::Model> {
        self.rbac
            .require(caller_id, rbac::USERS_READ)
            .await
            .map_err(AppError::from)?;
        Ok(self.store.user_store().get_user(target_id).await?)
    }

    /// Delete a user. Caller must have `user:delete`.
    pub async fn delete(&self, caller_id: Uuid, target_id: Uuid) -> AppResult<()> {
        self.rbac
            .require(caller_id, rbac::USERS_DELETE)
            .await
            .map_err(AppError::from)?;
        self.store.user_store().delete_user(target_id).await?;
        Ok(())
    }
}

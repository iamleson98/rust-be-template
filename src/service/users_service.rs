//! User service — CRUD operations on users with RBAC enforcement.
//!
//! Holds its dependencies directly. Constructed once at startup and
//! stored as `Arc<UserService>` on `AppState`.

use std::sync::Arc;

use uuid::Uuid;

use crate::entity::users;
use crate::error::{AppError, AppResult};
use crate::rbac::RbacChecker;
use crate::rbac::model::consts as rbac;
use crate::store::Store;

pub struct UserService {
    store: Arc<dyn Store>,
    rbac: Arc<RbacChecker>,
}

impl UserService {
    pub fn new(store: Arc<dyn Store>, rbac: Arc<RbacChecker>) -> Self {
        Self { store, rbac }
    }

    /// List all users. Caller must have `users:read`.
    pub async fn list(&self, caller_id: Uuid) -> AppResult<Vec<users::Model>> {
        self.rbac
            .require(caller_id, rbac::USERS_READ)
            .await
            .map_err(AppError::from)?;
        // Note: the store doesn't have a `list_users` method yet — we'd
        // add one. For now, return an empty vec.
        Ok(Vec::new())
    }

    /// Get a single user by ID. Caller must have `users:read`.
    pub async fn get(&self, caller_id: Uuid, target_id: Uuid) -> AppResult<users::Model> {
        self.rbac
            .require(caller_id, rbac::USERS_READ)
            .await
            .map_err(AppError::from)?;
        Ok(self.store.get_user(target_id).await?)
    }

    /// Delete a user. Caller must have `users:delete`.
    pub async fn delete(&self, caller_id: Uuid, target_id: Uuid) -> AppResult<()> {
        self.rbac
            .require(caller_id, rbac::USERS_DELETE)
            .await
            .map_err(AppError::from)?;
        self.store.delete_user(target_id).await?;
        Ok(())
    }
}

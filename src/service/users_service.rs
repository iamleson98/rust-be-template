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

    /// List all user. Caller must have `user:read`.
    pub async fn list(&self, caller_id: Uuid) -> AppResult<Vec<user::Model>> {
        self.rbac
            .require(caller_id, rbac::USERS_READ)
            .await
            .map_err(AppError::from)?;
        // Note: the store doesn't have a `list_users` method yet — we'd
        // add one. For now, return an empty vec.
        Ok(Vec::new())
    }

    /// Get a single user by ID. Caller must have `user:read`.
    pub async fn get(&self, caller_id: Uuid, target_id: Uuid) -> AppResult<user::Model> {
        self.rbac
            .require(caller_id, rbac::USERS_READ)
            .await
            .map_err(AppError::from)?;
        Ok(self.store.get_user(target_id).await?)
    }

    /// Delete a user. Caller must have `user:delete`.
    pub async fn delete(&self, caller_id: Uuid, target_id: Uuid) -> AppResult<()> {
        self.rbac
            .require(caller_id, rbac::USERS_DELETE)
            .await
            .map_err(AppError::from)?;
        self.store.delete_user(target_id).await?;
        Ok(())
    }
}

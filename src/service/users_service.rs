use std::sync::Arc;

use uuid::Uuid;

use crate::entity::user;
use crate::error::AppResult;
use crate::store::CompositeStore;

/// User service — pure business logic, no auth knowledge.
///
/// Permission checks are done at the route handler layer via
/// `require_permission(&st, &auth_user.0, rbac::USERS_READ).await?`.
pub struct UserService {
    store: Arc<CompositeStore>,
}

impl UserService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    /// List users with pagination. Permission check is at the route handler.
    pub async fn list(&self, limit: u64, offset: u64) -> AppResult<Vec<user::Model>> {
        Ok(self.store.user_store().list_users(limit, offset).await?)
    }

    /// Get a single user by ID. Permission check is at the route handler.
    pub async fn get(&self, target_id: Uuid) -> AppResult<user::Model> {
        Ok(self.store.user_store().get_user(target_id).await?)
    }

    /// Delete a user. Permission check is at the route handler.
    pub async fn delete(&self, target_id: Uuid) -> AppResult<()> {
        self.store.user_store().delete_user(target_id).await?;
        Ok(())
    }
}

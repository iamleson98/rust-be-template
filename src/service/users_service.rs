use std::collections::HashMap;
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

    /// Batch-fetch user rows by id. Returns a map keyed by `user.id`.
    /// Used by chat route handlers to populate `ChatChannelOut.user`
    /// for every channel in one round-trip (avoids N+1 queries when
    /// listing channels for the admin support queue).
    ///
    /// Skips ids that don't exist (e.g. deleted between channel
    /// creation and now — though FK CASCADE on `chat_channel.user_id`
    /// makes this unlikely in practice).
    pub async fn find_by_ids(
        &self,
        ids: &[Uuid],
    ) -> AppResult<HashMap<Uuid, user::Model>> {
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

        if ids.is_empty() {
            return Ok(HashMap::new());
        }

        let users = user::Entity::find()
            .filter(user::Column::Id.is_in(ids.to_vec()))
            .all(self.store.db())
            .await
            .map_err(|e| crate::error::AppError::Internal(e.to_string()))?;

        Ok(users.into_iter().map(|u| (u.id, u)).collect())
    }

    /// Delete a user. Permission check is at the route handler.
    pub async fn delete(&self, target_id: Uuid) -> AppResult<()> {
        self.store.user_store().delete_user(target_id).await?;
        Ok(())
    }
}

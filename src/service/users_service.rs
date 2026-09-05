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

    /// List users + the unfiltered total (server-side pagination for
    /// the admin Users table).
    pub async fn list_page(&self, limit: u64, offset: u64) -> AppResult<(Vec<user::Model>, i64)> {
        let users = self.store.user_store().list_users(limit, offset).await?;
        let total = self.store.user_store().count_users().await?;
        Ok((users, total as i64))
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
    pub async fn find_by_ids(&self, ids: &[Uuid]) -> AppResult<HashMap<Uuid, user::Model>> {
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

    /// Change a user's role (`"user"` | `"employee"` | `"admin"`).
    ///
    /// Business guards (three-role spec):
    ///   - Bot accounts can't change roles (the NullClaw bot stays a
    ///     `user` forever — presence/assignment must never see it as
    ///     staff).
    ///   - The LAST human admin cannot be demoted (lockout protection).
    ///
    /// Updates BOTH the `user.role` column and the RBAC grant table
    /// (revoke-all + re-grant), so permission checks flip immediately.
    /// The route layer enforces `admin:users:manage-roles` BEFORE this.
    pub async fn set_role(&self, target_id: Uuid, role: &str) -> AppResult<user::Model> {
        use crate::error::AppError;

        if !matches!(role, "user" | "employee" | "admin") {
            return Err(AppError::Validation(format!(
                "invalid role '{role}' — must be user, employee or admin"
            )));
        }

        let target = self.store.user_store().get_user(target_id).await?;
        if target.is_bot {
            return Err(AppError::Validation(
                "bot accounts cannot change roles".into(),
            ));
        }

        // Last-admin lockout guard: demoting an admin is only allowed
        // when another human admin would remain.
        if target.role == "admin" && role != "admin" {
            let admin_count = self.store.user_store().count_by_role("admin").await?;
            if admin_count <= 1 {
                return Err(AppError::Conflict(
                    "cannot demote the last admin — promote another admin first".into(),
                ));
            }
        }

        // 1. Update the denormalised `user.role` column (fast routing
        //    for the hubs / SessionUser without an RBAC join).
        let updated = self
            .store
            .user_store()
            .set_user_role(target_id, role)
            .await?;

        // 2. Rewrite the RBAC grant: revoke every existing grant, then
        //    insert the new role's grant (idempotent single-role model).
        let roles = self.store.rbac_store().list_roles().await?;
        self.store.rbac_store().revoke_all_roles(target_id).await?;
        if let Some(role_row) = roles.iter().find(|r| r.name == role) {
            self.store
                .rbac_store()
                .assign_role(target_id, role_row.id)
                .await?;
        }

        // 3. Staff leaving their role: drop their live presence so
        //    routing stops considering them immediately.
        if (target.role == "employee" || target.role == "admin") && role == "user" {
            crate::presence::presence().remove(&target_id.to_string());
        }

        Ok(updated)
    }
}

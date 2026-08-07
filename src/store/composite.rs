use std::sync::Arc;

use async_trait::async_trait;
use uuid::Uuid;

use crate::entity::{permission, post, refresh_token, role, user};

use super::error::StoreResult;
use super::{PostStore, RbacStore, RefreshTokenStore, UserPermissions, UserStore};

#[derive(Clone)]
pub struct CompositeStore {
    users: Arc<dyn UserStore>,
    posts: Arc<dyn PostStore>,
    rbac: Arc<dyn RbacStore>,
    refresh_tokens: Arc<dyn RefreshTokenStore>,
}

impl CompositeStore {
    pub fn new(
        users: Arc<dyn UserStore>,
        posts: Arc<dyn PostStore>,
        rbac: Arc<dyn RbacStore>,
        refresh_tokens: Arc<dyn RefreshTokenStore>,
    ) -> Self {
        Self {
            users,
            posts,
            rbac,
            refresh_tokens,
        }
    }
}

#[async_trait]
impl UserStore for CompositeStore {
    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model> {
        self.users.get_user(id).await
    }

    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>> {
        self.users.get_user_by_email(email).await
    }

    async fn create_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
    ) -> StoreResult<user::Model> {
        self.users.create_user(email, username, password_hash).await
    }

    async fn delete_user(&self, id: Uuid) -> StoreResult<()> {
        self.users.delete_user(id).await
    }
}

#[async_trait]
impl PostStore for CompositeStore {
    async fn get_post(&self, id: Uuid) -> StoreResult<post::Model> {
        self.posts.get_post(id).await
    }

    async fn list_posts(&self, limit: u64, offset: u64) -> StoreResult<Vec<post::Model>> {
        self.posts.list_posts(limit, offset).await
    }

    async fn create_post(
        &self,
        author_id: Uuid,
        title: String,
        body: String,
    ) -> StoreResult<post::Model> {
        self.posts.create_post(author_id, title, body).await
    }

    async fn update_post(
        &self,
        id: Uuid,
        title: Option<String>,
        body: Option<String>,
    ) -> StoreResult<post::Model> {
        self.posts.update_post(id, title, body).await
    }

    async fn delete_post(&self, id: Uuid) -> StoreResult<()> {
        self.posts.delete_post(id).await
    }
}

#[async_trait]
impl RbacStore for CompositeStore {
    async fn get_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions> {
        self.rbac.get_user_permissions(user_id).await
    }

    async fn assign_role(&self, user_id: Uuid, role_id: Uuid) -> StoreResult<()> {
        self.rbac.assign_role(user_id, role_id).await
    }

    async fn list_roles(&self) -> StoreResult<Vec<role::Model>> {
        self.rbac.list_roles().await
    }

    async fn list_permissions(&self) -> StoreResult<Vec<permission::Model>> {
        self.rbac.list_permissions().await
    }
}

#[async_trait]
impl RefreshTokenStore for CompositeStore {
    async fn save_refresh_token(&self, token: refresh_token::Model) -> StoreResult<()> {
        self.refresh_tokens.save_refresh_token(token).await
    }

    async fn get_refresh_token(&self, id: Uuid) -> StoreResult<Option<refresh_token::Model>> {
        self.refresh_tokens.get_refresh_token(id).await
    }

    async fn revoke_refresh_token(&self, id: Uuid) -> StoreResult<()> {
        self.refresh_tokens.revoke_refresh_token(id).await
    }

    async fn revoke_all_refresh_tokens_for_user(&self, user_id: Uuid) -> StoreResult<()> {
        self.refresh_tokens
            .revoke_all_refresh_tokens_for_user(user_id)
            .await
    }
}

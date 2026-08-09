use std::sync::Arc;

use super::{PostStore, RbacStore, RefreshTokenStore, UserStore};

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

    pub fn user_store(&self) -> Arc<dyn UserStore> {
        self.users.clone()
    }

    pub fn post_store(&self) -> Arc<dyn PostStore> {
        self.posts.clone()
    }

    pub fn rbac_store(&self) -> Arc<dyn RbacStore> {
        self.rbac.clone()
    }

    pub fn refresh_token_store(&self) -> Arc<dyn RefreshTokenStore> {
        self.refresh_tokens.clone()
    }
}

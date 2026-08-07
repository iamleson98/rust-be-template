use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: uuid::Uuid,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permission {
    pub id: uuid::Uuid,
    pub name: String,
    pub description: Option<String>,
}

/// Standard permission names used by the routes. The seed migration
/// inserts exactly these.
pub mod consts {
    pub const USERS_READ: &str = "users:read";
    pub const USERS_WRITE: &str = "users:write";
    pub const USERS_DELETE: &str = "users:delete";
    pub const POSTS_READ: &str = "posts:read";
    pub const POSTS_WRITE: &str = "posts:write";
    pub const POSTS_DELETE: &str = "posts:delete";
}

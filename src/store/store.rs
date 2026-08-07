//! Store traits split by entity plus an aggregate `Store` trait.
//!
//! Services continue to depend on `Arc<dyn Store>`, while storage
//! implementations are separated per domain (`UserStore`, `PostStore`,
//! `RbacStore`, `RefreshTokenStore`).

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
 
use super::{PostStore, RbacStore, RefreshTokenStore, UserStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPermissions {
    pub user_id: uuid::Uuid,
    pub permission_names: Vec<String>,
    pub role_names: Vec<String>,
    pub fetched_at: NaiveDateTime,
}

pub trait Store:
    UserStore + PostStore + RbacStore + RefreshTokenStore + Send + Sync
{
}

impl<T> Store for T where
    T: UserStore + PostStore + RbacStore + RefreshTokenStore + Send + Sync
{
}

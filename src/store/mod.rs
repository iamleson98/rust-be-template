//! Store module split by entity.
//!
//! - Per-entity traits: `UserStore`, `PostStore`, `RbacStore`,
//!   `RefreshTokenStore`.
//! - Per-entity DB implementations: each one owns its SeaORM logic and
//!   uses `#[retry]` on that entity's operations.
//! - Per-entity cache wrappers: each one controls cache keys/invalidations
//!   for its own domain.
//! - `CompositeStore`: combines per-entity stores into one object used by
//!   services as `Arc<dyn Store>`.

pub use self::error::{StoreError, StoreResult};
pub use self::retry::RetryPolicy;
pub use self::store::{Store, UserPermissions};
pub use self::users::{CacheUserStore, DbUserStore, UserStore};
pub use self::posts::{CachePostStore, DbPostStore, PostStore};
pub use self::rbac::{CacheRbacStore, DbRbacStore, RbacStore};
pub use self::refresh_tokens::{
	CacheRefreshTokenStore,
	DbRefreshTokenStore,
	RefreshTokenStore,
};
pub use self::composite::CompositeStore;

#[macro_use]
mod macros;
mod error;
mod retry;
mod store;
mod users;
mod posts;
mod rbac;
mod refresh_tokens;
mod composite;

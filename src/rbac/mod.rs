//! Role-based access control with extensive caching.
//!
//! - `RbacChecker` is the public API: `check(user_id, "posts:write")`.
//! - Permissions are loaded via the `Store` layer (which already caches
//!   them in the configured cache backend).
//! - For high-traffic endpoints, the checker adds a tiny in-process memo
//!   on top — every check is O(1) hash lookup once permissions are loaded.

pub use self::checker::RbacChecker;
pub use self::model::{Permission, Role};

pub mod checker;
pub mod model;

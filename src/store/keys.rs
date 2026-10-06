//! Shared cache-key builders for cross-store cache entries.
//!
//! Most cache entries are written AND invalidated by the same store
//! decorator, so their key format lives in that store's file. A few,
//! however, are written by one decorator and evicted by another:
//!
//! - `rbac:perms:{id}` is cached by `CacheRbacStore` (on
//!   `get_user_permissions`) but ALSO evicted by `CacheUserStore` on
//!   `delete_user` / `set_user_role` / `upsert_oauth_user` — a deleted
//!   or role-changed user must never keep serving its old permission
//!   bundle.
//!
//! A drift between the two inline definitions ("the same format"
//! maintained by hand in two files) would silently break that eviction.
//! One canonical definition here makes the coupling explicit and
//! compile-checked.

/// Cache key for a user's RBAC permission bundle.
pub(crate) fn perms_key(id: uuid::Uuid) -> String {
    format!("rbac:perms:{id}")
}

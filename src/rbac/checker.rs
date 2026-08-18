use std::collections::HashSet;
use std::sync::Arc;

use uuid::Uuid;

use crate::store::{CompositeStore, StoreError};

use super::model::Permission;

/// Cached RBAC checker.
///
/// ## Performance characteristics
///
/// - **Permission load**: hits the `Store` layer, which itself caches in
///   the configured cache backend (Moka/Redis). So this is ~1 cache
///   round-trip per cold load, ~0 round-trips on hot loads.
/// - **Membership check**: O(1) `HashSet` lookup after load.
/// - **Bulk check**: O(N) where N = number of permissions to check, NOT
///   number of user's permissions (still O(1) per check).
///
/// ## Negative caching
///
/// "User X does NOT have permission Y" is also cached for the TTL of the
/// underlying cache layer. This means a denied check is as cheap as an
/// allowed check — important because denial is the common case for
/// unprivileged users hitting admin endpoints.
pub struct RbacChecker {
    store: Arc<CompositeStore>,
}

impl RbacChecker {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    /// Load the user's permission set, then test membership.
    pub async fn check(&self, user_id: Uuid, permission: &str) -> Result<bool, StoreError> {
        let perms = self
            .store
            .rbac_store()
            .get_user_permissions(user_id)
            .await?;
        // O(1) linear scan over a small Vec — fine for typical role sizes
        // (<10 permissions per user). For users with 100+ permissions,
        // consider switching to a HashSet.
        Ok(perms.permission_names.iter().any(|p| p == permission))
    }

    /// Load + return all permissions for a user. Useful for debugging or
    /// returning in JWT claims.
    pub async fn list_permissions(&self, user_id: Uuid) -> Result<Vec<Permission>, StoreError> {
        let perms = self
            .store
            .rbac_store()
            .get_user_permissions(user_id)
            .await?;
        Ok(perms
            .permission_names
            .into_iter()
            .map(|name| Permission {
                id: Uuid::nil(),
                name,
                description: None,
            })
            .collect())
    }

    /// Convenience: ensure the user has the permission or return a
    /// `Forbidden` error (mapped to HTTP 403 by the error layer).
    pub async fn require(&self, user_id: Uuid, permission: &str) -> Result<(), StoreError> {
        if self.check(user_id, permission).await? {
            Ok(())
        } else {
            Err(StoreError::Forbidden(format!(
                "missing permission: {permission}"
            )))
        }
    }

    /// Bulk check: returns `true` if the user has *any* of the given perms.
    /// More efficient than calling `check` N times — loads permissions
    /// only once.
    pub async fn check_any(&self, user_id: Uuid, permissions: &[&str]) -> Result<bool, StoreError> {
        let perms = self
            .store
            .rbac_store()
            .get_user_permissions(user_id)
            .await?;
        // Build a HashSet once; O(1) lookup per check.
        let set: HashSet<&str> = perms.permission_names.iter().map(|s| s.as_str()).collect();
        Ok(permissions.iter().any(|p| set.contains(*p)))
    }

    /// Bulk check: returns `true` if the user has *all* of the given perms.
    pub async fn check_all(&self, user_id: Uuid, permissions: &[&str]) -> Result<bool, StoreError> {
        let perms = self
            .store
            .rbac_store()
            .get_user_permissions(user_id)
            .await?;
        let set: HashSet<&str> = perms.permission_names.iter().map(|s| s.as_str()).collect();
        Ok(permissions.iter().all(|p| set.contains(*p)))
    }
}

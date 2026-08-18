//! HTTP middleware: rate limiting, auth extractors, request-id, timeout.
//!
//! ## Auth architecture
//!
//! **Authentication** (who are you?) → extractor layer:
//!   - `AuthUser` → required auth (401 if missing/invalid token)
//!   - `AdminUser` → required auth + employee check (401 + 403)
//!   - `MaybeAuthUser` → optional auth (never rejects)
//!
//! **Authorization** (what can you do?) → route handler layer:
//!   - Call `require_permission(&st, user_id, PERMISSION).await?` at the
//!     top of the handler. `user_id` comes from the extractor (`AuthUser(uid)`
//!     or `AdminUser(session)` — use `admin.0.id` or `admin.user_id()`).
//!   - Uses `st.rbac` (the `Arc<RbacChecker>` on `AppState`).
//!   - Returns `403 Forbidden` if the user lacks the permission.
//!
//! Example:
//! ```ignore
//! pub async fn create_brand(
//!     State(st): State<AppState>,
//!     admin: AdminUser,
//!     Json(body): Json<UpsertBrandRequest>,
//! ) -> AppResult<Json<AdminMutationResponse>> {
//!     require_permission(&st, admin.user_id(), rbac::ADMIN_BRANDS_WRITE).await?;
//!     Ok(Json(st.admin.create_brand(&body).await?))
//! }
//! ```

pub use self::auth_extractor::{AdminUser, AuthUser, MaybeAuthUser};
pub use self::request_id::RequestId;
pub use self::timeout::request_timeout;

pub mod auth_extractor;
pub mod request_id;
pub mod timeout;

use crate::error::AppResult;
use crate::state::AppState;
use uuid::Uuid;

/// Permission guard for route handlers.
///
/// Call at the top of a handler to enforce an RBAC permission.
/// Uses the `RbacChecker` on `AppState`.
/// Returns `403 Forbidden` if the user lacks the permission.
///
/// ```ignore
/// pub async fn delete_brand(
///     State(st): State<AppState>,
///     admin: AdminUser,
///     Path(id): Path<Uuid>,
/// ) -> AppResult<Json<AdminMutationResponse>> {
///     require_permission(&st, admin.user_id(), rbac::ADMIN_BRANDS_WRITE).await?;
///     Ok(Json(st.admin.delete_brand(id).await?))
/// }
/// ```
pub async fn require_permission(
    st: &AppState,
    user_id: Uuid,
    permission: &str,
) -> AppResult<()> {
    st.rbac
        .require(user_id, permission)
        .await
        .map_err(crate::error::AppError::from)?;
    Ok(())
}

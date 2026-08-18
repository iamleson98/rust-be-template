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
//!   - Call `require_permission(&st, &admin, PERMISSION).await?` at the
//!     top of the handler.
//!   - This makes the guard **visible at the route definition** — you
//!     can see at a glance what permission each endpoint requires.
//!   - The service layer stays pure (no auth knowledge) and remains
//!     callable from CLI/worker/test contexts without RBAC checks.
//!
//! Example:
//! ```ignore
//! pub async fn create_brand(
//!     State(st): State<AppState>,
//!     admin: AdminUser,
//!     Json(body): Json<UpsertBrandRequest>,
//! ) -> AppResult<Json<AdminMutationResponse>> {
//!     require_permission(&st, &admin, rbac::ADMIN_BRANDS_WRITE).await?;
//!     Ok(Json(st.admin.create_brand(&body).await?))
//! }
//! ```

pub use self::auth_extractor::{AdminUser, AuthUser, MaybeAuthUser};
pub use self::request_id::RequestId;
pub use self::timeout::request_timeout;

pub mod auth_extractor;
pub mod request_id;
pub mod timeout;

use crate::auth::SessionUser;
use crate::error::AppResult;
use crate::state::AppState;
use uuid::Uuid;

/// Permission guard for route handlers.
///
/// Call this at the top of a handler to enforce a specific RBAC permission.
/// Returns `403 Forbidden` (not 400) if the user lacks the permission.
/// Uses the `RbacChecker` stored on `AppState` — no per-call construction.
///
/// ```ignore
/// pub async fn delete_brand(
///     State(st): State<AppState>,
///     admin: AdminUser,
///     Path(id): Path<Uuid>,
/// ) -> AppResult<Json<AdminMutationResponse>> {
///     require_permission(&st, &admin, rbac::ADMIN_BRANDS_WRITE).await?;
///     Ok(Json(st.admin.delete_brand(id).await?))
/// }
/// ```
pub async fn require_permission(
    st: &AppState,
    user: &SessionUser,
    permission: &str,
) -> AppResult<()> {
    let user_id = Uuid::parse_str(&user.id).unwrap_or_default();
    st.rbac.require(user_id, permission)
        .await
        .map_err(crate::error::AppError::from)?;
    Ok(())
}

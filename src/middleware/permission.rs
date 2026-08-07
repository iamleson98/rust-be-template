use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use std::sync::Arc;
use uuid::Uuid;

use crate::error::AppError;
use crate::rbac::RbacChecker;
use crate::state::AppState;

/// Returns a middleware closure that requires the user to have the given
/// permission. Expects `AuthUser` to have already run (it does — the route
/// sets `route.layer(middleware::from_fn_with_state(..., require_auth))`
/// ahead of this).
pub fn require_permission(
    state: AppState,
    permission: &'static str,
) -> impl Fn(Request, Next) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Response, StatusCode>> + Send>> + Clone + Send + Sync + 'static {
    let checker = Arc::new(RbacChecker::new(state.store.clone()));
    let permission = permission.to_string();
    move |req: Request, next: Next| {
        let checker = checker.clone();
        let permission = permission.clone();
        Box::pin(async move {
            let user_id = req
                .extensions()
                .get::<AuthUserIdExt>()
                .map(|e| e.0)
                .ok_or(StatusCode::UNAUTHORIZED)?;
            let has = checker
                .check(user_id, &permission)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            if has {
                Ok(next.run(req).await)
            } else {
                Err(StatusCode::FORBIDDEN)
            }
        })
    }
}

/// Internal extension set by `AuthUser` so permission middleware can read
/// the authenticated user id without re-parsing the token.
#[derive(Clone, Copy)]
pub struct AuthUserIdExt(pub Uuid);

impl From<crate::middleware::AuthUser> for AuthUserIdExt {
    fn from(u: crate::middleware::AuthUser) -> Self {
        Self(u.0)
    }
}

#[allow(dead_code)]
fn _import(_a: &RbacChecker, _b: &AppError, _c: &AppState) {}

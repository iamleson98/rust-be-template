//! CSRF middleware — enforces double-submit cookie pattern on mutating routes.
//!
//! Applied to the `/api/*` sub-router via `from_fn_with_state`. Safe
//! methods (GET/HEAD/OPTIONS) are exempt. The auth endpoints that
//! establish the session (login/register/refresh) are also exempt —
//! they can't have a CSRF token yet because they're setting it.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;

use crate::auth::csrf::{CsrfError, CsrfManager};
use crate::error::AppError;

/// CSRF check middleware. Wire via:
///
/// ```ignore
/// .layer(axum::middleware::from_fn_with_state(
///     csrf_manager,
///     crate::middleware::csrf::csrf_check,
/// ))
/// ```
pub async fn csrf_check(
    State(csrf): State<Arc<CsrfManager>>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let method = req.method().clone();
    // Safe methods skip CSRF.
    if matches!(
        method,
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) {
        return Ok(next.run(req).await);
    }

    // Skip CSRF on auth endpoints that ESTABLISH the session.
    // Note: the path is relative to where this middleware is mounted
    // (under `/api`), so it's `/auth/login` not `/api/auth/login`.
    let path = req.uri().path().to_string();
    if matches!(
        path.as_str(),
        "/auth/login" | "/auth/employee-login" | "/auth/register" | "/auth/refresh"
    ) {
        return Ok(next.run(req).await);
    }

    let jar = axum_extra::extract::CookieJar::from_headers(req.headers());
    let header = req
        .headers()
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    csrf.check_request(&jar, header.as_deref())
        .map_err(|e| {
            tracing::warn!(error = %e, path = %path, "csrf check failed");
            match e {
                CsrfError::MissingCookie | CsrfError::MissingHeader => {
                    AppError::BadRequest("missing csrf token".into())
                }
                _ => AppError::Forbidden(format!("csrf: {e}")),
            }
        })?;

    Ok(next.run(req).await)
}

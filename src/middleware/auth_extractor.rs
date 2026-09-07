//! Auth extractors.
//!
//! `AuthUser` is **generic over `S`** via `FromRef` bounds, not hardcoded
//! to `AppState`. This means:
//!
//! - In production, `S = AppState` and the extractor pulls `JwtValidator`
//!   from the real state.
//! - In tests, you can construct a tiny `TestState` that only holds a
//!   `JwtValidator` (with mock keys) and the extractor will work the same.
//!
//! This is the pattern recommended by the axum docs for library-author
//! extractors that need to be testable.

use std::sync::Arc;

use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use axum_extra::extract::CookieJar;
use uuid::Uuid;

use crate::auth::cookies::extract_tokens;
use crate::error::AppError;
use crate::service::AuthService;

/// Resolve the access token for a request.
///
/// Order:
///   1. `Authorization: Bearer <jwt>` header — mobile app / programmatic
///      clients that hold raw tokens (no cookie jar).
///   2. `access_token` cookie — the browser flow (httpOnly, set at login).
///
/// The Bearer path exists because the mobile support client persists
/// tokens in secure storage and attaches them as headers; browsers keep
/// using cookies and never send `Authorization`.
fn bearer_or_cookie_token(parts: &Parts, jar: &CookieJar) -> Option<String> {
    if let Some(value) = parts.headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(s) = value.to_str() {
            let s = s.trim();
            let token = s
                .strip_prefix("Bearer ")
                .or_else(|| s.strip_prefix("bearer "))
                .map(str::trim)
                .filter(|t| !t.is_empty());
            if let Some(token) = token {
                return Some(token.to_string());
            }
        }
    }
    let (access, _) = extract_tokens(jar);
    access
}

/// Authenticated user extractor.
///
/// Generic over `S` so it works with any state that can supply
/// `Arc<JwtValidator>` via `FromRef`. In production that's `AppState`;
/// in tests it can be a tiny mock state.
pub struct AuthUser(pub Uuid);

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    Arc<AuthService>: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let auth = Arc::<AuthService>::from_ref(state);

        // The cookie jar is extracted from the same `parts` — axum-extra's
        // `CookieJar::from_request_parts` is infallible.
        let jar = axum_extra::extract::CookieJar::from_request_parts(parts, state)
            .await
            .expect("cookie jar extractor never fails");
        let token = bearer_or_cookie_token(parts, &jar)
            .ok_or_else(|| AppError::Unauthorized("missing access token".into()))?;

        // Full JWT verify (HMAC-SHA256) + revocation checks.
        // Don't echo jsonwebtoken internals to the client — log server-side.
        let user_id = auth.verify_access_token(&token).await.map_err(|e| {
            tracing::debug!(error = ?e, "access token verify failed");
            AppError::Unauthorized("invalid or expired token".into())
        })?;
        Ok(AuthUser(user_id))
    }
}

/// Optional auth: returns `None` if no token / invalid, instead of 401.
pub struct MaybeAuthUser(pub Option<Uuid>);

impl<S> FromRequestParts<S> for MaybeAuthUser
where
    S: Send + Sync,
    Arc<AuthService>: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let auth = Arc::<AuthService>::from_ref(state);
        let jar = axum_extra::extract::CookieJar::from_request_parts(parts, state)
            .await
            .expect("cookie jar extractor never fails");
        let access = bearer_or_cookie_token(parts, &jar);
        match access {
            None => Ok(MaybeAuthUser(None)),
            Some(tok) => match auth.verify_access_token(&tok).await {
                Ok(user_id) => Ok(MaybeAuthUser(Some(user_id))),
                Err(e) => {
                    tracing::debug!(error = ?e, "MaybeAuthUser: token present but invalid, treating as anon");
                    Ok(MaybeAuthUser(None))
                }
            },
        }
    }
}

/// Staff-only extractor (employee OR admin).
///
/// Like `AuthUser`, but additionally loads the full [`SessionUser`] and
/// verifies the caller is STAFF — role `employee` OR `admin` (see
/// [`SessionUser::is_staff`]). Admins are full support/ops users too:
/// they manage brands, routes, schedules, bookings and monitor every
/// support queue. Returns:
/// - `401 Unauthorized` when no token / invalid token.
/// - `403 Forbidden` when the caller is authenticated but not staff
///   (i.e. a plain `user`).
///
/// Fine-grained authorization still happens per-route via
/// `st.rbac.require(...)` — this extractor is only the coarse
/// "is this an operational account" gate.
///
/// The wrapped `SessionUser` is the full identity (id, name, role,
/// brand_id, ...) — useful for handlers that need to scope writes by
/// the employee's brand.
pub struct AdminUser(pub crate::auth::SessionUser);

impl AdminUser {
    /// Convenience: returns the user's `Uuid` for RBAC checks.
    /// `require_permission(&st, admin.user_id(), rbac::ADMIN_BRANDS_WRITE).await?`
    pub fn user_id(&self) -> Uuid {
        self.0.id
    }
}

impl<S> FromRequestParts<S> for AdminUser
where
    S: Send + Sync,
    Arc<AuthService>: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let auth = Arc::<AuthService>::from_ref(state);
        let jar = axum_extra::extract::CookieJar::from_request_parts(parts, state)
            .await
            .expect("cookie jar extractor never fails");
        let token = bearer_or_cookie_token(parts, &jar)
            .ok_or_else(|| AppError::Unauthorized("missing access token".into()))?;
        let session = auth
            .verify_access_token_session(&token)
            .await
            .map_err(|e| {
                tracing::debug!(error = ?e, "admin token verify failed");
                AppError::Unauthorized("invalid or expired token".into())
            })?;
        if !session.is_staff() {
            return Err(AppError::Forbidden("staff access required".into()));
        }
        Ok(AdminUser(session))
    }
}

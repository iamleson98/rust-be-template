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
use uuid::Uuid;

use crate::auth::cookies::extract_tokens;
use crate::error::AppError;
use crate::service::AuthService;

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
        let (access, _refresh) = extract_tokens(&jar);
        let token = access.ok_or_else(|| AppError::Unauthorized("missing access token".into()))?;

        // Full JWT verify (HMAC-SHA256) + revocation checks.
        // Don't echo jsonwebtoken internals to the client — log server-side.
        let user_id = auth
            .verify_access_token(&token)
            .await
            .map_err(|e| {
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
        let (access, _) = extract_tokens(&jar);
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

/// Admin-only extractor.
///
/// Like `AuthUser`, but additionally loads the full [`SessionUser`] and
/// verifies the caller has an employee (non-`"user"`) role. Returns:
/// - `401 Unauthorized` when no token / invalid token.
/// - `403 Forbidden` when the caller is authenticated but not an employee.
///
/// The wrapped `SessionUser` is the full identity (id, name, role,
/// brand_id, ...) — useful for handlers that need to scope writes by
/// the employee's brand.
pub struct AdminUser(pub crate::auth::SessionUser);

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
        let (access, _refresh) = extract_tokens(&jar);
        let token = access.ok_or_else(|| AppError::Unauthorized("missing access token".into()))?;
        let session = auth
            .verify_access_token_session(&token)
            .await
            .map_err(|e| AppError::Unauthorized(format!("invalid token: {e}")))?;
        if !session.is_employee() {
            return Err(AppError::Forbidden("admin access required".into()));
        }
        Ok(AdminUser(session))
    }
}

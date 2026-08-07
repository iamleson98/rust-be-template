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

use crate::auth::csrf::extract_tokens;
use crate::auth::jwt_validator::JwtValidator;
use crate::error::AppError;

/// Authenticated user extractor.
///
/// Generic over `S` so it works with any state that can supply
/// `Arc<JwtValidator>` via `FromRef`. In production that's `AppState`;
/// in tests it can be a tiny mock state.
pub struct AuthUser(pub Uuid);

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    Arc<JwtValidator>: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let validator = Arc::<JwtValidator>::from_ref(state);

        // The cookie jar is extracted from the same `parts` — axum-extra's
        // `CookieJar::from_request_parts` is infallible.
        let jar = axum_extra::extract::CookieJar::from_request_parts(parts, state)
            .await
            .expect("cookie jar extractor never fails");
        let (access, _refresh) = extract_tokens(&jar);
        let token = access.ok_or_else(|| AppError::Unauthorized("missing access token".into()))?;

        // Full JWT verify (HMAC-SHA256) + revocation checks.
        let claims = validator
            .verify(&token)
            .await
            .map_err(|e| AppError::Unauthorized(format!("invalid token: {e}")))?;
        Ok(AuthUser(claims.sub))
    }
}

/// Optional auth: returns `None` if no token / invalid, instead of 401.
pub struct MaybeAuthUser(pub Option<Uuid>);

impl<S> FromRequestParts<S> for MaybeAuthUser
where
    S: Send + Sync,
    Arc<JwtValidator>: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let validator = Arc::<JwtValidator>::from_ref(state);
        let jar = axum_extra::extract::CookieJar::from_request_parts(parts, state)
            .await
            .expect("cookie jar extractor never fails");
        let (access, _) = extract_tokens(&jar);
        match access {
            None => Ok(MaybeAuthUser(None)),
            Some(tok) => match validator.verify(&tok).await {
                Ok(c) => Ok(MaybeAuthUser(Some(c.sub))),
                Err(_) => Ok(MaybeAuthUser(None)),
            },
        }
    }
}

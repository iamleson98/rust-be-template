//! OAuth 2.0 social-auth routes — start + callback handlers for
//! Facebook / Google / X (Twitter).
//!
//! ## Routes
//!
//!   * `GET /api/auth/oauth/:provider/start`
//!     - Generates a CSRF state token, stores it in a short-lived
//!       signed cookie (`oauth_state_<provider>`), and 302-redirects
//!       the user to the provider's authorization URL.
//!
//!   * `GET /api/auth/oauth/:provider/callback?code=...&state=...`
//!     - Verifies the state cookie matches the `state` query param.
//!     - Exchanges the code for an access token.
//!     - Fetches the user profile.
//!     - Calls `AuthService::upsert_oauth_user` to create/link the
//!       local user record.
//!     - Issues a session (access + refresh cookies).
//!     - 302-redirects to the frontend (config `oauth.frontend_url`).
//!
//! ## Errors
//!
//! All errors redirect to the frontend's login page with a `?oauth_error=...`
//! query string so the user sees a friendly error message instead of a
//! raw JSON blob.
//!
//! ## Cookie design
//!
//! The `oauth_state_<provider>` cookie is:
//!   * HttpOnly (JS can't read it).
//!   * SameSite=Lax (allowed on cross-site redirects).
//!   * Secure in production (when `COOKIE__SECURE=true`).
//!   * Short-lived (10 minutes).
//!
//! For Twitter specifically, the cookie also carries the PKCE
//! `code_verifier` (since Twitter requires PKCE). The cookie value is
//! `{state}|{code_verifier}`.

use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum_extra::extract::CookieJar;
use serde::Deserialize;
use time::Duration as SignedDuration;
use tracing::Instrument;

use crate::auth::oauth::{self, OAuthProvider};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Cookie TTL for the OAuth state — 10 minutes.
const STATE_COOKIE_TTL_SECS: u64 = 600;

/// Cookie name pattern — `<provider>` is interpolated.
fn state_cookie_name(provider: &str) -> String {
    format!("oauth_state_{provider}")
}

/// Query params for the OAuth callback URL.
#[derive(Debug, Deserialize)]
pub struct CallbackQuery {
    /// Authorization code from the provider.
    pub code: Option<String>,
    /// CSRF state token — must match the cookie.
    pub state: Option<String>,
    /// Provider-side error (e.g. `access_denied`).
    pub error: Option<String>,
    /// Human-readable error description.
    pub error_description: Option<String>,
}

/// `GET /api/auth/oauth/:provider/start`
///
/// Generates a CSRF state, stores it in a cookie, and 302-redirects
/// the user to the OAuth provider's authorization URL.
pub async fn oauth_start(
    State(st): State<AppState>,
    Path(provider): Path<String>,
    jar: CookieJar,
) -> AppResult<Response> {
    let cfg = oauth_provider_config(&st, &provider)
        .ok_or_else(|| AppError::NotFound(format!("oauth provider '{provider}' not configured")))?;

    let provider_cfg = build_provider(&provider, cfg)
        .ok_or_else(|| AppError::NotFound(format!("oauth provider '{provider}' not configured")))?;

    let state = oauth::generate_state();
    // Twitter needs PKCE — generate a code_verifier and bundle it
    // with the state.
    let state_value = if provider == "twitter" {
        let verifier = oauth::twitter::TwitterProvider::generate_code_verifier();
        format!("{state}|{verifier}")
    } else {
        state.clone()
    };

    let redirect_base = st.config.oauth.redirect_base_url.clone();
    if redirect_base.is_empty() {
        return Err(AppError::Internal(
            "OAUTH__REDIRECT_BASE_URL is not set".into(),
        ));
    }
    let cb_url = oauth::callback_url(&redirect_base, &provider);
    let auth_url = provider_cfg.authorization_url(&state_value, &cb_url);

    // Build the cookie. We use a raw cookie + axum_extra's CookieJar
    // builder so we can set SameSite=Lax + a short Max-Age.
    let cookie_name = state_cookie_name(&provider);
    let mut cookie = axum_extra::extract::cookie::Cookie::build((
        cookie_name.clone(),
        state_value.clone(),
    ))
    .path("/")
    .http_only(true)
    .max_age(SignedDuration::seconds(STATE_COOKIE_TTL_SECS as i64))
    .same_site(axum_extra::extract::cookie::SameSite::Lax);

    // Mirror the global cookie secure flag.
    if st.config.cookie.secure {
        cookie = cookie.secure(true);
    }
    let jar = jar.add(cookie);

    Ok((jar, Redirect::temporary(&auth_url)).into_response())
}

/// `GET /api/auth/oauth/:provider/callback`
///
/// Verifies the state cookie, exchanges the code for an access token,
/// fetches the user profile, and issues a session.
pub async fn oauth_callback(
    State(st): State<AppState>,
    Path(provider): Path<String>,
    Query(q): Query<CallbackQuery>,
    jar: CookieJar,
) -> AppResult<Response> {
    let frontend_url = st.config.oauth.frontend_url.clone();
    let error_redirect_base = if frontend_url.is_empty() {
        "/login".to_string()
    } else {
        format!("{}/login", frontend_url.trim_end_matches('/'))
    };

    // 1. Surface provider-side errors (e.g. user clicked "Deny").
    if let Some(err) = &q.error {
        let msg = q.error_description.as_deref().unwrap_or(err);
        return Ok(Redirect::temporary(&format!(
            "{error_redirect_base}?oauth_error={}",
            urlencoding::encode(msg)
        ))
        .into_response());
    }

    // 2. Validate we have code + state.
    let code = match &q.code {
        Some(c) if !c.is_empty() => c.clone(),
        _ => {
            return Ok(Redirect::temporary(&format!(
                "{error_redirect_base}?oauth_error={}",
                urlencoding::encode("Thiếu mã xác thực OAuth")
            ))
            .into_response());
        }
    };
    let state_param = match &q.state {
        Some(s) if !s.is_empty() => s.clone(),
        _ => {
            return Ok(Redirect::temporary(&format!(
                "{error_redirect_base}?oauth_error={}",
                urlencoding::encode("Thiếu state token OAuth")
            ))
            .into_response());
        }
    };

    // 3. Look up the cookie. We need to read it by name.
    let cookie_name = state_cookie_name(&provider);
    let cookie_value = jar.get(&cookie_name).map(|c| c.value().to_string());
    let cookie_value = match cookie_value {
        Some(v) => v,
        None => {
            return Ok(Redirect::temporary(&format!(
                "{error_redirect_base}?oauth_error={}",
                urlencoding::encode("Phiên OAuth hết hạn — vui lòng thử lại")
            ))
            .into_response());
        }
    };

    // 4. Verify state — extract the original state from cookie (for
    //    Twitter, the cookie is `{state}|{verifier}`).
    let (cookie_state, code_verifier) = if provider == "twitter" {
        if let Some(idx) = cookie_value.find('|') {
            (cookie_value[..idx].to_string(), cookie_value[idx + 1..].to_string())
        } else {
            (cookie_value, String::new())
        }
    } else {
        (cookie_value, String::new())
    };

    if cookie_state != state_param {
        tracing::warn!(
            provider = %provider,
            cookie_state = %cookie_state,
            query_state = %state_param,
            "oauth state mismatch — possible CSRF attempt"
        );
        return Ok(Redirect::temporary(&format!(
            "{error_redirect_base}?oauth_error={}",
            urlencoding::encode("State không khớp — có thể bị tấn công CSRF")
        ))
        .into_response());
    }

    // 5. Build the provider + exchange the code.
    let cfg = match oauth_provider_config(&st, &provider) {
        Some(c) => c,
        None => {
            return Ok(Redirect::temporary(&format!(
                "{error_redirect_base}?oauth_error={}",
                urlencoding::encode("Nhà cung cấp OAuth không được cấu hình")
            ))
            .into_response());
        }
    };
    let provider_impl = match build_provider(&provider, cfg) {
        Some(p) => p,
        None => {
            return Ok(Redirect::temporary(&format!(
                "{error_redirect_base}?oauth_error={}",
                urlencoding::encode("Nhà cung cấp OAuth không được cấu hình")
            ))
            .into_response());
        }
    };

    let redirect_base = st.config.oauth.redirect_base_url.clone();
    let mut cb_url = oauth::callback_url(&redirect_base, &provider);
    // Twitter: encode the code_verifier into the redirect_uri fragment
    // so the provider's exchange_code() can extract it.
    if provider == "twitter" && !code_verifier.is_empty() {
        cb_url = format!("{cb_url}#verifier={code_verifier}");
    }

    let span = tracing::Span::current();
    let exchange_result = provider_impl.exchange_code(&code, &cb_url).instrument(span).await;
    let access_token = match exchange_result {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(error = ?e, provider = %provider, "oauth token exchange failed");
            return Ok(Redirect::temporary(&format!(
                "{error_redirect_base}?oauth_error={}",
                urlencoding::encode("Không thể đổi mã OAuth lấy token")
            ))
            .into_response());
        }
    };

    let profile = match provider_impl.fetch_profile(&access_token).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = ?e, provider = %provider, "oauth profile fetch failed");
            return Ok(Redirect::temporary(&format!(
                "{error_redirect_base}?oauth_error={}",
                urlencoding::encode("Không thể lấy thông tin người dùng")
            ))
            .into_response());
        }
    };

    // 6. Upsert the local user record + issue a session.
    let role = if st.store.user_store().count_users().await? == 0 {
        "employee"
    } else {
        "user"
    };

    let user = st
        .store
        .user_store()
        .upsert_oauth_user(
            profile.email.clone(),
            profile.name.clone(),
            profile.provider.clone(),
            profile.subject.clone(),
            profile.avatar_url.clone(),
            role.to_string(),
        )
        .await?;

    // Assign the role (mirrors `register` in auth.rs).
    let roles = st.store.rbac_store().list_roles().await?;
    if let Some(role_row) = roles.iter().find(|r| r.name == role) {
        let _ = st.store.rbac_store().assign_role(user.id, role_row.id).await;
    }

    let session = st.auth.issue_session(user).await?;
    let jar = session.set_cookies(jar, st.auth.cookie_config(), st.auth.jwt_config());

    // Clear the state cookie (one-shot).
    let clearing_cookie = axum_extra::extract::cookie::Cookie::build((cookie_name, ""))
        .path("/")
        .http_only(true)
        .max_age(SignedDuration::seconds(0));
    let jar = jar.add(clearing_cookie);

    let redirect_to = if frontend_url.is_empty() {
        "/".to_string()
    } else {
        frontend_url.trim_end_matches('/').to_string()
    };

    Ok((jar, Redirect::temporary(&redirect_to)).into_response())
}

// ── Helpers ───────────────────────────────────────────────────────

fn oauth_provider_config<'a>(
    st: &'a AppState,
    provider: &str,
) -> Option<&'a crate::config::OAuthProviderConfig> {
    match provider {
        "facebook" => Some(&st.config.oauth.facebook),
        "google" => Some(&st.config.oauth.google),
        "twitter" => Some(&st.config.oauth.twitter),
        _ => None,
    }
}

fn build_provider(
    name: &str,
    cfg: &crate::config::OAuthProviderConfig,
) -> Option<Box<dyn OAuthProvider>> {
    oauth::build_provider(name, cfg)
}

/// Build the OAuth router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/:provider/start", get(oauth_start))
        .route("/:provider/callback", get(oauth_callback))
}

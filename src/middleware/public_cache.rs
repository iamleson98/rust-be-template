//! Short shared `Cache-Control` on public, unauthenticated read APIs.
//!
//! Load-test finding (2026-10-15): every dynamic API call costs a full
//! origin round trip (~200 ms geographic RTT for Vietnamese users).
//! The public read endpoints (`/api/brands`, `/api/routes`,
//! `/api/trips/*`, `/api/search`, `/api/places`, `/api/recommendations`,
//! `/api/stats`) return identical bytes for every caller and are keyed
//! by their full URL, so a short shared TTL is safe: the browser HTTP
//! cache reuses them on repeat visits, and a Cloudflare cache rule
//! ("Cache Everything" + respect origin headers) can later serve them
//! from the Vietnam edge without any further origin change.
//!
//! Session-carrying requests are excluded: logged-in callers (admin
//! panels, logged-in customers) get `no-store` so a list refetch after
//! their own mutation can never serve a stale entry from the browser
//! HTTP cache (TanStack Query invalidation refetches, but the HTTP
//! cache would otherwise answer from its 60 s entry). Anonymous
//! visitors — the vast majority of traffic — keep the shared cache.
//!
//! Safety of the 60 s staleness window on the public side: the booking
//! flow re-validates availability at hold time (two-phase
//! reservation), so a minute-old trip list can never cause an invalid
//! booking — at worst the hold step answers "seats changed".

use axum::extract::Request;
use axum::http::{header, HeaderValue, Method};
use axum::middleware::Next;
use axum::response::Response;

/// Shared TTL (seconds) for anonymous reads of public list/detail APIs.
pub const PUBLIC_CACHE_MAX_AGE_SECS: u64 = 60;

/// Auth-session cookie names (`src/auth/cookies.rs`). Their presence in
/// the `Cookie` header means the caller has a session — answer
/// `no-store` so their own mutations are always immediately visible.
const SESSION_COOKIES: [&str; 2] = ["access_token", "refresh_token"];

/// Whether the request's `Cookie` header carries a session token.
/// Preference cookies (`bus_lang`) do NOT count — only auth does.
fn carries_session(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|jar| {
            jar.split(';').any(|cookie| {
                let cookie = cookie.trim();
                SESSION_COOKIES.iter().any(|name| {
                    // Cookie names are case-sensitive; match the whole
                    // name, not a substring of another cookie's name.
                    cookie == *name || cookie.starts_with(&format!("{name}="))
                })
            })
        })
}

/// Middleware: `public, max-age=60` on successful GET/HEAD responses of
/// session-less requests; `no-store` when a session cookie rides along.
/// Handlers that set their own `Cache-Control` always win
/// (`if_not_present` semantics); mutations and error responses are
/// never touched.
pub async fn public_cache_control(req: Request, next: Next) -> Response {
    let cacheable_method = matches!(*req.method(), Method::GET | Method::HEAD);
    let has_session = carries_session(req.headers());
    let resp = next.run(req).await;
    polish(resp, cacheable_method, has_session)
}

fn polish(mut resp: Response, cacheable_method: bool, has_session: bool) -> Response {
    if !cacheable_method || !resp.status().is_success() {
        return resp;
    }
    if resp.headers().contains_key(header::CACHE_CONTROL) {
        return resp; // the handler knows better (e.g. immutable assets)
    }
    let value = if has_session {
        HeaderValue::from_static("no-store")
    } else {
        // Static format: always a valid header value.
        HeaderValue::from_str(&format!("public, max-age={PUBLIC_CACHE_MAX_AGE_SECS}"))
            .expect("statically formatted Cache-Control value")
    };
    resp.headers_mut().insert(header::CACHE_CONTROL, value);
    resp
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::StatusCode;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    async fn get_with(cookie: Option<&str>) -> Response {
        let mut builder = axum::http::Request::builder().uri("/api/brands");
        if let Some(cookie) = cookie {
            builder = builder.header(header::COOKIE, cookie);
        }
        let app = Router::new()
            .route(
                "/api/brands",
                get(|| async { axum::Json(serde_json::json!({"brands": []})) }),
            )
            .layer(axum::middleware::from_fn(public_cache_control));
        app.oneshot(builder.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    fn cache_control(resp: &Response) -> String {
        resp.headers()
            .get(header::CACHE_CONTROL)
            .map(|v| v.to_str().unwrap().to_string())
            .unwrap_or_default()
    }

    #[tokio::test]
    async fn anonymous_gets_shared_public_cache() {
        let resp = get_with(None).await;
        assert_eq!(cache_control(&resp), "public, max-age=60");
    }

    /// A language-preference cookie is NOT a session: still cacheable.
    #[tokio::test]
    async fn preference_cookies_do_not_disable_caching() {
        let resp = get_with(Some("bus_lang=vi")).await;
        assert_eq!(cache_control(&resp), "public, max-age=60");
    }

    #[tokio::test]
    async fn session_cookies_get_no_store() {
        for jar in [
            "access_token=eyJ...",
            "refresh_token=xyz",
            "bus_lang=vi; access_token=eyJ...; other=1",
            "x=1; refresh_token=xyz",
        ] {
            let resp = get_with(Some(jar)).await;
            assert_eq!(cache_control(&resp), "no-store", "{jar}");
        }
    }

    /// A cookie whose NAME merely contains a session cookie's name
    /// (`my_access_token=1`) must not trip the session gate.
    #[tokio::test]
    async fn name_substrings_do_not_count_as_sessions() {
        let resp = get_with(Some("my_access_token=1")).await;
        assert_eq!(cache_control(&resp), "public, max-age=60");
    }

    #[tokio::test]
    async fn non_success_is_not_cached() {
        let app = Router::new()
            .route(
                "/api/brands",
                get(|| async { (StatusCode::NOT_FOUND, "gone") }),
            )
            .layer(axum::middleware::from_fn(public_cache_control));
        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/brands")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cache_control(&resp), "");
    }

    #[tokio::test]
    async fn posts_are_not_cached() {
        let app = Router::new()
            .route("/api/bookings", axum::routing::post(|| async { "created" }))
            .layer(axum::middleware::from_fn(public_cache_control));
        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .method(Method::POST)
                    .uri("/api/bookings")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cache_control(&resp), "");
    }

    /// Handlers that set their own policy win over the layer default.
    #[tokio::test]
    async fn explicit_cache_control_wins() {
        let app = Router::new()
            .route(
                "/api/x",
                get(|| async {
                    (
                        [(header::CACHE_CONTROL, "public, max-age=31536000, immutable")],
                        "ok",
                    )
                }),
            )
            .layer(axum::middleware::from_fn(public_cache_control));
        let resp = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cache_control(&resp), "public, max-age=31536000, immutable");
    }
}

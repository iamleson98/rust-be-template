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
//! Three anonymous reads are heavier than the rest (`/api/reviews`,
//! `/api/reviews/stats`, `/api/brands/{slug}/profile`: several queries each),
//! so [`public_read_cache`] also keeps their answers in memory for 30 s.
//!
//! Safety of the 60 s staleness window on the public side: the booking
//! flow re-validates availability at hold time (two-phase
//! reservation), so a minute-old trip list can never cause an invalid
//! booking — at worst the hold step answers "seats changed".

use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes, HttpBody as _};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
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

// ── In-process cache of the heaviest anonymous reads ───────────────────

/// How long an answer is reused by this process.
const PUBLIC_READ_TTL: Duration = Duration::from_secs(30);
/// Total body bytes the cache may hold.
const PUBLIC_READ_BUDGET_BYTES: u64 = 8 * 1024 * 1024;
/// Larger answers are passed through uncached.
const PUBLIC_READ_MAX_BODY_BYTES: usize = 512 * 1024;

/// The key a request's answer is cached under, when it may be cached at all.
///
/// * `/api/reviews`, `/api/reviews/stats`: one entry per query string.
/// * `/api/brands/{slug}/profile`: the page data of one brand takes no
///   parameters, so every query string shares its one entry (and its one set
///   of database reads), however many a crawler appends.
fn public_read_key(path: &str, query: Option<&str>) -> Option<String> {
    if matches!(path, "/api/reviews" | "/api/reviews/stats") {
        return Some(match query {
            Some(q) => format!("{path}?{q}"),
            None => path.to_owned(),
        });
    }
    let slug = path
        .strip_prefix("/api/brands/")?
        .strip_suffix("/profile")?;
    (!slug.is_empty() && !slug.contains('/')).then(|| path.to_owned())
}

/// Whether the request is anonymous: no session cookie, no bearer token.
fn is_anonymous(headers: &HeaderMap) -> bool {
    !carries_session(headers) && !headers.contains_key(header::AUTHORIZATION)
}

struct Cached {
    headers: HeaderMap,
    body: Bytes,
}

/// A process-local copy of the answers [`public_read_key`] names.
pub struct PublicReadCache {
    entries: moka::future::Cache<String, Arc<Cached>>,
}

impl PublicReadCache {
    pub fn new() -> Self {
        Self {
            entries: moka::future::Cache::builder()
                .max_capacity(PUBLIC_READ_BUDGET_BYTES)
                .weigher(|key: &String, entry: &Arc<Cached>| {
                    u32::try_from(key.len() + entry.body.len()).unwrap_or(u32::MAX)
                })
                .time_to_live(PUBLIC_READ_TTL)
                .build(),
        }
    }
}

impl Default for PublicReadCache {
    fn default() -> Self {
        Self::new()
    }
}

fn from_cached(entry: &Cached) -> Response {
    let mut resp = Response::new(Body::from(entry.body.clone()));
    *resp.headers_mut() = entry.headers.clone();
    resp
}

/// Middleware: serves the anonymous reads of [`public_read_key`] from memory
/// for 30 seconds. Signed-in callers (cookie or bearer token) always read
/// fresh, so their own writes show on the next fetch; they get `no-store`.
/// Only clean `200` answers that set no cookie are kept.
pub async fn public_read_cache(
    State(cache): State<Arc<PublicReadCache>>,
    req: Request,
    next: Next,
) -> Response {
    let key = (req.method() == Method::GET)
        .then(|| public_read_key(req.uri().path(), req.uri().query()))
        .flatten();
    let Some(key) = key else {
        return next.run(req).await;
    };
    if !is_anonymous(req.headers()) {
        return polish(next.run(req).await, true, true);
    }
    if let Some(entry) = cache.entries.get(&key).await {
        return from_cached(&entry);
    }

    let resp = polish(next.run(req).await, true, false);
    let small = resp
        .body()
        .size_hint()
        .upper()
        .is_some_and(|n| usize::try_from(n).is_ok_and(|n| n <= PUBLIC_READ_MAX_BODY_BYTES));
    if resp.status() != StatusCode::OK || resp.headers().contains_key(header::SET_COOKIE) || !small
    {
        return resp;
    }
    let (parts, body) = resp.into_parts();
    let Ok(body) = axum::body::to_bytes(body, PUBLIC_READ_MAX_BODY_BYTES).await else {
        return Response::from_parts(parts, Body::empty());
    };
    let mut headers = parts.headers.clone();
    headers.remove(header::CONTENT_LENGTH);
    cache
        .entries
        .insert(
            key,
            Arc::new(Cached {
                headers,
                body: body.clone(),
            }),
        )
        .await;
    Response::from_parts(parts, Body::from(body))
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

    mod in_process {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use axum::response::IntoResponse;

        use super::*;

        /// Every route counts its calls; `/api/reviews` answers `reviews`.
        fn counting_app(
            hits: &Arc<AtomicUsize>,
            reviews: (StatusCode, Option<&'static str>),
        ) -> Router {
            let count = |hits: &Arc<AtomicUsize>| {
                let hits = hits.clone();
                move || {
                    let n = hits.fetch_add(1, Ordering::SeqCst);
                    async move { axum::Json(serde_json::json!({ "n": n })) }
                }
            };
            let reviews_hits = hits.clone();
            Router::new()
                .route(
                    "/api/reviews",
                    get(move || {
                        let n = reviews_hits.fetch_add(1, Ordering::SeqCst);
                        async move {
                            let mut resp = (reviews.0, axum::Json(serde_json::json!({ "n": n })))
                                .into_response();
                            if let Some(cookie) = reviews.1 {
                                resp.headers_mut()
                                    .insert(header::SET_COOKIE, HeaderValue::from_static(cookie));
                            }
                            resp
                        }
                    }),
                )
                .route("/api/brands/{slug}/profile", get(count(hits)))
                .route("/api/reviews/mine", get(count(hits)))
                .layer(axum::middleware::from_fn_with_state(
                    Arc::new(PublicReadCache::new()),
                    public_read_cache,
                ))
        }

        async fn fetch(app: &Router, uri: &str, headers: &[(&str, &str)]) -> (Response, String) {
            let mut req = axum::http::Request::builder().uri(uri);
            for (k, v) in headers {
                req = req.header(*k, *v);
            }
            let resp = app
                .clone()
                .oneshot(req.body(Body::empty()).unwrap())
                .await
                .unwrap();
            let (parts, body) = resp.into_parts();
            let bytes = axum::body::to_bytes(body, 1 << 20).await.unwrap();
            (
                Response::from_parts(parts, Body::empty()),
                String::from_utf8(bytes.to_vec()).unwrap(),
            )
        }

        #[test]
        fn only_the_named_reads_have_a_key() {
            assert_eq!(
                public_read_key("/api/reviews", None).as_deref(),
                Some("/api/reviews")
            );
            assert_eq!(
                public_read_key("/api/reviews", Some("brandId=x&page=2")).as_deref(),
                Some("/api/reviews?brandId=x&page=2")
            );
            assert_eq!(
                public_read_key("/api/reviews/stats", Some("a=1")).as_deref(),
                Some("/api/reviews/stats?a=1")
            );
            assert_eq!(
                public_read_key("/api/brands/phuong-trang/profile", Some("utm=1")).as_deref(),
                Some("/api/brands/phuong-trang/profile")
            );
            for path in [
                "/api/reviews/mine",
                "/api/reviews/tags",
                "/api/brands",
                "/api/brands/x",
                "/api/brands//profile",
                "/api/brands/a/b/profile",
                "/api/brands/x/profile/y",
            ] {
                assert_eq!(public_read_key(path, None), None, "{path}");
            }
        }

        #[tokio::test]
        async fn an_anonymous_read_is_served_from_memory_after_the_first() {
            let hits = Arc::new(AtomicUsize::new(0));
            let app = counting_app(&hits, (StatusCode::OK, None));
            let (first, body1) = fetch(&app, "/api/reviews", &[]).await;
            let (second, body2) = fetch(&app, "/api/reviews", &[]).await;
            assert_eq!(hits.load(Ordering::SeqCst), 1);
            assert_eq!(body1, body2);
            assert_eq!(cache_control(&first), "public, max-age=60");
            assert_eq!(cache_control(&second), "public, max-age=60");
            assert_eq!(second.headers()[header::CONTENT_TYPE], "application/json");
            // A different query string of a reviews read is another answer.
            fetch(&app, "/api/reviews?page=2", &[]).await;
            assert_eq!(hits.load(Ordering::SeqCst), 2);
        }

        #[tokio::test]
        async fn a_brand_profile_ignores_the_query_string() {
            let hits = Arc::new(AtomicUsize::new(0));
            let app = counting_app(&hits, (StatusCode::OK, None));
            for uri in [
                "/api/brands/phuong-trang/profile",
                "/api/brands/phuong-trang/profile?utm_source=x",
                "/api/brands/phuong-trang/profile?random=1&other=2",
            ] {
                fetch(&app, uri, &[]).await;
            }
            assert_eq!(hits.load(Ordering::SeqCst), 1);
            fetch(&app, "/api/brands/thanh-buoi/profile", &[]).await;
            assert_eq!(hits.load(Ordering::SeqCst), 2);
        }

        #[tokio::test]
        async fn signed_in_callers_always_read_fresh_and_are_not_cached() {
            let hits = Arc::new(AtomicUsize::new(0));
            let app = counting_app(&hits, (StatusCode::OK, None));
            fetch(&app, "/api/reviews", &[]).await; // fills the cache
            for headers in [
                [("cookie", "access_token=abc")],
                [("authorization", "Bearer abc")],
            ] {
                let (resp, _) = fetch(&app, "/api/reviews", &headers).await;
                assert_eq!(cache_control(&resp), "no-store", "{headers:?}");
            }
            assert_eq!(hits.load(Ordering::SeqCst), 3);
        }

        #[tokio::test]
        async fn other_paths_and_non_200_answers_are_left_alone() {
            let hits = Arc::new(AtomicUsize::new(0));
            let app = counting_app(&hits, (StatusCode::OK, None));
            fetch(&app, "/api/reviews/mine", &[]).await;
            let (resp, _) = fetch(&app, "/api/reviews/mine", &[]).await;
            assert_eq!(hits.load(Ordering::SeqCst), 2);
            assert_eq!(cache_control(&resp), "");

            for (status, cookie) in [
                (StatusCode::INTERNAL_SERVER_ERROR, None),
                (StatusCode::OK, Some("a=b")),
            ] {
                let hits = Arc::new(AtomicUsize::new(0));
                let app = counting_app(&hits, (status, cookie));
                fetch(&app, "/api/reviews", &[]).await;
                fetch(&app, "/api/reviews", &[]).await;
                assert_eq!(hits.load(Ordering::SeqCst), 2, "{status} {cookie:?}");
            }
        }
    }
}

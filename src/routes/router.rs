//! App router composition.
//!
//! Each route module exposes a `pub fn router() -> Router<AppState>` that
//! mounts its handlers under a path prefix. `build_router` is now a thin
//! composer — easy to scan top-to-bottom and see every mounted route.
//!
//! ## Rate limiting
//!
//! `tower_governor` uses a token-bucket: `burst_size` tokens available
//! immediately, and `per_second(n)` means 1 token refilled every n
//! seconds. To allow `rpm` requests per minute we need a refill rate
//! of `rpm / 60` tokens per second. tower_governor's `per_second`
//! takes a u64 (whole seconds), so for sub-second rates we use
//! `per_millisecond` instead: `interval_ms = (60 * 1000) / rpm`.
//!
//! The rate-limit layer is applied ONCE to the entire `/api` nest —
//! this is the idiomatic Axum pattern + avoids the cost of building
//! a `GovernorLayer` per route.

use axum::http::{HeaderName, HeaderValue};
use axum::response::IntoResponse;
use axum::Router;
use tower::service_fn;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::key_extractor::KeyExtractor;
use tower_governor::{GovernorError, GovernorLayer};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;

use crate::middleware::anti_scraping;
use crate::middleware::request_id::request_id_layer;
use crate::state::AppState;

/// Rate-limit key = the REAL client IP from the proxy chain
/// (`middleware::header_client_ip`, SEC-2026-RL), else the socket peer.
///
/// tower_governor's default `PeerIpKeyExtractor` keys on the socket
/// peer, which behind Caddy is the PROXY's IP — one global bucket for
/// the entire site: any single client could exhaust the API budget for
/// everyone (availability), and distributed abuse was barely throttled.
#[derive(Clone, Copy, Debug)]
struct ClientIpKeyExtractor;

impl KeyExtractor for ClientIpKeyExtractor {
    type Key = std::net::IpAddr;

    fn extract<T>(&self, req: &axum::http::Request<T>) -> Result<Self::Key, GovernorError> {
        use axum::extract::ConnectInfo;
        crate::middleware::header_client_ip(req.headers())
            .or_else(|| {
                req.extensions()
                    .get::<ConnectInfo<std::net::SocketAddr>>()
                    .map(|ci| ci.0.ip())
            })
            .ok_or(GovernorError::UnableToExtractKey)
    }
}

async fn serve_service_worker(path: std::path::PathBuf) -> axum::response::Response {
    use axum::http::{header, HeaderValue, StatusCode};
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            [
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/javascript; charset=utf-8"),
                ),
                (
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("no-cache, must-revalidate"),
                ),
                (
                    HeaderName::from_static("service-worker-allowed"),
                    HeaderValue::from_static("/"),
                ),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Build the complete app router.
///
/// Order of operations:
///   1. Build `/api` sub-router by nesting per-domain `router()` functions.
///   2. Apply the rate-limit layer to `/api` (one layer, all sub-routes).
///   3. Mount `/api`, `/health`, `/ready`, SEO routes, SW, WS hubs,
///      Swagger, and static files.
///   4. Apply global middleware (body limit, timeout, trace, compression,
///      CORS, request-id).
///   5. Capture state via `.with_state(state)`.
pub fn build_router(state: AppState) -> Router<()> {
    // ---- Initialize anti-scraping allowed origins --------------------
    // Stored in a static OnceLock so the middleware can access it
    // without state being passed through every request.
    anti_scraping::init_allowed_origins(state.config.cors.origin_list());

    // ---- Rate-limit config ------------------------------------------
    // Keyed per REAL client IP (see ClientIpKeyExtractor above), not per
    // socket peer — behind Caddy the peer IP is the proxy itself.
    let rpm = state.config.rate_limit.rpm.max(1) as u64;
    let interval_ms = (60_000 / rpm).max(1);
    let governor_conf = std::sync::Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(ClientIpKeyExtractor)
            .per_millisecond(interval_ms)
            .burst_size(state.config.rate_limit.burst.max(1))
            .finish()
            .unwrap_or_else(|| {
                GovernorConfigBuilder::default()
                    .key_extractor(ClientIpKeyExtractor)
                    .finish()
                    .unwrap()
            }),
    );
    let governor_layer = GovernorLayer {
        config: governor_conf,
    };

    // ---- /api sub-router (rate-limited) --------------------------------
    // Each route module owns its own `router()` function — `build_router`
    // just composes them. To add a new domain: write the module, expose
    // `router()`, and add one `.nest("/<prefix>", module::router())` line.
    let api_routes: Router<AppState> = Router::new()
        .nest("/auth", crate::routes::auth::router())
        .nest("/auth/oauth", crate::routes::oauth::router())
        .nest("/users", crate::routes::users::router())
        .nest("/posts", crate::routes::posts::router())
        .nest("/bookings", crate::routes::bookings::router())
        .nest("/loyalty", crate::routes::loyalty::router())
        .nest("/payments", crate::routes::payments::router())
        .nest("/brands", crate::routes::public::brands_router())
        .nest("/routes", crate::routes::public::routes_router())
        .nest("/trips", crate::routes::public::trips_router())
        .nest("/search", crate::routes::public::search_router())
        .nest(
            "/recommendations",
            crate::routes::public::recommendations_router(),
        )
        .nest("/campaigns", crate::routes::campaigns::router())
        .nest("/coupons", crate::routes::campaigns::coupons_router())
        .nest("/stats", crate::routes::public::stats_router())
        .nest("/places", crate::routes::places::router())
        .nest("/routing", crate::routes::routing::router())
        .nest("/reviews", crate::routes::reviews::router())
        .nest("/price-alerts", crate::routes::price_alerts::router())
        .nest("/chat", crate::routes::chat::router())
        .nest("/presence", crate::routes::presence::router())
        .nest("/notifications", crate::routes::notifications::router())
        .nest("/push", crate::routes::push_devices::router())
        .nest("/ads", crate::routes::ads::router())
        .nest("/admin", crate::routes::admin::router())
        .nest("/admin/payments", crate::routes::payments::admin_router())
        .nest("/admin/system", crate::routes::system::router())
        .nest("/vitals", crate::routes::vitals::router())
        .nest("/nullclaw", crate::routes::nullclaw::router())
        .nest("/webhooks", crate::routes::webhooks::router())
        .layer(governor_layer);

    // ---- Static files (NO rate limit, browser-cache headers) -----------
    // Correct SPA static-serving contract (prevents the "module script
    // served as text/html" hard failure after a redeploy):
    //   * `/assets/*` — Vite emits content-hashed filenames, so these are
    //     immutable and safe to cache for a year. A miss means the browser
    //     holds a stale index.html referencing dead chunk hashes: it MUST
    //     get a plain 404 (never index.html, which returns 200 + text/html
    //     and kills the module graph with a MIME-type error).
    //   * `index.html` (root + SPA fallback) — `no-cache` so every deploy
    //     is picked up immediately instead of serving stale references.
    //   * other root files (favicon, manifests, images) — moderate cache.
    let static_dir = state.config.static_files.dir.clone();
    let static_cache_age = state.config.static_files.cache_max_age;
    let static_root = std::path::Path::new(&static_dir).to_path_buf();
    let index_html_path = static_root.join("index.html");
    let sw_path = static_root.join("sw.js");

    // Plain 404 for missing hashed assets — no HTML fallback, no caching.
    let asset_not_found = service_fn(|_req: axum::http::Request<axum::body::Body>| async {
        let resp = axum::response::Response::builder()
            .status(axum::http::StatusCode::NOT_FOUND)
            .header(
                axum::http::header::CONTENT_TYPE,
                "text/plain; charset=utf-8",
            )
            .header(axum::http::header::CACHE_CONTROL, "no-store")
            .body(axum::body::Body::from("asset not found"))
            .expect("static 404 response is always constructible");
        Ok::<_, std::convert::Infallible>(resp)
    });
    let assets_service = ServeDir::new(&static_root)
        .precompressed_gzip()
        .precompressed_br()
        .not_found_service(asset_not_found);

    // SPA fallback: extension-shaped paths (missing .js/.css/.png/…)
    // get a 404; everything else is a client-side route and gets
    // index.html with `no-cache, must-revalidate`.
    let make_spa_fallback = |index_html_path: std::path::PathBuf| {
        service_fn(move |req: axum::http::Request<axum::body::Body>| {
            let index_html_path = index_html_path.clone();
            async move {
                // "/admin/brands" → last segment "brands" (no dot) → SPA.
                // "/vendor-dead.js" → last segment has a dot → 404.
                let last_segment = req.uri().path().rsplit('/').next().unwrap_or("");
                if last_segment.contains('.') {
                    let resp = axum::response::Response::builder()
                        .status(axum::http::StatusCode::NOT_FOUND)
                        .header(
                            axum::http::header::CONTENT_TYPE,
                            "text/plain; charset=utf-8",
                        )
                        .header(axum::http::header::CACHE_CONTROL, "no-store")
                        .body(axum::body::Body::from("not found"))
                        .expect("static 404 response is always constructible");
                    return Ok::<_, std::convert::Infallible>(resp);
                }
                // "/privacy" → dist/privacy.html when the build prerendered
                // that page, so crawlers and provider reviewers read its
                // text without running scripts; other routes → index.html.
                let page = match prerendered_page(&index_html_path, req.uri().path()) {
                    Some(p) if tokio::fs::try_exists(&p).await.unwrap_or(false) => p,
                    _ => index_html_path,
                };
                match tokio::fs::read(&page).await {
                    Ok(bytes) => {
                        let resp = axum::response::Response::builder()
                            .status(axum::http::StatusCode::OK)
                            .header(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")
                            .header(
                                axum::http::header::CACHE_CONTROL,
                                "no-cache, must-revalidate",
                            )
                            .body(axum::body::Body::from(bytes))
                            .expect("static index response is always constructible");
                        Ok(resp)
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "index.html missing — is the frontend built?");
                        let resp = axum::response::Response::builder()
                            .status(axum::http::StatusCode::NOT_FOUND)
                            .header(
                                axum::http::header::CONTENT_TYPE,
                                "text/plain; charset=utf-8",
                            )
                            .header(axum::http::header::CACHE_CONTROL, "no-store")
                            .body(axum::body::Body::from(
                                "frontend not built (dist/index.html missing)",
                            ))
                            .expect("static 404 response is always constructible");
                        Ok(resp)
                    }
                }
            }
        })
    };

    // Root "/" and unknown non-asset paths both go through the SPA
    // fallback so index.html is ALWAYS served with no-cache.
    let root_service = make_spa_fallback(index_html_path.clone());
    let spa_fallback = make_spa_fallback(index_html_path.clone());
    let static_service = ServeDir::new(&static_root)
        .append_index_html_on_directories(true)
        .precompressed_gzip()
        .precompressed_br()
        // SPA fallback: if the requested file doesn't exist, serve index.html
        // so client-side routing (TanStack Router) can handle the path.
        .not_found_service(spa_fallback);

    let static_router: Router<AppState> = Router::new()
        .route_service("/", root_service)
        .route_service("/{*path}", static_service)
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_str(&format!("public, max-age={static_cache_age}"))
                .expect("valid header value"),
        ));
    // Hashed build assets — immutable for a year (explicit headers on
    // 404 responses are left untouched by `if_not_present`).
    let assets_router: Router<AppState> = Router::new()
        .route_service("/assets/{*path}", assets_service)
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("public, max-age=31536000, immutable"),
        ));

    // Capture timeout + body limit before state is moved into the router.
    let request_timeout_secs = state.config.server.request_timeout_secs;
    let max_body_bytes = state.config.server.max_request_body_bytes;
    // The global tower_http cap must let the admin picture-upload
    // route through (10 MiB picture + multipart framing). JSON routes
    // stay protected at axum's extractor-level default (2 MiB) — only
    // the upload route raises it via a route-scoped `DefaultBodyLimit`
    // (see routes/admin/route_pictures.rs).
    let media_upload_cap = crate::service::route_media_service::MAX_PICTURE_BYTES + 64 * 1024;
    let global_body_bytes = max_body_bytes.max(media_upload_cap);

    // ---- Swagger UI -----------------------------------------------------
    // SEC-2026-SW: Swagger + /api-docs/openapi.json are full API maps
    // (every route, schema, admin endpoint). Public by default was an
    // info-disclosure gift to attackers — now opt-in, default OFF.
    let swagger_enabled = std::env::var("SWAGGER_ENABLED")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(false);
    let swagger: Router<AppState> = if swagger_enabled {
        utoipa_swagger_ui::SwaggerUi::new("/swagger-ui")
            .url("/api-docs/openapi.json", crate::routes::ApiDoc::openapi())
            .into()
    } else {
        Router::new()
    };

    // ---- Compose --------------------------------------------------------
    Router::<AppState>::new()
        .route("/health", axum::routing::get(crate::routes::health::health))
        .route("/ready", axum::routing::get(crate::routes::health::ready))
        // SEO routes — bypass the rate limiter so crawlers aren't blocked.
        .route(
            "/sitemap.xml",
            axum::routing::get(crate::routes::seo::sitemap),
        )
        .route(
            "/robots.txt",
            axum::routing::get(crate::routes::seo::robots),
        )
        // PWA service worker — bypass the rate limiter (loaded on every page load).
        // Served from the configured static dir, never cached: a stale worker
        // would pin users to an old build.
        .route(
            "/sw.js",
            axum::routing::get(move || serve_service_worker(sw_path.clone())),
        )
        .nest("/api", api_routes)
        // Media proxy (`/api/media/{key}`) — mounted at the root, NOT
        // under the rate-limited `/api` nest: a route-detail page fans
        // out one request per picture, and these are immutable,
        // ETag-cacheable static reads — they must not burn rate-limit
        // tokens needed by real API traffic.
        .nest("/api/media", crate::routes::media::router())
        // Chat WebSocket hub (`/ws`) — mounted at the root (not under /api)
        // so the frontend can connect to `/ws` directly. JWT auth via
        // `?token=` query param.
        .merge(crate::ws::handler::router())
        // Audio-call signaling relay (`/ws-call`) — WebRTC offer/answer/ice
        // relay between customers and support agents. Gated by config.
        .merge(crate::audio_call::handler::router())
        .merge(swagger)
        .merge(assets_router)
        .merge(static_router)
        // Request body size limit — protects against memory DoS.
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            global_body_bytes,
        ))
        // Per-request timeout — protects against slowloris + slow handlers.
        .layer(axum::middleware::from_fn(
            move |req, next: axum::middleware::Next| {
                let duration = std::time::Duration::from_secs(request_timeout_secs);
                crate::middleware::request_timeout(req, next, duration)
            },
        ))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(
                    state
                        .config
                        .cors
                        .origin_list()
                        .iter()
                        .map(|o| o.parse().expect("valid origin"))
                        .collect::<Vec<_>>(),
                ))
                .allow_credentials(true)
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PATCH,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::CONTENT_TYPE,
                    axum::http::HeaderName::from_static("x-request-id"),
                ]),
        )
        // Anti-scraping: blocks known scraping tools (curl, python-requests,
        // selenium, etc.) + requires Referer/Origin on mutation requests.
        // Applied after CORS so preflight OPTIONS pass through.
        .layer(axum::middleware::from_fn(anti_scraping::anti_scraping))
        .layer(axum::middleware::from_fn(request_id_layer))
        // ---- Security headers (SEC-2026-HD) ----------------------------
        // Browser hardening missing on every datxevui.com response
        // (verified live: no XFO / nosniff / HSTS / Referrer-Policy).
        // `if_not_present` so routes that set their own value still win.
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=15552000; includeSubDomains"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .with_state(state)
}

/// `dist/<name>.html` beside `index_html` for a one-segment path such as
/// `/privacy`. Only lowercase letters, digits and dashes qualify, so a
/// request can never name a file outside the build directory.
fn prerendered_page(index_html: &std::path::Path, path: &str) -> Option<std::path::PathBuf> {
    let name = path.strip_prefix('/')?;
    let safe = !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    safe.then(|| index_html.with_file_name(format!("{name}.html")))
}

#[cfg(test)]
mod tests {
    use super::prerendered_page;
    use std::path::Path;

    #[test]
    fn only_safe_one_segment_paths_map_to_prerendered_pages() {
        let index = Path::new("/srv/dist/index.html");
        assert_eq!(
            prerendered_page(index, "/privacy"),
            Some(Path::new("/srv/dist/privacy.html").to_path_buf())
        );
        for path in [
            "/",
            "/admin/brands",
            "/../etc/passwd",
            "/Privacy",
            "/a.b",
            "/x%2e",
        ] {
            assert_eq!(prerendered_page(index, path), None, "{path}");
        }
    }
}

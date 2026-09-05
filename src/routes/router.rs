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

use axum::response::IntoResponse;
use axum::Router;
use tower::service_fn;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;

use crate::middleware::anti_scraping;
use crate::middleware::request_id::request_id_layer;
use crate::state::AppState;

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
    let rpm = state.config.rate_limit.rpm.max(1) as u64;
    let interval_ms = (60_000 / rpm).max(1);
    let governor_conf = std::sync::Arc::new(
        GovernorConfigBuilder::default()
            .per_millisecond(interval_ms)
            .burst_size(state.config.rate_limit.burst.max(1))
            .finish()
            .unwrap_or_else(|| GovernorConfigBuilder::default().finish().unwrap()),
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
        .nest("/payments", crate::routes::payments::router())
        .nest("/brands", crate::routes::public::brands_router())
        .nest("/routes", crate::routes::public::routes_router())
        .nest("/trips", crate::routes::public::trips_router())
        .nest("/search", crate::routes::public::search_router())
        .nest(
            "/recommendations",
            crate::routes::public::recommendations_router(),
        )
        .nest("/campaigns", crate::routes::public::campaigns_router())
        .nest("/stats", crate::routes::public::stats_router())
        .nest("/places", crate::routes::places::router())
        .nest("/routing", crate::routes::routing::router())
        .nest("/reviews", crate::routes::reviews::router())
        .nest("/price-alerts", crate::routes::price_alerts::router())
        .nest("/chat", crate::routes::chat::router())
        .nest("/presence", crate::routes::presence::router())
        .nest("/notifications", crate::routes::notifications::router())
        .nest("/wishlist", crate::routes::wishlist::router())
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

    // Plain 404 for missing hashed assets — no HTML fallback, no caching.
    let asset_not_found = service_fn(
        |_req: axum::http::Request<axum::body::Body>| async {
            let resp = axum::response::Response::builder()
                .status(axum::http::StatusCode::NOT_FOUND)
                .header(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .header(axum::http::header::CACHE_CONTROL, "no-store")
                .body(axum::body::Body::from("asset not found"))
                .expect("static 404 response is always constructible");
            Ok::<_, std::convert::Infallible>(resp)
        },
    );
    let assets_service = ServeDir::new(&static_root)
        .precompressed_gzip()
        .precompressed_br()
        .not_found_service(asset_not_found);

    // SPA fallback: extension-shaped paths (missing .js/.css/.png/…)
    // get a 404; everything else is a client-side route and gets
    // index.html with `no-cache, must-revalidate`.
    let make_spa_fallback = |index_html_path: std::path::PathBuf| {
        service_fn(
            move |req: axum::http::Request<axum::body::Body>| {
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
                    match tokio::fs::read(&index_html_path).await {
                        Ok(bytes) => {
                            let resp = axum::response::Response::builder()
                                .status(axum::http::StatusCode::OK)
                                .header(
                                    axum::http::header::CONTENT_TYPE,
                                    "text/html; charset=utf-8",
                                )
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
            },
        )
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
        .route_service(
            "/assets/{*path}",
            assets_service,
        )
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("public, max-age=31536000, immutable"),
        ));

    // Capture timeout + body limit before state is moved into the router.
    let request_timeout_secs = state.config.server.request_timeout_secs;
    let max_body_bytes = state.config.server.max_request_body_bytes;

    // ---- Swagger UI -----------------------------------------------------
    let swagger: Router<AppState> = utoipa_swagger_ui::SwaggerUi::new("/swagger-ui")
        .url("/api-docs/openapi.json", crate::routes::ApiDoc::openapi())
        .into();

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
        .route(
            "/sw.js",
            axum::routing::get(|| async {
                let path = std::path::Path::new("./frontend/dist/sw.js");
                if path.exists() {
                    let bytes = tokio::fs::read(path).await.unwrap_or_default();
                    let mut resp = axum::response::Response::new(axum::body::Body::from(bytes));
                    resp.headers_mut().insert(
                        axum::http::header::CONTENT_TYPE,
                        axum::http::HeaderValue::from_static(
                            "application/javascript; charset=utf-8",
                        ),
                    );
                    resp.headers_mut().insert(
                        "Service-Worker-Allowed",
                        axum::http::HeaderValue::from_static("/"),
                    );
                    resp.headers_mut().insert(
                        axum::http::header::CACHE_CONTROL,
                        axum::http::HeaderValue::from_static("no-cache, must-revalidate"),
                    );
                    resp
                } else {
                    axum::http::StatusCode::NOT_FOUND.into_response()
                }
            }),
        )
        .nest("/api", api_routes)
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
            max_body_bytes,
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
        .with_state(state)
}

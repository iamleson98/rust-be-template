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
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
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
        .nest("/notifications", crate::routes::notifications::router())
        .nest("/wishlist", crate::routes::wishlist::router())
        .nest("/admin", crate::routes::admin::router())
        .nest("/admin/payments", crate::routes::payments::admin_router())
        .nest("/admin/system", crate::routes::system::router())
        .nest("/vitals", crate::routes::vitals::router())
        .nest("/zeroclaw", crate::routes::zeroclaw::router())
        .layer(governor_layer);

    // ---- Static files (NO rate limit, browser-cache headers) -----------
    let static_dir = state.config.static_files.dir.clone();
    let static_cache_age = state.config.static_files.cache_max_age;
    let index_html_path = std::path::Path::new(&static_dir).join("index.html");
    let static_service = ServeDir::new(&static_dir)
        .append_index_html_on_directories(true)
        .precompressed_gzip()
        .precompressed_br()
        // SPA fallback: if the requested file doesn't exist, serve index.html
        // so client-side routing (TanStack Router) can handle the path.
        .fallback(ServeFile::new(&index_html_path));
    let static_router: Router<AppState> = Router::new()
        .route_service("/", static_service.clone())
        .route_service("/{*path}", static_service)
        .layer(SetResponseHeaderLayer::if_not_present(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_str(&format!("public, max-age={static_cache_age}"))
                .expect("valid header value"),
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

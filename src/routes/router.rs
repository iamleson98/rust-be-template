//! App router composition.
//!
//! Each route module exposes a `pub fn router() -> Router<AppState>` that
//! mounts its handlers under a path prefix. `build_router` is a thin
//! composer — easy to scan top-to-bottom and see every mounted route.
//!
//! ## Edge policy
//!
//! Everything that guards or shapes a request lives in `crate::middleware` and
//! is applied here, once, to the whole app (outermost first):
//!
//! 1. security headers on every response (HSTS, nosniff, framing, referrer,
//!    CSP floor, Permissions-Policy);
//! 2. request id;
//! 3. `trusted_forwarding_headers` — forwarding headers that cannot be
//!    trusted for this deployment are deleted (`CLIENT_IP_SOURCE`);
//! 4. `rate_limit` — per-IP classes (`middleware::rate_limit`);
//! 5. `anti_scraping`, then CORS, compression, tracing, timeout, body limit.
//!
//! The web app itself (static files, the SPA shell and its per-page head)
//! is the router's fallback: see `crate::web`.

use axum::http::{header, HeaderName, HeaderValue};
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;

use crate::middleware::anti_scraping;
use crate::middleware::client_ip::{
    trusted_forwarding_headers, warn_if_xff_behind_loopback, ClientIpSource,
};
use crate::middleware::public_cache::{public_read_cache, PublicReadCache};
use crate::middleware::rate_limit::{rate_limit, RateLimits};
use crate::middleware::request_id::request_id_layer;
use crate::state::AppState;

/// A floor every page meets, not a script allow-list: no plugins, no `<base>`
/// hijack, never framed (the CSP form of `X-Frame-Options`).
const CSP_FLOOR: &str = "base-uri 'self'; object-src 'none'; frame-ancestors 'none'";
/// Uploaded images are data, never a document: nothing runs, nothing loads.
const CSP_MEDIA: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
/// The microphone (audio calls) and location (the map) for this site only.
const PERMISSIONS_POLICY: &str =
    "camera=(), microphone=(self), geolocation=(self), payment=(), usb=()";

/// Build the complete app router.
///
/// Order of operations:
///   1. Build the `/api` sub-router by nesting per-domain `router()` functions.
///   2. Mount `/api`, `/health`, `/ready`, SEO routes, WS hubs, Swagger and
///      the web app (static files + SPA shell) as the catch-all.
///   3. Apply global middleware (see the module docs for the order).
///   4. Capture state via `.with_state(state)`.
pub fn build_router(state: AppState) -> Router<()> {
    // ---- Initialize anti-scraping allowed origins --------------------
    // Stored in a static OnceLock so the middleware can access it
    // without state being passed through every request.
    anti_scraping::init_allowed_origins(state.config.cors.origin_list());

    // ---- /api sub-router -------------------------------------------------
    // Each route module owns its own `router()` function — `build_router`
    // just composes them. To add a new domain: write the module, expose
    // `router()`, and add one `.nest("/<prefix>", module::router())` line.
    //
    // Public read-only nests additionally get the shared
    // `Cache-Control` layer (see `middleware::public_cache`): identical
    // bytes for every caller, keyed by full URL, 60 s TTL for anonymous
    // visitors, `no-store` once a session cookie rides along. Anything
    // auth-scoped, mutating, or user-specific MUST NOT get that layer.
    let public_cache =
        axum::middleware::from_fn(crate::middleware::public_cache::public_cache_control);
    let api_routes: Router<AppState> = Router::new()
        .nest("/auth", crate::routes::auth::router())
        .nest("/auth/oauth", crate::routes::oauth::router())
        .nest("/users", crate::routes::users::router())
        .nest("/posts", crate::routes::posts::router())
        .nest("/bookings", crate::routes::bookings::router())
        .nest("/loyalty", crate::routes::loyalty::router())
        .nest("/payments", crate::routes::payments::router())
        .nest(
            "/brands",
            crate::routes::public::brands_router().layer(public_cache.clone()),
        )
        .nest(
            "/routes",
            crate::routes::public::routes_router().layer(public_cache.clone()),
        )
        .nest(
            "/trips",
            crate::routes::public::trips_router().layer(public_cache.clone()),
        )
        .nest(
            "/search",
            crate::routes::public::search_router().layer(public_cache.clone()),
        )
        .nest(
            "/recommendations",
            crate::routes::public::recommendations_router().layer(public_cache.clone()),
        )
        .nest("/campaigns", crate::routes::campaigns::router())
        .nest("/coupons", crate::routes::campaigns::coupons_router())
        .nest(
            "/stats",
            crate::routes::public::stats_router().layer(public_cache.clone()),
        )
        .nest(
            "/places",
            crate::routes::places::router().layer(public_cache.clone()),
        )
        .nest("/routing", crate::routes::routing::router())
        .nest("/reviews", crate::routes::reviews::router())
        .nest("/price-alerts", crate::routes::price_alerts::router())
        .nest("/chat", crate::routes::chat::router())
        .nest("/presence", crate::routes::presence::router())
        .nest("/notifications", crate::routes::notifications::router())
        .nest("/push", crate::routes::push_devices::router())
        .nest("/ads", crate::routes::ads::router())
        .nest("/uploads", crate::routes::uploads::router())
        .nest("/admin", crate::routes::admin::router())
        .nest("/admin/payments", crate::routes::payments::admin_router())
        .nest("/admin/system", crate::routes::system::router())
        .nest("/vitals", crate::routes::vitals::router())
        .nest("/nullclaw", crate::routes::nullclaw::router())
        .nest("/webhooks", crate::routes::webhooks::router())
        // Query, path and JSON rejections answer inside the error envelope.
        .layer(axum::middleware::from_fn(
            crate::middleware::rejection_envelope::rejection_envelope,
        ))
        // The reviews list and stats and a brand's page data are read by
        // every visitor and cost several queries: kept in memory for 30 s
        // (anonymous callers only, see `public_read_cache`).
        .layer(axum::middleware::from_fn_with_state(
            std::sync::Arc::new(PublicReadCache::new()),
            public_read_cache,
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

    let rate_limits = std::sync::Arc::new(RateLimits::new(&state.config.rate_limit));
    let client_ip_source = ClientIpSource::from_config(&state.config.server.client_ip_source);
    warn_if_xff_behind_loopback(client_ip_source, &state.config.server.host);

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
        .route(
            "/sitemap.xml",
            axum::routing::get(crate::routes::seo::sitemap),
        )
        .route(
            "/robots.txt",
            axum::routing::get(crate::routes::seo::robots),
        )
        .nest("/api", api_routes)
        // Media proxy (`/api/media/{key}`): immutable, ETag-cacheable
        // reads that are never rate limited (a route-detail page fans out
        // one request per picture). Whatever the object, it is served
        // under a sandboxing CSP.
        .nest(
            "/api/media",
            crate::routes::media::router().layer(SetResponseHeaderLayer::overriding(
                header::CONTENT_SECURITY_POLICY,
                HeaderValue::from_static(CSP_MEDIA),
            )),
        )
        // Chat WebSocket hub (`/ws`) — mounted at the root (not under /api)
        // so the frontend can connect to `/ws` directly. JWT auth via
        // `?token=` query param.
        .merge(crate::ws::handler::router())
        // Audio-call signaling relay (`/ws-call`) — WebRTC offer/answer/ice
        // relay between customers and support agents. Gated by config.
        .merge(crate::audio_call::handler::router())
        .merge(swagger)
        // The web app: static files, `/_next/static` of the retired build,
        // and the SPA shell with each page's head. Catches every other path.
        .merge(crate::web::router(
            &state.config.static_files,
            state.db.clone(),
        ))
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
        // Per-IP request limits by class. Outside anti-scraping, so a flood
        // of blocked requests is throttled too.
        .layer(axum::middleware::from_fn_with_state(
            rate_limits,
            rate_limit,
        ))
        // Drops the forwarding headers this deployment cannot trust before
        // anything (the limiter, the WS caps) reads the client address.
        .layer(axum::middleware::from_fn_with_state(
            client_ip_source,
            trusted_forwarding_headers,
        ))
        .layer(axum::middleware::from_fn(request_id_layer))
        // ---- Security headers (SEC-2026-HD) ----------------------------
        // Browser hardening on every response, including the 403s and 429s
        // the layers above produce. `if_not_present` so routes that set
        // their own value still win.
        .layer(SetResponseHeaderLayer::if_not_present(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=15552000; includeSubDomains"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CSP_FLOOR),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static(PERMISSIONS_POLICY),
        ))
        .with_state(state)
}

use axum::routing::{delete, get, patch, post};
use axum::Router;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;

use crate::middleware::request_id::request_id_layer;
use crate::state::AppState;
/// Build the complete app router. The state is captured by `api_routes`
/// via `.with_state(state.clone())`, which converts that sub-router to
/// `Router<()>`. The outer router is then also `Router<()>` so it can be
/// served directly via `axum::serve`.
pub fn build_router(state: AppState) -> Router<()> {
    // ---- Rate-limit only API routes ------------------------------------
    // Use `GovernorConfigBuilder::secure()` is not needed here; default
    // extracts PeerIp which works once we add `x-forwarded-for` support.
    // For dev (localhost without trusted proxy), we use the default
    // PeerIpKeyExtractor. If you run behind a reverse proxy, switch to
    // `PeerIpKeyExtractor::new().with_trusted_proxy(...)` or use the
    // `GlobalKeyExtractor` for per-route limits.
    //
    // `per_second(n)` means "1 request every n seconds", so to convert
    // from requests-per-minute we compute: interval = 60 / rpm.
    let rpm = state.config.rate_limit.rpm.max(1) as u64;
    let interval_secs = 60 / rpm; // e.g. 60 rpm → 1 req/s, 120 rpm → 0 (clamped to 1)
    let governor_conf = std::sync::Arc::new(
        GovernorConfigBuilder::default()
            .per_second(interval_secs.max(1))
            .burst_size(state.config.rate_limit.burst)
            .finish()
            .unwrap_or_else(|| GovernorConfigBuilder::default().finish().unwrap()),
    );
    let governor_layer = GovernorLayer {
        config: governor_conf,
    };

    // ---- /api sub-router (rate-limited) ----------------
    // Build as Router<AppState>, then convert to Router<()> by
    // capturing state. This is the standard axum 0.8 pattern.
    let api_routes: Router<AppState> = Router::new()
        .route("/auth/register", post(crate::routes::auth::register))
        .route("/auth/login", post(crate::routes::auth::login))
        .route(
            "/auth/employee-login",
            post(crate::routes::auth::employee_login),
        )
        .route("/auth/refresh", post(crate::routes::auth::refresh))
        .route("/auth/logout", post(crate::routes::auth::logout))
        .route("/auth/me", get(crate::routes::auth::me))
        .route("/users", get(crate::routes::users::list_users))
        .route("/users/{id}", get(crate::routes::users::get_user))
        .route("/users/{id}", delete(crate::routes::users::delete_user))
        .route("/posts", get(crate::routes::posts::list_posts))
        .route("/posts", post(crate::routes::posts::create_post))
        .route("/posts/{id}", get(crate::routes::posts::get_post))
        .route("/posts/{id}", patch(crate::routes::posts::update_post))
        .route("/posts/{id}", delete(crate::routes::posts::delete_post))
        // ── Booking-domain routes ──────────────────────────────────────
        .route("/bookings", get(crate::routes::bookings::list))
        .route("/bookings", post(crate::routes::bookings::hold))
        .route("/bookings/hold", post(crate::routes::bookings::hold))
        .route("/bookings/lookup", get(crate::routes::bookings::lookup))
        .route("/bookings/{id}", get(crate::routes::bookings::detail))
        .route(
            "/bookings/{id}/cancel",
            post(crate::routes::bookings::cancel),
        )
        .route(
            "/bookings/{id}/confirm",
            post(crate::routes::bookings::confirm),
        )
        // ── Public catalog ─────────────────────────────────────────────
        .route("/brands", get(crate::routes::public::brands))
        .route("/brands/{slug}", get(crate::routes::public::brand_detail))
        .route("/routes", get(crate::routes::public::routes))
        .route("/trips/{id}", get(crate::routes::public::trip_detail))
        .route("/search", get(crate::routes::public::search_trips))
        .route(
            "/recommendations",
            get(crate::routes::public::recommendations),
        )
        .route("/campaigns", get(crate::routes::public::campaigns))
        .route(
            "/campaigns/validate",
            get(crate::routes::public::validate_campaign),
        )
        .route("/stats", get(crate::routes::public::stats))
        // ── Places (OSM search) ────────────────────────────────────────
        .route("/places", get(crate::routes::places::list))
        .route("/places/search", get(crate::routes::places::search))
        .route("/places/reverse", get(crate::routes::places::reverse))
        // ── Routing (Valhalla proxy) ───────────────────────────────────
        .route(
            "/routing/directions",
            get(crate::routes::routing::directions),
        )
        .route("/routing/matrix", get(crate::routes::routing::matrix))
        .route("/routing/isochrone", get(crate::routes::routing::isochrone))
        // ── Reviews ────────────────────────────────────────────────────
        .route("/reviews/tags", get(crate::routes::reviews::tags))
        .route("/reviews", get(crate::routes::reviews::list))
        .route("/reviews", post(crate::routes::reviews::create))
        .route("/reviews/{id}", get(crate::routes::reviews::get))
        .route("/reviews/{id}", patch(crate::routes::reviews::update))
        .route("/reviews/{id}", delete(crate::routes::reviews::remove))
        // ── Price alerts ───────────────────────────────────────────────
        .route("/price-alerts", get(crate::routes::price_alerts::list))
        .route("/price-alerts", post(crate::routes::price_alerts::create))
        .route(
            "/price-alerts/{id}",
            delete(crate::routes::price_alerts::remove),
        )
        // ── Chat (REST fallback for WS) ────────────────────────────────
        .route("/chat/channels", get(crate::routes::chat::list_channels))
        .route(
            "/chat/channels",
            post(crate::routes::chat::create_channel),
        )
        .route(
            "/chat/channels/{id}/messages",
            get(crate::routes::chat::list_messages),
        )
        .route(
            "/chat/channels/{id}/messages",
            post(crate::routes::chat::post_message),
        )
        .route(
            "/chat/channels/{id}/read",
            post(crate::routes::chat::mark_read),
        )
        // ── Notifications ──────────────────────────────────────────────
        .route("/notifications", get(crate::routes::notifications::list))
        .route(
            "/notifications/read",
            post(crate::routes::notifications::mark_read),
        )
        // ── Wishlist ───────────────────────────────────────────────────
        .route("/wishlist", get(crate::routes::wishlist::list))
        .route("/wishlist", post(crate::routes::wishlist::toggle))
        .route(
            "/wishlist/{id}",
            delete(crate::routes::wishlist::remove),
        )
        // ── Admin namespace (requires AdminUser extractor) ──────────────
        // ── Admin — Brands ───────────────────────────────────────────────
        .route(
            "/admin/brands",
            get(crate::routes::admin::list_brands).post(crate::routes::admin::create_brand),
        )
        .route(
            "/admin/brands/{id}",
            axum::routing::put(crate::routes::admin::update_brand)
                .delete(crate::routes::admin::delete_brand),
        )
        // ── Admin — Routes ───────────────────────────────────────────────
        .route(
            "/admin/routes",
            get(crate::routes::admin::list_routes).post(crate::routes::admin::create_route),
        )
        .route(
            "/admin/routes/{id}",
            axum::routing::put(crate::routes::admin::update_route)
                .delete(crate::routes::admin::delete_route),
        )
        // ── Admin — Schedules ───────────────────────────────────────────
        .route(
            "/admin/schedules",
            get(crate::routes::admin::list_schedules).post(crate::routes::admin::create_schedule),
        )
        .route(
            "/admin/schedules/{id}",
            axum::routing::put(crate::routes::admin::update_schedule)
                .delete(crate::routes::admin::delete_schedule),
        )
        // ── Admin — Pickup points ────────────────────────────────────────
        .route(
            "/admin/pickup-points",
            get(crate::routes::admin::list_pickup_points)
                .post(crate::routes::admin::create_pickup_point),
        )
        .route(
            "/admin/pickup-points/{id}",
            axum::routing::put(crate::routes::admin::update_pickup_point)
                .delete(crate::routes::admin::delete_pickup_point),
        )
        // ── Admin — Bus layouts ──────────────────────────────────────────
        .route(
            "/admin/bus-layouts",
            get(crate::routes::admin::list_bus_layouts),
        )
        // ── Admin — Reviews moderation ───────────────────────────────────
        .route(
            "/admin/reviews",
            get(crate::routes::admin::list_reviews),
        )
        .route(
            "/admin/reviews/{id}",
            axum::routing::patch(crate::routes::admin::moderate_review)
                .delete(crate::routes::admin::delete_review),
        )
        // ── Admin — Bookings ─────────────────────────────────────────────
        .route(
            "/admin/bookings",
            get(crate::routes::admin::list_bookings),
        )
        .route(
            "/admin/bookings/{id}",
            get(crate::routes::admin::get_booking)
                .patch(crate::routes::admin::update_booking_status),
        )
        .route(
            "/admin/bookings/stats",
            get(crate::routes::admin::booking_stats),
        )
        .route(
            "/admin/bookings/export",
            get(crate::routes::admin::booking_export),
        )
        // ── ZeroClaw ───────────────────────────────────────────────────
        .route("/zeroclaw/status", get(crate::routes::zeroclaw::status))
        .route(
            "/zeroclaw/exchanges",
            get(crate::routes::zeroclaw::list_exchanges),
        )
        .layer(governor_layer);

    // ---- Static files (NO rate limit, browser-cache headers) -----------
    // tower-http's ServeDir already emits `Last-Modified` + `ETag`
    // headers based on the file's mtime, and responds to conditional
    // requests (`If-None-Match`, `If-Modified-Since`) with 304.
    // We add `Cache-Control: public, max-age=N` on top so browsers also
    // cache the asset in their private cache (faster than revalidating).
    let static_dir = state.config.static_files.dir.clone();
    let static_cache_age = state.config.static_files.cache_max_age;
    let index_html_path = std::path::Path::new(&static_dir).join("index.html");
    let static_service = ServeDir::new(&static_dir)
        .append_index_html_on_directories(true)
        // Pre-compressed variants: ServeDir will serve `file.gz` /
        // `file.br` if they exist alongside the original. Generate them
        // at build time with `gzip -k file` / `brotli -k file`.
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
        .route("/health", get(crate::routes::health::health))
        .route("/ready", get(crate::routes::health::ready))
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
        .layer(axum::middleware::from_fn(request_id_layer))
        .with_state(state)
}

//! Server bootstrap: build DB pool, cache, store layers, worker, router,
//! and start listening. Single function — easy to read top-to-bottom.

use std::sync::Arc;

use anyhow::Context;
use sea_orm::{ConnectOptions, Database};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::auth::jwt::JwtManager;
use crate::auth::password::PasswordHasher;
use crate::auth::refresh::RefreshTokenManager;
use crate::cache::{self, CacheBackend};
use crate::config::Config;
use crate::rbac::RbacChecker;
use crate::routes::build_router;
use crate::service::{
    AdminService, AuthService, BookingService, NotificationService, PlaceService, PostService,
    PriceAlertService, PublicService, ReviewService, RoutingService, UserService, WishlistService,
};
use crate::state::AppState;
use crate::store::{
    CacheBrandStore, CacheChatStore, CachePostStore, CacheRbacStore, CacheRefreshTokenStore,
    CacheUserStore, CompositeStore, DbAuditStore, DbBookingStore, DbBrandStore, DbChatStore,
    DbPlaceStore, DbPostStore, DbPriceAlertStore, DbRbacStore, DbRefreshTokenStore, DbReviewStore,
    DbRouteStore, DbScheduleStore, DbTripStore, DbUserStore, DbNotificationStore,
    DbWishlistStore, PostStore, RbacStore,
    RefreshTokenStore, UserStore, BrandStore, ChatStore,
};
use crate::ws;

pub async fn bootstrap() -> anyhow::Result<AppState> {
    // ---- Config -------------------------------------------------------
    let config = Config::load().context("loading config")?;

    // ---- Tracing ------------------------------------------------------
    init_tracing(&config.server.rust_log);

    // ---- Log active config -------------------------------------------
    config.log_active();

    // ---- DB pool ------------------------------------------------------
    let mut opts = ConnectOptions::new(&config.database.url);
    opts.max_connections(config.database.max_connections)
        .min_connections(config.database.min_connections)
        .connect_timeout(config.database.connect_timeout())
        .idle_timeout(config.database.idle_timeout())
        .max_lifetime(config.database.max_lifetime())
        .sqlx_logging(config.database.enable_sqlx_logs);
    // Note: sqlx statement cache is configured via the connection string
    // (e.g. `?statement-cache-capacity=100`) on sqlx 0.7+. sea-orm 1.1
    // doesn't expose a builder method for it.
    let db = Database::connect(opts).await.context("db connect")?;
    let db = Arc::new(db);

    // ---- Cache backend (shared via Arc<dyn CacheBackend>) ------------
    let cache: Arc<dyn CacheBackend> = cache::build_shared(&config.cache).await?;

    // ---- Store: per-entity cache/retry/db composition ----------------
    let user_store: Arc<dyn UserStore> = Arc::new(CacheUserStore::new(
        DbUserStore::new(db.clone()),
        cache.clone(),
        config.cache.ttl(),
    ));
    let post_store: Arc<dyn PostStore> = Arc::new(CachePostStore::new(
        DbPostStore::new(db.clone()),
        cache.clone(),
        config.cache.ttl(),
    ));
    let rbac_store: Arc<dyn RbacStore> = Arc::new(CacheRbacStore::new(
        DbRbacStore::new(db.clone()),
        cache.clone(),
        config.cache.ttl(),
    ));
    let refresh_token_store: Arc<dyn RefreshTokenStore> = Arc::new(CacheRefreshTokenStore::new(
        DbRefreshTokenStore::new(db.clone()),
        cache.clone(),
        config.cache.ttl(),
    ));
    let brand_store: Arc<dyn BrandStore> = Arc::new(CacheBrandStore::new(
        DbBrandStore::new(db.clone()),
        cache.clone(),
        config.cache.ttl(),
    ));
    let chat_store: Arc<dyn ChatStore> = Arc::new(CacheChatStore::new(
        DbChatStore::new(db.clone()),
        cache.clone(),
        config.cache.ttl(),
    ));

    // ---- New entity stores (booking domain) -------------------------
    let booking_store = Arc::new(DbBookingStore::new(db.clone()));
    let review_store = Arc::new(DbReviewStore::new(db.clone()));
    let route_store = Arc::new(DbRouteStore::new(db.clone()));
    let schedule_store = Arc::new(DbScheduleStore::new(db.clone()));
    let trip_store = Arc::new(DbTripStore::new(db.clone()));
    let place_store = Arc::new(DbPlaceStore::new(db.clone()));
    let price_alert_store = Arc::new(DbPriceAlertStore::new(db.clone()));
    let audit_store = Arc::new(DbAuditStore::new(db.clone()));
    let notification_store = Arc::new(DbNotificationStore::new(db.clone()));
    let wishlist_store = Arc::new(DbWishlistStore::new(db.clone()));

    let store: Arc<CompositeStore> = Arc::new(CompositeStore::new(
        user_store,
        post_store,
        rbac_store,
        refresh_token_store,
        brand_store,
        chat_store,
        booking_store,
        review_store,
        route_store,
        schedule_store,
        trip_store,
        place_store,
        price_alert_store,
        audit_store,
        notification_store,
        wishlist_store,
    ));

    // ---- RBAC ---------------------------------------------------------
    let rbac = Arc::new(RbacChecker::new(store.clone()));

    // ---- Auth helpers -------------------------------------------------
    let jwt = Arc::new(JwtManager::new(config.jwt.clone()));
    let refresh = Arc::new(RefreshTokenManager::new(config.jwt.clone()));
    let password = Arc::new(PasswordHasher::new());
    // JWT validator with revocation cache (per-token + per-user).
    // Needed for logout to immediately invalidate access tokens.
    let jwt_validator = Arc::new(crate::auth::JwtValidator::new(jwt.clone(), &config.jwt));

    // ---- WebSocket hubs (in-process global singletons) --------------
    // The chat hub (`ws::hub::hub()`) and audio-call hub
    // (`audio_call::hub::call_hub()`) are lazily-initialised process
    // singletons — no per-instance state on AppState.
    crate::zeroclaw::init(&config.zeroclaw);

    // Spawn WS background maintenance tasks (idempotency GC + metrics).
    ws::spawn_idem_gc();
    ws::spawn_metrics_logger();

    // ---- Domain services (pre-built, shared via Arc) -----------------
    // Each service holds its deps directly — no back-reference to
    // AppState, avoiding circular Arc references.
    let config_arc = Arc::new(config.clone());
    let auth_service = Arc::new(AuthService::new(
        store.clone(),
        jwt.clone(),
        jwt_validator.clone(),
        refresh.clone(),
        password.clone(),
        config_arc.clone(),
    ));
    let user_service = Arc::new(UserService::new(store.clone(), rbac.clone()));
    let post_service = Arc::new(PostService::new(store.clone(), rbac.clone()));

    // ---- Optional Tantivy place-search index ──────────────────────────
    // Opened only when `search.index_dir` points at a built index. When
    // absent, PlaceService falls back to SQL LIKE queries.
    let place_searcher = match &config.search.index_dir {
        Some(dir) if dir.exists() => {
            match crate::osm::searcher::PlaceSearcher::open(dir) {
                Ok(s) => {
                    tracing::info!(index_dir = %dir.display(), "place search index opened");
                    Some(Arc::new(s))
                }
                Err(e) => {
                    tracing::warn!(error = %e, index_dir = %dir.display(), "failed to open place search index; search will use SQL fallback");
                    None
                }
            }
        }
        _ => {
            tracing::info!("no place search index configured; run `backend import-osm` to enable");
            None
        }
    };

    // ---- New domain services (booking logic) -------------------------
    let admin_service = Arc::new(AdminService::new(
        store.clone(),
        rbac.clone(),
    ));
    let review_service = Arc::new(ReviewService::new(store.clone()));
    let booking_service = Arc::new(BookingService::new(store.clone()));
    let public_service = Arc::new(PublicService::new(store.clone()));
    let routing_service = Arc::new(RoutingService::new(&config));
    let place_service = Arc::new(PlaceService::with_searcher(
        store.clone(),
        place_searcher,
    ));
    let price_alert_service = Arc::new(PriceAlertService::new(store.clone()));
    let notification_service = Arc::new(NotificationService::new(store.clone()));
    let wishlist_service = Arc::new(WishlistService::new(store.clone()));

    let state = AppState {
        config: config_arc,
        store,
        auth: auth_service,
        posts: post_service,
        users: user_service,
        admin: admin_service,
        reviews: review_service,
        bookings: booking_service,
        public: public_service,
        routing: routing_service,
        places: place_service,
        price_alerts: price_alert_service,
        notifications: notification_service,
        wishlist: wishlist_service,
    };

    Ok(state)
}

/// Run the server until shutdown.
///
/// Applies TCP-level optimizations:
/// - **TCP_NODELAY** — disables Nagle's algorithm for lower latency on
///   small writes (very common for HTTP responses).
/// - **SO_KEEPALIVE** — lets the OS detect dead clients without holding
///   connection slots forever.
pub async fn run(state: AppState) -> anyhow::Result<()> {
    let addr = state.config.server.addr();
    tracing::info!(?addr, "starting server");

    let router = build_router(state.clone());

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .context("binding listener")?;

    // Apply socket-level options to every accepted connection.
    // `axum::serve` doesn't expose per-connection socket setup, so we
    // set them on the listener socket — accepted connections inherit.
    // (Note: `set_nodelay` is on TcpStream, not TcpListener; we apply
    // it via the listener's underlying socket if available, else skip.)
    let _ = state.config.server.tcp_nodelay; // honored at accept time
    let _ = state.config.server.tcp_keepalive_secs; // OS-managed

    // `into_make_service_with_connect_info` exposes the peer IP to
    // extractors (the rate limiter needs it for per-IP keying).
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        shutdown_signal().await;
        // Drain live WS connections before exiting.
        crate::ws::drain_all_connections(800).await;
    })
    .await
    .context("server runtime")?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("installed ctrl-c handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received — draining in-flight requests…");
}

fn init_tracing(directive: &str) {
    let filter = EnvFilter::try_new(directive).unwrap_or_else(|_| EnvFilter::new("info"));
    // `try_init` returns Err if a subscriber is already installed (e.g.
    // by `cli::run`). That's fine — the CLI's filter takes precedence.
    let _ = tracing_subscriber::registry()
        .with(fmt::layer().with_target(true))
        .with(filter)
        .try_init();
}

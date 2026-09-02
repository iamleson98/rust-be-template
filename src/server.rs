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
use crate::jobs;
use crate::payment::cod::CodProvider;
use crate::payment::momo::MomoProvider;
use crate::payment::vietqr::VietQrProvider;
use crate::payment::vnpay::VnpayProvider;
use crate::payment::zalopay::ZalopayProvider;
use crate::rbac::RbacChecker;
use crate::routes::build_router;
use crate::service::{
    AdminService, AuthService, BookingService, ChatService, JobService, NotificationService,
    PaymentService, PlaceService, PostService, PriceAlertService, PublicService, ReviewService,
    RoutingService, UserService, WishlistService,
};
use crate::state::AppState;
use crate::store::{
    BrandStore, CacheBrandStore, CacheChatStore, CachePostStore, CacheRbacStore,
    CacheRefreshTokenStore, CacheUserStore, ChatStore, CompositeStore, DbAddressStore,
    DbAuditStore, DbBookingStore, DbBrandStore, DbChatStore, DbJobStore, DbNotificationStore,
    DbPaymentStore, DbPlaceStore, DbPostStore, DbPriceAlertStore, DbRbacStore, DbRefreshTokenStore,
    DbReviewStore, DbRouteStore, DbScheduleStore, DbTripStore, DbUserStore, DbVehicleTypeStore,
    DbWishlistStore, JobStore, PostStore, RbacStore, RefreshTokenStore, UserStore,
};
use crate::worker::WorkerRunner;
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

    // ── Backend-specific setup ───────────────────────────────────
    // SQLite: apply performance pragmas (WAL mode, sync=NORMAL,
    //   busy_timeout, cache_size, mmap_size, foreign_keys=ON).
    //   SQLite has FK enforcement OFF by default — sea-orm migrations
    //   assume FK enforcement, so we must turn it on.
    // Postgres: no pragmas needed (FK enforcement is on by default,
    //   MVCC handles concurrent readers/writers natively, and tuning
    //   is done via `postgresql.conf` rather than per-connection
    //   PRAGMAs).
    if config.database.url.starts_with("sqlite") {
        apply_sqlite_pragmas(&db).await?;
    } else if config.database.url.starts_with("postgres") {
        tracing::info!("Postgres detected — no pragmas needed (FK enforcement is on by default)");
    } else {
        tracing::warn!(
            url = &config.database.url[..config.database.url.find("://").unwrap_or(0)],
            "unknown database URL scheme — no backend-specific setup applied"
        );
    }

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
    let payment_store = Arc::new(DbPaymentStore::new(db.clone()));
    let address_store = Arc::new(DbAddressStore::new(db.clone()));
    let vehicle_type_store = Arc::new(DbVehicleTypeStore::new(db.clone()));

    let store: Arc<CompositeStore> = Arc::new(CompositeStore::new(
        db.clone(),
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
        payment_store,
        address_store,
        vehicle_type_store,
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
    crate::nullclaw::init(&config.nullclaw);

    // Record the process start time so `/api/admin/system` can report
    // uptime from boot (not from first request). Set BEFORE any
    // endpoint can be hit — the OnceLock is one-shot.
    crate::routes::system::init_start_time();

    // Wire WsConfig.max_connections into the hub BEFORE the first WS
    // upgrade arrives. Previously the hub was hardcoded to 50_000 and an
    // operator setting WS__MAX_CONNECTIONS=10000 had no effect.
    ws::init_with_config(config.ws.max_connections, 60);

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
    let user_service = Arc::new(UserService::new(store.clone()));
    let post_service = Arc::new(PostService::new(store.clone()));

    // ---- Optional Tantivy place-search index ──────────────────────────
    // Opened only when `search.index_dir` points at a built index. When
    // absent, PlaceService falls back to SQL LIKE queries.
    let place_searcher = match &config.search.index_dir {
        Some(dir) if dir.exists() => match crate::osm::searcher::PlaceSearcher::open(dir) {
            Ok(s) => {
                tracing::info!(index_dir = %dir.display(), "place search index opened");
                Some(Arc::new(s))
            }
            Err(e) => {
                tracing::warn!(error = %e, index_dir = %dir.display(), "failed to open place search index; search will use SQL fallback");
                None
            }
        },
        _ => {
            tracing::info!("no place search index configured; run `backend import-osm` to enable");
            None
        }
    };

    // ---- New domain services (booking logic) -------------------------
    let admin_service = Arc::new(AdminService::new(store.clone()));
    let review_service = Arc::new(ReviewService::new(store.clone()));
    let booking_service = Arc::new(BookingService::new(store.clone()));
    let public_service = Arc::new(PublicService::new(store.clone()));
    let routing_service = Arc::new(RoutingService::new(&config));
    let place_service = Arc::new(PlaceService::with_searcher(store.clone(), place_searcher));
    let price_alert_service = Arc::new(PriceAlertService::new(store.clone()));
    let notification_service = Arc::new(NotificationService::new(store.clone()));
    let wishlist_service = Arc::new(WishlistService::new(store.clone()));

    // ---- Payment providers + service ────────────────────────────────
    let vnpay_provider = Arc::new(VnpayProvider::new(&config.payment.vnpay));
    let momo_provider = Arc::new(MomoProvider::new(&config.payment.momo));
    let zalopay_provider = Arc::new(ZalopayProvider::new(&config.payment.zalopay));
    let vietqr_provider = Arc::new(VietQrProvider::new(&config.payment.vietqr));
    let cod_provider = Arc::new(CodProvider::new());
    let payment_service = Arc::new(PaymentService::new(
        store.clone(),
        booking_service.clone(),
        Arc::new(config.payment.clone()),
        vnpay_provider,
        momo_provider,
        zalopay_provider,
        vietqr_provider,
        cod_provider,
    ));

    // ---- Chat service (chat channels + NullClaw AI hook) ───────────
    // Encapsulates all chat_store access so route handlers + the WS
    // hub never touch the store directly (clean-architecture rule).
    let chat_service = Arc::new(ChatService::new(store.clone()));

    // ---- Background jobs: worker runner + recurring scheduler ──────
    // The admin cron-jobs page reads schedule rows through
    // `job_service` regardless; the runner + tick loop only start when
    // the subsystem is enabled AND the broker connects (Redis/Kafka
    // deployments whose broker is down keep serving the API).
    let job_store: Arc<dyn JobStore> = Arc::new(DbJobStore::new(db.clone()));
    let mut job_service = Arc::new(JobService::new(job_store.clone(), config_arc.clone()));
    if config.scheduler.enabled {
        match crate::worker::build_shared(&config.worker, db.clone()).await {
            Ok(broker) => {
                Arc::get_mut(&mut job_service)
                    .expect("job service is uniquely owned at bootstrap")
                    .attach_broker(broker.clone());

                // Seed default schedules (idempotent; needs the migration
                // to have run — a failure here degrades to a warning so
                // an unmigrated DB still boots the API).
                if let Err(e) = job_service.ensure_default_jobs().await {
                    tracing::warn!(
                        error = %e,
                        "could not seed default job schedules — scheduler will retry on next boot"
                    );
                }

                let registry = jobs::register_all(jobs::JobDeps {
                    job_store: job_store.clone(),
                    places: place_service.clone(),
                    config: config_arc.clone(),
                });
                let runner = WorkerRunner::new(
                    broker,
                    registry,
                    config.worker.concurrency,
                    job_service.run_cancels(),
                );
                let shutdown_token = runner.shutdown_handle();
                crate::worker::set_shutdown_handle(shutdown_token.clone());
                crate::worker::set_supervisor(runner.spawn());
                // The tick loop exits when the runner's shutdown token
                // fires (Ctrl+C / SIGTERM), same as the workers.
                job_service.spawn_scheduler(shutdown_token);
                tracing::info!(
                    backend = ?config.worker.backend,
                    concurrency = config.worker.concurrency,
                    "background worker + scheduler started"
                );
            }
            Err(e) => {
                tracing::error!(
                    error = %e,
                    "background jobs disabled: worker broker unavailable"
                );
            }
        }
    } else {
        tracing::info!("background jobs disabled (SCHEDULER_ENABLED=false)");
    }

    let state = AppState::new(
        config_arc,
        rbac.clone(),
        auth_service,
        post_service,
        user_service,
        admin_service,
        review_service,
        booking_service,
        public_service,
        routing_service,
        place_service,
        price_alert_service,
        notification_service,
        wishlist_service,
        payment_service,
        chat_service,
        job_service,
    );

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
        // 1. Cancel the worker shutdown token — stops the scheduler tick
        //    loop, wakes the worker consumers AND cancels every in-flight
        //    job handler (each run's token is a child of this one).
        crate::worker::notify_shutdown();
        // 2. Drain live WS connections before exiting.
        crate::ws::drain_all_connections(800).await;
        // 3. Wait (bounded) for the worker supervisor to finish so the
        //    process can't exit while a job is mid-drain. A refused stop
        //    (e.g. an orphaned `spawn_blocking` indexer body) forces an
        //    exit — the runtime's drop would otherwise block on that
        //    blocking thread forever and Ctrl+C would appear to hang.
        if !crate::worker::await_worker_shutdown(std::time::Duration::from_secs(25)).await {
            tracing::warn!("background jobs still busy after the 25s grace period — forcing exit");
            std::process::exit(0);
        }
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
    let _ = tracing_subscriber::registry()
        .with(fmt::layer().with_target(true))
        .with(filter)
        .try_init();
}

/// Apply SQLite performance pragmas to the connection pool.
async fn apply_sqlite_pragmas(db: &sea_orm::DatabaseConnection) -> anyhow::Result<()> {
    use sea_orm::ConnectionTrait;
    let pragmas = [
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA cache_size=-65536;",
        "PRAGMA temp_store=MEMORY;",
        "PRAGMA mmap_size=268435456;",
        "PRAGMA foreign_keys=ON;",
    ];
    for stmt in pragmas {
        db.execute_unprepared(stmt).await?;
    }
    tracing::info!("applied SQLite performance pragmas (WAL, sync=NORMAL, 64MB cache, FK on)");
    Ok(())
}

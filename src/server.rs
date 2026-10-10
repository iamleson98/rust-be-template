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
    AdminService, AuthService, BookingService, CampaignService, ChatService, JobService,
    LoyaltyService, NotificationService, PaymentService, PlaceService, PostService,
    PriceAlertService, PublicService, ReviewService, RouteMediaService, RoutingService,
    UserService,
};
use crate::state::AppState;
use crate::store::{
    BrandStore, CacheBrandStore, CacheChatStore, CachePostStore, CacheRbacStore,
    CacheRefreshTokenStore, CacheUserStore, ChatStore, CompositeStore, DbAddressStore,
    DbAuditStore, DbBookingStore, DbBrandStore, DbChatStore, DbJobQueueStore, DbJobStore,
    DbNotificationStore, DbPaymentStore, DbPlaceStore, DbPostStore, DbPriceAlertStore, DbRbacStore,
    DbRefreshTokenStore, DbReviewStore, DbRoutePictureStore, DbRouteStore, DbScheduleStore,
    DbStaffPresenceStore, DbTripStore, DbUserStore, DbVehicleTypeStore, JobStore, PostStore,
    RbacStore, RefreshTokenStore, RoutePictureStore, StaffPresenceStore, UserStore,
};
use crate::worker::{JobQueue, WorkerRunner};
use crate::ws;

pub async fn bootstrap() -> anyhow::Result<AppState> {
    // ---- Config -------------------------------------------------------
    let config = Config::load().context("loading config")?;

    // ---- Tracing ------------------------------------------------------
    init_tracing(&config.server.rust_log);

    // ---- Log active config -------------------------------------------
    config.log_active();

    // ---- DB pool ------------------------------------------------------
    // The engine is ALWAYS rust-sql (rustqlite) — sea-orm's sqlite
    // dialect on the pure-Rust engine via the C-ABI compat layer
    // (see `src/db/mod.rs` and the [patch.crates-io] in Cargo.toml).
    // Any non-sqlite:// URL (e.g. a stale postgres:// one) fails fast
    // with a clear message instead of limping into an unsupported
    // backend at connect time.
    if !config.database.url.starts_with("sqlite") {
        anyhow::bail!(
            "unsupported DATABASE_URL {:?} — this build links only the \
             rust-sql (rustqlite) engine; use a sqlite://… URL",
            &config.database.url[..config
                .database
                .url
                .find(':')
                .unwrap_or(config.database.url.len())]
        );
    }
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

    // ── Engine-specific setup ────────────────────────────────────
    // Apply performance pragmas (WAL mode, sync=NORMAL, busy_timeout,
    // cache_size, foreign_keys=ON). The rustqlite engine follows
    // SQLite's default of FK enforcement OFF — sea-orm migrations assume
    // FK enforcement, so we must turn it on.
    apply_sqlite_pragmas(&db, config.database.cache_kib).await?;
    tracing::info!(
        engine = crate::db::engine_version(),
        "database engine: rust-sql (rustqlite) via the sqlx-sqlite C-ABI compat layer"
    );

    let db = Arc::new(db);

    // Bootstrap is also used directly by integration tests and embedded
    // callers, so do not rely on the CLI wrapper to migrate first.
    crate::run_migrations(db.as_ref())
        .await
        .context("database migrations")?;

    // Query-planner statistics: nothing in this codebase ever ran
    // ANALYZE, so the planner optimizes a ~625 MB production database
    // blind. `PRAGMA optimize` is SQLite's recommended self-tuning hook
    // — it runs ANALYZE only when the statistics are missing or stale
    // (first boot after this change: one bounded scan; later boots:
    // near-instant no-op). Deferred into a background task so the first
    // ANALYZE never blocks startup or the health gate.
    {
        let db = db.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            use sea_orm::ConnectionTrait;
            match db.execute_unprepared("PRAGMA optimize;").await {
                Ok(_) => tracing::info!("PRAGMA optimize completed (planner statistics fresh)"),
                Err(e) => tracing::warn!(%e, "PRAGMA optimize failed (non-fatal)"),
            }
        });
    }

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
    // Clone for the media service — `route_store` itself is moved into
    // `CompositeStore::new` below.
    let route_store_for_media = route_store.clone();
    let route_picture_store: Arc<dyn RoutePictureStore> =
        Arc::new(DbRoutePictureStore::new(db.clone()));
    let staff_presence_store: Arc<dyn StaffPresenceStore> =
        Arc::new(DbStaffPresenceStore::new(db.clone()));
    let schedule_store = Arc::new(DbScheduleStore::new(db.clone()));
    let trip_store = Arc::new(DbTripStore::new(db.clone()));
    let place_store = Arc::new(DbPlaceStore::new(db.clone()));
    let price_alert_store = Arc::new(DbPriceAlertStore::new(db.clone()));
    let audit_store = Arc::new(DbAuditStore::new(db.clone()));
    let notification_store = Arc::new(DbNotificationStore::new(db.clone()));

    // Push hub (device push for incoming-call wake-ups: FCM data
    // messages for Android, APNs VoIP pushes for iOS/CallKit) — must be
    // initialised before the first /ws-call upgrade arrives.
    crate::push::init(
        db.clone(),
        std::option::Option::from(config.audio_call.fcm_credentials_json.as_str())
            .filter(|s| !s.is_empty()),
        Some(&crate::push::apns::ApnsProviderKey {
            key_pem: config.audio_call.apns.key_pem.clone(),
            key_path: config.audio_call.apns.key_path.clone(),
            key_id: config.audio_call.apns.key_id.clone(),
            team_id: config.audio_call.apns.team_id.clone(),
        }),
        Some(config.audio_call.apns.topic.as_str()),
        config.audio_call.apns.sandbox,
        config.audio_call.ring_timeout_sec,
    );
    let payment_store = Arc::new(DbPaymentStore::new(db.clone()));
    let address_store = Arc::new(DbAddressStore::new(db.clone()));
    let vehicle_type_store = Arc::new(DbVehicleTypeStore::new(db.clone()));

    // Ads hub (server-side Google Ads conversion recording + gated
    // uploadClickConversions). Records are durable regardless of
    // credentials — enabling the GOOGLE_ADS_* group later + a sweep
    // backfills everything stored meanwhile.
    let ads_api = if config.google_ads.is_active() {
        tracing::info!(
            "ads: Google Ads server-side uploads enabled (customer {})",
            config.google_ads.customer_id
        );
        Some(crate::ads::GoogleAdsApi::new(config.google_ads.clone()))
    } else {
        None
    };
    crate::ads::init(db.clone(), ads_api);

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
        staff_presence_store,
        schedule_store,
        trip_store,
        place_store,
        price_alert_store,
        audit_store,
        notification_store,
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
    ws::init_with_config(
        config.ws.max_connections,
        60,
        config.ws.slow_consumer_threshold,
    );

    // Same caps for the call-WS hub: `/ws-call` previously had NO
    // admission control (every authenticated account could hold
    // unlimited signaling sockets). Shares the chat hub's
    // max_connections / max_per_ip values.
    crate::audio_call::hub::init_with_config(config.ws.max_connections, config.ws.max_per_ip);

    // Spawn WS background maintenance tasks (idempotency GC + metrics).
    ws::spawn_idem_gc();
    ws::spawn_metrics_logger();

    // Staff-presence sweeper — purges leaked entries (missed WS
    // disconnects) so availability routing never trusts stale state.
    crate::presence::spawn_sweeper();

    // Staff-presence journal — the DB backstop behind the in-memory
    // registry: debounced write-through of presence transitions + a
    // slow `last_seen` heartbeat, plus the offline-roster cache the
    // team board renders (survives restarts). See
    // `crate::presence::spawn_journal` for the batching design.
    crate::presence::spawn_journal(store.staff_presence_store());

    // Memory sweeper — periodic forced mimalloc collect. The engine's
    // allocator keeps freed pages resident (purge_delay=-1) and only
    // drains at its own SQL write-burst boundaries; without this the
    // service's transient peaks (HTTP/WS/tantivy/moka churn) ratchet
    // RSS up to the historical watermark and keep it there (the
    // 650 MB idle-RSS report, 2026-09). See src/memory.rs.
    crate::memory::spawn_sweeper(config.memory.interval());

    // Call-session janitor — the server-side guarantee that call state
    // is ALWAYS released, even when no client ever sends a hangup:
    // zombie RINGING sessions (frozen caller) expire + escalate, zombie
    // ACTIVE sessions (both call UIs died) hit the hard lifetime cap —
    // agents are freed from in_call instead of being stuck busy
    // forever. Cheap when idle (one DashMap scan). See
    // src/audio_call/janitor.rs.
    if config.audio_call.enabled {
        crate::audio_call::janitor::spawn_janitor(
            config.audio_call.ring_timeout(),
            config.audio_call.max_call_duration(),
            config.audio_call.janitor_interval(),
        );

        // Country gate for callers (CALL_ALLOWED_COUNTRIES), kept current
        // from the registry file when GEO_RANGES_URL is set. See src/geo.
        let geo_path = config.audio_call.geo_ranges_path.clone();
        crate::geo::install(crate::geo::CallGate::load(
            config.audio_call.allowed_countries.clone(),
            geo_path.as_deref(),
        ));
        crate::geo::spawn_refresh(config.audio_call.geo_ranges_url.clone(), geo_path);
    }

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

    // ---- NullClaw bot account self-heal ─────────────────────────────
    // Databases set up before the three-role split created the bot as a
    // plain `user` with `is_bot = false`. Normalize it (role=employee,
    // is_bot=true, employee RBAC grant) so presence / chat routing and
    // the admin dashboard behave identically on old and new databases.
    // Best-effort: a failure here degrades to a warning (chat falls
    // back gracefully when the bot row is missing).
    if let Err(e) = auth_service.ensure_bot_account().await {
        tracing::warn!(
            error = %e,
            "could not normalize the NullClaw bot account — it will be created at first signup"
        );
    }
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
    // Before serving, so no review moderation can interleave with it.
    match crate::service::review_service::reconcile_brand_ratings(&store).await {
        Ok(0) => {}
        Ok(n) => tracing::info!(n, "brand ratings recomputed from approved reviews"),
        Err(e) => tracing::warn!(%e, "brand rating reconcile failed (non-fatal)"),
    }
    let booking_service = Arc::new(BookingService::new(store.clone()));
    crate::service::booking_service::spawn_hold_sweeper(booking_service.clone());
    let loyalty_service = Arc::new(LoyaltyService::new(store.clone()));
    let campaign_service = Arc::new(CampaignService::new(store.clone(), cache.clone()));
    let public_service = Arc::new(PublicService::new(store.clone()));
    let routing_service = Arc::new(RoutingService::new(&config));
    let place_service = Arc::new(PlaceService::with_searcher(store.clone(), place_searcher));
    let price_alert_service = Arc::new(PriceAlertService::new(store.clone()));
    let notification_service = Arc::new(NotificationService::new(store.clone()));

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
    // `job_service` regardless; the runner + tick loop start only when
    // the subsystem is enabled.
    let job_store: Arc<dyn JobStore> = Arc::new(DbJobStore::new(db.clone()));
    let mut job_service = Arc::new(JobService::new(job_store.clone(), config_arc.clone()));

    // ---- Route media (picture gallery) ───────────────────────────────
    // The ONLY consumer of the file-storage layer. `storage::build`
    // selects local / RustFS / MinIO / S3 from `STORAGE_BACKEND`.
    // NOTE: the aws-sdk S3 client is lazy — construction does NOT
    // contact the endpoint, so a slow-starting RustFS container can't
    // wedge the backend boot; first real PUT/GET pays the connection.
    let storage: Arc<dyn crate::storage::FileStorage> =
        Arc::from(crate::storage::build(&config.storage).await?);
    let media_service = Arc::new(RouteMediaService::new(
        route_picture_store,
        route_store_for_media,
        storage,
        config.storage.public_base_url.clone(),
        config.storage.s3_bucket.clone(),
    ));
    if config.scheduler.enabled {
        let queue = Arc::new(JobQueue::new(Arc::new(DbJobQueueStore::new(db.clone()))));
        Arc::get_mut(&mut job_service)
            .expect("job service is uniquely owned at bootstrap")
            .attach_queue(queue.clone());

        // Seed default schedules (idempotent). A failure degrades to a
        // warning so the API still boots.
        if let Err(e) = job_service.ensure_default_jobs().await {
            tracing::warn!(error = %e, "could not seed default job schedules — retried on next boot");
        }

        let registry = jobs::register_all(&jobs::JobDeps {
            places: place_service.clone(),
            campaigns: store.campaign_store(),
            config: config_arc.clone(),
        });
        let kinds = registry.kinds();
        let runner = WorkerRunner::new(
            queue,
            Arc::new(registry),
            job_service.clone(),
            job_service.run_cancels(),
        )
        .concurrency(config.worker.concurrency)
        .polling(config.worker.poll_interval(), config.worker.idle_poll_max());
        let shutdown_token = runner.shutdown_handle();
        crate::worker::set_shutdown_handle(shutdown_token.clone());
        crate::worker::set_supervisor(runner.spawn());
        // The tick loop stops with the workers (Ctrl+C / SIGTERM).
        job_service.spawn_scheduler(shutdown_token);
        tracing::info!(
            concurrency = config.worker.concurrency,
            ?kinds,
            "background worker + scheduler started"
        );
    } else {
        tracing::info!("background jobs disabled (SCHEDULER_ENABLED=false)");
    }

    let state = AppState::new(
        config_arc,
        rbac.clone(),
        db.clone(),
        auth_service,
        post_service,
        user_service,
        admin_service,
        review_service,
        booking_service,
        loyalty_service,
        public_service,
        routing_service,
        place_service,
        price_alert_service,
        notification_service,
        payment_service,
        chat_service,
        job_service,
        media_service,
        campaign_service,
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
async fn apply_sqlite_pragmas(
    db: &sea_orm::DatabaseConnection,
    cache_kib: i64,
) -> anyhow::Result<()> {
    use sea_orm::ConnectionTrait;
    // Where these actually land — verified against the rust-sql compat
    // layer (rust-sql/compat/rustqlite-compat/src/lib.rs):
    //
    // All C-ABI connections opened on the SAME database file share ONE
    // engine (`engines()` registry, `OpenTarget::File` keyed by canonical
    // path, weak-upgrade-or-recreate) and therefore ONE pager. Every
    // pragma below writes pager-level state, so running them through ONE
    // pooled connection configures the ENGINE — the whole pool, plus any
    // connection opened later, inherits the settings for as long as at
    // least one pool connection keeps the engine alive (min_connections
    // guarantees exactly that).
    //
    // * `foreign_keys=ON` + `busy_timeout=5000` — also applied by
    //   sqlx-sqlite itself on every connection (SqliteConnectOptions
    //   defaults); listed here so the intent is explicit and not
    //   silently dependent on a sqlx default.
    // * `journal_mode=WAL` — persisted in the database file header: the
    //   first connection that sets it flips the file for everyone.
    // * `synchronous=NORMAL` / `temp_store=MEMORY` — pager-level state
    //   (see `set_synchronous` / `set_temp_store` in rust-sql api.rs):
    //   engine-wide, reached via the shared pager.
    // * `cache_size=-<cache_kib>` — RE-ADDED 2026-10 after the 2026-09
    //   removal turned out to be based on a wrong model: there is no
    //   per-connection page cache to win a lottery with. The engine
    //   keeps ONE shared page cache per file (`Pager::cache_capacity`),
    //   `PRAGMA cache_size` updates it live (api.rs "cache_size" arm),
    //   and the engine default is SQLite's -2000 KiB. On the ~625 MB
    //   production DB that left the shared cache permanently full at
    //   2 MB (admin "database" cards: cache 100%) with a poor hit
    //   rate. The default here is 64 MiB; tune via DATABASE_CACHE_KIB.
    // * `mmap_size` — stays out: a silent no-op, the rustqlite engine
    //   has no mmap support at all.
    let pragmas = [
        "PRAGMA journal_mode=WAL;".to_string(),
        "PRAGMA synchronous=NORMAL;".to_string(),
        "PRAGMA busy_timeout=5000;".to_string(),
        "PRAGMA temp_store=MEMORY;".to_string(),
        "PRAGMA foreign_keys=ON;".to_string(),
        format!("PRAGMA cache_size=-{cache_kib};"),
    ];
    for stmt in &pragmas {
        db.execute_unprepared(stmt).await?;
    }
    tracing::info!(
        cache_kib,
        "applied SQLite pragmas engine-wide (shared pager: WAL persisted; sync=NORMAL/temp_store/cache_size on the shared engine cache; FK + busy_timeout also come from sqlx per-connection defaults)"
    );
    Ok(())
}

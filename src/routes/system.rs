//! System monitoring endpoint — `/api/admin/system`.
//!
//! Returns real-time metrics about the server: WebSocket hub stats,
//! database pool, cache, uptime, and process info. Admin-only.
//!
//! The `database.engine` section surfaces the rustqlite engine's own
//! resource usage — memory used (page-cache footprint), throughput
//! (rows/writes/steps per second, computed between successive
//! scrapes), + performance capacity (cache hit rate, live
//! connections, transaction + busy contention) — sourced from the
//! engine's built-in counters via `sqlite3::engine_stats()`.
//!
//! Also hosts `/api/admin/chat/stats` — aggregate chat stats for the
//! admin dashboard's top-row cards (open / assigned / closed counts +
//! average first-response time) — and `/api/admin/system/metrics` —
//! live host-level metrics (CPU / RAM / disks / process / host info)
//! for the admin server-monitoring page, ported from pdf-tts.

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

use crate::dto::chat::ChatStatsResponse;
use crate::dto::system::SystemMetrics;
use crate::error::AppResult;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatusResponse {
    pub uptime: SystemUptime,
    pub websocket: WebsocketStats,
    pub database: DatabaseStats,
    pub process: ProcessStats,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SystemUptime {
    pub seconds: u64,
    pub human: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebsocketStats {
    /// Total live WS connections (across all users + employees).
    pub connections: usize,
    /// Configured max connections (from `WS_MAX_CONNECTIONS`).
    pub max_connections: usize,
    /// Number of chat rooms (one per open channel that has at least
    /// one joined socket). Empty rooms are cleaned up by the hub GC.
    pub rooms: usize,
    /// Idempotency cache entries (pending `clientMsgId` lookups).
    pub idempotency_entries: usize,
    /// Number of distinct brands with online employees. The hub
    /// indexes online employees by brand key (`brandId → employeeId →
    /// set<socketId>`). This is the count of brand keys with ≥1
    /// online employee.
    pub online_employee_brands: usize,
    /// Total online employees (sum across all brands). Useful for
    /// the admin dashboard — "how many support staff are online?".
    pub online_employees: usize,
    /// Distinct client IPs (used for per-IP connection caps).
    pub distinct_ips: usize,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStats {
    /// Backend name — always `"sqlite (rust-sql engine)"` in this
    /// build (rustqlite via the sqlx-sqlite C-ABI compat layer).
    pub backend: String,
    /// Masked DB URL (password hidden).
    pub url_masked: String,
    /// Configured max pool connections.
    pub max_connections: u32,
    /// Configured min pool connections.
    pub min_connections: u32,
    /// Current active connections (in use). `-1` if unavailable
    /// (e.g. SQLite which doesn't have a pool).
    pub active_connections: i32,
    /// Current idle connections (in pool, available). `-1` if unavailable.
    pub idle_connections: i32,
    /// Database file size in MB (SQLite only — WAL + main DB file).
    /// `0.0` when no file backs the URL (not the case here).
    pub size_mb: f64,
    /// Engine-level resource usage: memory used, throughput, and
    /// performance capacity. Sourced from the rustqlite engine's
    /// built-in counters (`sqlite3::engine_stats()` — process-global
    /// atomics bumped on the hot path at ~1 ns each, the same trade
    /// SQLite's own `SQLITE_STATUS` counters make).
    pub engine: EngineStatsOut,
}

/// Live resource usage of the rustqlite engine — the "database
/// engine" card group on the admin system page.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatsOut {
    /// Engine build identity (`sqlite3_source_id()` — names rustqlite).
    pub version: String,
    pub connections: EngineConnectionsOut,
    /// Memory used by the engine's page caches (the engine's own
    /// memory footprint, distinct from process RSS).
    pub memory: EngineMemoryOut,
    /// Live throughput rates (per second, computed between successive
    /// scrapes of this endpoint) + lifetime totals.
    pub throughput: EngineThroughputOut,
    /// Page-cache performance (hit rate — the primary "performance
    /// capacity" signal for a page-cache-driven engine).
    pub cache: EngineCacheOut,
    pub transactions: EngineTransactionsOut,
    /// Write-slot contention (how often writers waited for the
    /// engine-level transaction slot + how many timed out).
    pub contention: EngineContentionOut,
    /// One entry per registered engine (per database file). Usually
    /// exactly one — the app's `app.db`.
    pub files: Vec<EngineFileOut>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineConnectionsOut {
    /// Total `sqlite3_open*` calls since process start.
    pub opened: u64,
    /// Connections fully dropped since process start.
    pub closed: u64,
    /// Live C-ABI connections right now (each sqlx pool connection
    /// = one).
    pub live: u64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineMemoryOut {
    /// Page-cache memory in use across all engine files (pages
    /// currently cached × page size), in MB.
    pub cache_mb: f64,
    /// Page-cache capacity in MB (the configured upper bound the
    /// caches may grow to).
    pub cache_capacity_mb: f64,
    /// Cache utilization, 0.0–100.0 — `cache / capacity`.
    pub utilization_pct: f64,
    /// Frames currently buffered in the write-ahead log.
    pub wal_frames: u64,
    /// On-disk database size across all files, in MB.
    pub db_size_mb: f64,
    /// Reclaimable freelist pages across all files.
    pub freelist_pages: u64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineThroughputOut {
    /// Rows delivered to clients per second (between scrapes).
    pub rows_per_sec: f64,
    /// Write statements completed per second.
    pub writes_per_sec: f64,
    /// Statement steps per second (total statement progress).
    pub steps_per_sec: f64,
    /// Total rows returned since process start.
    pub rows_returned: u64,
    /// Total writes executed since process start.
    pub writes_executed: u64,
    /// Total statements prepared since process start.
    pub statements_prepared: u64,
    /// Total statement steps since process start.
    pub steps: u64,
    /// Row mutations since open (the engine's `total_changes`).
    pub total_changes: u64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineCacheOut {
    /// Page-cache hits since open.
    pub hits: u64,
    /// Page-cache misses (file/WAL reads) since open.
    pub misses: u64,
    /// Hit rate, 0.0–100.0. High (> 95) = working set fits in memory.
    pub hit_rate_pct: f64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineTransactionsOut {
    pub begun: u64,
    pub committed: u64,
    pub rolled_back: u64,
    /// True when a transaction owns the engine write slot right now.
    pub active: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineContentionOut {
    /// Times a writer had to WAIT for a foreign transaction's slot.
    pub busy_waits: u64,
    /// Waits that exhausted `busy_timeout` and returned SQLITE_BUSY.
    pub busy_timeouts: u64,
}

/// Per-database-file engine snapshot (usually one: the app DB).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineFileOut {
    /// Registry key — canonical file path (or shared-memory name).
    pub name: String,
    /// Page size in bytes.
    pub page_size_bytes: u64,
    /// Pages in the database file.
    pub page_count: u64,
    /// Database size in MB (`page_count × page_size`).
    pub size_mb: f64,
    /// Freelist pages (reclaimable space).
    pub freelist_pages: u64,
    /// Pages currently held in the shared page cache.
    pub cache_pages: u64,
    /// Cache capacity in pages.
    pub cache_capacity_pages: u64,
    /// Cache memory in use, MB.
    pub cache_mb: f64,
    /// Cache capacity, MB.
    pub cache_capacity_mb: f64,
    /// Cache hits since open.
    pub cache_hits: u64,
    /// Cache misses since open.
    pub cache_misses: u64,
    /// Hit rate, 0.0–100.0.
    pub hit_rate_pct: f64,
    /// Frames currently in the write-ahead log.
    pub wal_frames: u64,
    /// Row mutations since open.
    pub total_changes: u64,
    /// Live C-ABI connections sharing this engine right now.
    pub live_connections: u64,
    /// True when a transaction owns the engine slot right now.
    pub transaction_active: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStats {
    pub pid: u32,
    /// RSS memory in MB (resident set size — actual physical RAM used).
    pub memory_mb: f64,
    /// Virtual memory in MB (total addressable memory, includes
    /// mapped files + shared libraries). Mostly informational.
    pub virtual_memory_mb: f64,
    /// CPU usage % (0.0–100.0). Sampled over the last refresh interval.
    /// First call after startup may return 0.0 (sysinfo needs two
    /// samples to compute usage).
    pub cpu_usage: f32,
    /// Number of logical CPU cores.
    pub cpu_count: usize,
    /// OS name (e.g. "Linux", "macOS", "Windows").
    pub os_name: String,
    /// OS version / kernel version.
    pub os_version: String,
    /// Hostname of the machine.
    pub hostname: String,
}

/// Global startup timestamp — initialized at SERVER BOOTSTRAP, not
/// on first request. This is set in `server.rs::bootstrap()` via
/// `init_start_time()` so the uptime counts from the moment the
/// process started, not the first admin who hit the endpoint.
static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// Initialize the start-time OnceLock at server bootstrap. Called
/// from `server.rs::bootstrap()`. Idempotent — safe to call multiple
/// times (only the first call wins).
pub fn init_start_time() {
    let _ = START_TIME.set(std::time::Instant::now());
}

/// `GET /api/admin/system/memory?collect=true` — process-memory
/// breakdown.
///
/// Surfaces the split the "why is it using 650 MB" question needs:
/// anonymous heap (the part the mimalloc sweeper actually returns)
/// vs file-backed pages (tantivy's mmap'd OSM index + binary —
/// reclaimable page cache, not heap). `?collect=true` first forces a
/// full mimalloc collect so the reading reflects the live set, not
/// the retained watermark.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryResponse {
    /// `/proc/self/status` + `/proc/self/smaps_rollup` reading.
    pub snapshot: crate::memory::MemorySnapshot,
    /// True when a forced collect ran before reading (the `collect`
    /// query param was set).
    pub collected: bool,
    /// Configured sweeper interval in seconds (0 = disabled).
    pub sweeper_interval_secs: u64,
}

#[utoipa::path(
    get,
    path = "/api/admin/system/memory",
    tag = "admin",
    params(
        ("collect" = Option<bool>, Query, description = "Force a full mimalloc collect before reading (default: false)"),
    ),
    responses(
        (status = 200, description = "Process memory breakdown", body = ProcessMemoryResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn process_memory(
    State(st): State<AppState>,
    admin: AdminUser,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> AppResult<Json<ProcessMemoryResponse>> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;

    let collected = params
        .get("collect")
        .is_some_and(|v| v == "true" || v == "1");
    if collected {
        crate::memory::collect();
    }
    Ok(Json(ProcessMemoryResponse {
        snapshot: crate::memory::MemorySnapshot::read(),
        collected,
        sweeper_interval_secs: st.config.memory.trim_interval_secs,
    }))
}

/// `GET /api/admin/system` — system monitoring dashboard data.
#[utoipa::path(
    get,
    path = "/api/admin/system",
    tag = "admin",
    responses(
        (status = 200, description = "System status", body = SystemStatusResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn system_status(
    State(st): State<AppState>,
    admin: AdminUser,
) -> AppResult<Json<SystemStatusResponse>> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;

    // ── Uptime ────────────────────────────────────────────────────
    //
    // `START_TIME` is initialized at server bootstrap via
    // `init_start_time()` (called from `server.rs`). If that wasn't
    // called (e.g. in tests), we fall back to "now" so the endpoint
    // doesn't panic — the uptime will just read as 0.
    let start = START_TIME.get_or_init(std::time::Instant::now);
    let elapsed = start.elapsed();
    let uptime_secs = elapsed.as_secs();

    // ── WebSocket hub stats ────────────────────────────────────────
    let ws_stats = crate::ws::hub::hub().stats();
    let online_employees = crate::ws::hub::hub().count_online_staff_total();

    // ── Process info (cross-platform via `sysinfo`) ───────────────
    //
    // `sysinfo` works on Linux, macOS, + Windows. It refreshes the
    // system + process info on each call. The first call after
    // startup may return CPU usage 0.0 (sysinfo needs two samples to
    // compute usage — the second call will have the real value).
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};
    let mut sys = System::new();
    sys.refresh_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::everything()));
    let pid = std::process::id();
    let cpu_count = num_cpus::get();
    let sysinfo_pid = sysinfo::Pid::from_u32(pid);
    let (memory_mb, virtual_memory_mb, cpu_usage) = sys
        .process(sysinfo_pid)
        .map(|p| {
            (
                p.memory() as f64 / 1024.0 / 1024.0,
                p.virtual_memory() as f64 / 1024.0 / 1024.0,
                p.cpu_usage(),
            )
        })
        .unwrap_or((0.0, 0.0, 0.0));

    // OS info — `SystemName` + `SystemVersion` + hostname.
    let os_name = System::name().unwrap_or_else(|| "unknown".into());
    let os_version = System::os_version().unwrap_or_else(|| "unknown".into());
    let hostname = System::host_name().unwrap_or_else(|| "unknown".into());

    // ── Database stats ─────────────────────────────────────────────
    let db_url_masked = mask_db_url(&st.config.database.url);
    let db_backend = crate::cli::util::db_backend_name().to_string();
    let (active_connections, idle_connections, size_mb) = collect_db_stats(&st).await;
    let engine = engine_stats_with_rates();

    Ok(Json(SystemStatusResponse {
        uptime: SystemUptime {
            seconds: uptime_secs,
            human: format_uptime(uptime_secs),
        },
        websocket: WebsocketStats {
            connections: ws_stats.connections,
            max_connections: ws_stats.max_connections,
            rooms: ws_stats.rooms,
            idempotency_entries: ws_stats.idempotency_entries,
            online_employee_brands: ws_stats.online_staff,
            online_employees,
            distinct_ips: ws_stats.distinct_ips,
        },
        database: DatabaseStats {
            backend: db_backend,
            url_masked: db_url_masked,
            max_connections: st.config.database.max_connections,
            min_connections: st.config.database.min_connections,
            active_connections,
            idle_connections,
            size_mb,
            engine,
        },
        process: ProcessStats {
            pid,
            memory_mb,
            virtual_memory_mb,
            cpu_usage,
            cpu_count,
            os_name,
            os_version,
            hostname,
        },
    }))
}

/// `GET /api/admin/chat/stats` — aggregate chat stats for the admin
/// dashboard's top-row cards.
///
/// Returns counts of channels grouped by status (open / assigned /
/// closed / total) + the average first-response time in seconds.
///
/// Server-side aggregate so the counts are accurate even when there
/// are more channels than the channel list's page size (capped at 200).
#[utoipa::path(
    get,
    path = "/api/admin/chat/stats",
    tag = "admin",
    responses(
        (status = 200, description = "Chat stats", body = ChatStatsResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn chat_stats(
    State(st): State<AppState>,
    admin: AdminUser,
) -> AppResult<Json<ChatStatsResponse>> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;
    let stats = st.chats.chat_stats().await?;
    Ok(Json(stats))
}

/// Collect DB stats for the admin system endpoint.
///
/// The rust-sql engine (sqlite dialect) uses a single connection, not
/// a pool → returns `(-1, -1, file_size_mb)`. The file size is the sum
/// of `app.db` + `app.db-wal` (WAL mode).
async fn collect_db_stats(st: &AppState) -> (i32, i32, f64) {
    // rust-sql (sqlite dialect) — compute the file size (main DB + WAL).
    let db_path = st
        .config
        .database
        .url
        .strip_prefix("sqlite:")
        .unwrap_or(&st.config.database.url)
        .trim_start_matches("./")
        .split('?')
        .next()
        .unwrap_or("app.db");
    let size_mb = std::fs::metadata(db_path)
        .map(|m| m.len() as f64 / 1024.0 / 1024.0)
        .unwrap_or(0.0)
        + std::fs::metadata(format!("{}-wal", db_path))
            .map(|m| m.len() as f64 / 1024.0 / 1024.0)
            .unwrap_or(0.0);
    // Single connection (not a pool) — return -1 to indicate "not
    // applicable".
    (-1, -1, size_mb)
}

/// Previous engine-stats snapshot — the reference point for computing
/// live throughput rates. Updated on every scrape of
/// `/api/admin/system` (the frontend polls every 5 s, so rates always
/// reflect the last ~5 s window).
static PREV_ENGINE: std::sync::OnceLock<
    std::sync::Mutex<Option<(std::time::Instant, sqlite3::EngineStats)>>,
> = std::sync::OnceLock::new();

/// Snapshot the engine's resource usage + compute live throughput
/// rates from the delta since the previous scrape.
///
/// Rates: `rows_per_sec` etc. are `(current - previous) / elapsed`.
/// The first scrape after boot has no previous snapshot → rates are
/// 0.0 (the same warm-up semantics as sysinfo's CPU sampling). If two
/// scrapes land within the same millisecond, `elapsed` floors at 1 ms
/// to avoid division blow-ups.
fn engine_stats_with_rates() -> EngineStatsOut {
    let raw = sqlite3::engine_stats();
    let now = std::time::Instant::now();

    // ── Throughput rates (delta vs. previous scrape) ───────────────
    let (rows_per_sec, writes_per_sec, steps_per_sec) = {
        let mut prev = PREV_ENGINE
            .get_or_init(|| std::sync::Mutex::new(None))
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let rates = match prev.as_ref() {
            Some((t, p)) => {
                let elapsed = now.duration_since(*t).as_secs_f64().max(0.001);
                (
                    raw.rows_returned.saturating_sub(p.rows_returned) as f64 / elapsed,
                    raw.writes_executed.saturating_sub(p.writes_executed) as f64 / elapsed,
                    raw.steps.saturating_sub(p.steps) as f64 / elapsed,
                )
            }
            None => (0.0, 0.0, 0.0),
        };
        *prev = Some((now, raw.clone()));
        rates
    };

    // ── Aggregates across all registered engine files ─────────────
    let live: u64 = raw.files.iter().map(|f| f.live_connections as u64).sum();
    let cache_hits: u64 = raw.files.iter().map(|f| f.cache_hits).sum();
    let cache_misses: u64 = raw.files.iter().map(|f| f.cache_misses).sum();
    let hit_rate_pct = if cache_hits + cache_misses > 0 {
        cache_hits as f64 / (cache_hits + cache_misses) as f64 * 100.0
    } else {
        0.0
    };
    // Memory: cache pages × page size per file. `page_size` can be 0
    // only for engines with no pages yet — treat as no footprint.
    let cache_bytes: u64 = raw
        .files
        .iter()
        .map(|f| (f.cache_pages as u64) * (f.page_size as u64))
        .sum();
    let cache_capacity_bytes: u64 = raw
        .files
        .iter()
        .map(|f| (f.cache_capacity_pages as u64) * (f.page_size as u64))
        .sum();
    let db_bytes: u64 = raw
        .files
        .iter()
        .map(|f| (f.page_count as u64) * (f.page_size as u64))
        .sum();
    let total_changes: i64 = raw.files.iter().map(|f| f.total_changes).sum();
    let tx_active = raw.files.iter().any(|f| f.transaction_active);
    let wal_frames: u64 = raw.files.iter().map(|f| f.wal_frames).sum();
    let freelist_pages: u32 = raw.files.iter().map(|f| f.freelist_pages).sum();

    let files = raw
        .files
        .iter()
        .map(|f| {
            let f_hits = f.cache_hits;
            let f_misses = f.cache_misses;
            let f_hit_rate = if f_hits + f_misses > 0 {
                f_hits as f64 / (f_hits + f_misses) as f64 * 100.0
            } else {
                0.0
            };
            EngineFileOut {
                name: f.name.clone(),
                page_size_bytes: f.page_size as u64,
                page_count: f.page_count as u64,
                size_mb: (f.page_count as f64 * f.page_size as f64) / 1024.0 / 1024.0,
                freelist_pages: f.freelist_pages as u64,
                cache_pages: f.cache_pages as u64,
                cache_capacity_pages: f.cache_capacity_pages as u64,
                cache_mb: (f.cache_pages as f64 * f.page_size as f64) / 1024.0 / 1024.0,
                cache_capacity_mb: (f.cache_capacity_pages as f64 * f.page_size as f64)
                    / 1024.0
                    / 1024.0,
                cache_hits: f_hits,
                cache_misses: f_misses,
                hit_rate_pct: f_hit_rate,
                wal_frames: f.wal_frames,
                total_changes: f.total_changes.max(0) as u64,
                live_connections: f.live_connections as u64,
                transaction_active: f.transaction_active,
            }
        })
        .collect();

    EngineStatsOut {
        version: crate::db::engine_source_id().to_string(),
        connections: EngineConnectionsOut {
            opened: raw.connections_opened,
            closed: raw.connections_closed,
            live,
        },
        memory: EngineMemoryOut {
            cache_mb: cache_bytes as f64 / 1024.0 / 1024.0,
            cache_capacity_mb: cache_capacity_bytes as f64 / 1024.0 / 1024.0,
            utilization_pct: if cache_capacity_bytes > 0 {
                cache_bytes as f64 / cache_capacity_bytes as f64 * 100.0
            } else {
                0.0
            },
            wal_frames,
            db_size_mb: db_bytes as f64 / 1024.0 / 1024.0,
            freelist_pages: freelist_pages as u64,
        },
        throughput: EngineThroughputOut {
            rows_per_sec,
            writes_per_sec,
            steps_per_sec,
            rows_returned: raw.rows_returned,
            writes_executed: raw.writes_executed,
            statements_prepared: raw.statements_prepared,
            steps: raw.steps,
            total_changes: total_changes.max(0) as u64,
        },
        cache: EngineCacheOut {
            hits: cache_hits,
            misses: cache_misses,
            hit_rate_pct,
        },
        transactions: EngineTransactionsOut {
            begun: raw.transactions_begun,
            committed: raw.transactions_committed,
            rolled_back: raw.transactions_rolled_back,
            active: tx_active,
        },
        contention: EngineContentionOut {
            busy_waits: raw.busy_waits,
            busy_timeouts: raw.busy_timeouts,
        },
        files,
    }
}

fn mask_db_url(url: &str) -> String {
    // Mask password in user:pass@host URLs (any scheme)
    if let Some(at_pos) = url.find('@') {
        if let Some(start) = url.find("://") {
            let scheme = &url[..start + 3];
            let rest = &url[at_pos + 1..];
            return format!("{}***@{}", scheme, rest);
        }
    }
    // SQLite URLs don't have passwords
    url.to_string()
}

fn format_uptime(secs: u64) -> String {
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    let mins = (secs % 3600) / 60;
    let s = secs % 60;
    if days > 0 {
        format!("{}d {}h {}m {}s", days, hours, mins, s)
    } else if hours > 0 {
        format!("{}h {}m {}s", hours, mins, s)
    } else if mins > 0 {
        format!("{}m {}s", mins, s)
    } else {
        format!("{}s", s)
    }
}

/// `GET /api/admin/system/metrics` — live host metrics (CPU, RAM,
/// disks, process, host info) for the admin server-monitoring page.
///
/// Collected via the `sysinfo` crate — cross-platform by design, so
/// the same cards work against Linux, macOS and Windows backends.
/// Each scrape costs one ~200 ms CPU-sample window, so clients should
/// poll at a sane cadence (the frontend polls every 5 s). The snapshot
/// is never cached server-side — every scrape reflects live values.
#[utoipa::path(
    get,
    path = "/api/admin/system/metrics",
    tag = "admin",
    responses(
        (status = 200, description = "Live server metrics", body = SystemMetrics),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn system_metrics(
    State(st): State<AppState>,
    admin: AdminUser,
) -> AppResult<Json<SystemMetrics>> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;
    Ok(Json(
        crate::service::metrics::collect_system_metrics().await,
    ))
}

/// Build the system monitoring router (`/api/admin/system` +
/// `/api/admin/system/metrics` + `/api/admin/chat/stats`).
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(system_status))
        .route("/metrics", get(system_metrics))
        .route("/memory", get(process_memory))
        .route("/chat/stats", get(chat_stats))
}

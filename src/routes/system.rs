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
//! Also hosts `/api/admin/system/metrics` — live host-level metrics
//! (CPU / RAM / disks / process / host info) for the admin
//! server-monitoring page, ported from pdf-tts.
//!
//! (`/api/admin/chat/stats` used to live here by mistake — it now
//! lives in `routes/admin/chat.rs` where its URL says it does.)

use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::audio_call::hub::call_hub;
use crate::audio_call::janitor::janitor_stats;
use crate::audio_call::session::{sessions, CallState};
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
    /// Audio-call subsystem: live sessions + the janitor's release
    /// counters ("how often did the safety net fire").
    pub calls: CallSystemStats,
    pub database: DatabaseStats,
    pub process: ProcessStats,
}

/// Audio-call subsystem stats — live sessions plus the janitor's
/// cumulative resource-release counters. The janitor counters answer
/// "are calls being left dangling?" without grepping logs: anything
/// above zero means the server (not a client) had to end a call.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CallSystemStats {
    /// Live call sessions (ringing + active).
    pub sessions: usize,
    /// Sessions currently RINGING (waiting for an answer).
    pub ringing: usize,
    /// Sessions currently ACTIVE (media negotiated).
    pub active: usize,
    /// Agent sockets registered on the call hub (one per device).
    pub agent_sockets: usize,
    /// Ringing sessions the janitor expired since boot (frozen
    /// callers, dead ring timers) — each one released the agent's
    /// busy flag and the customer's busy lock.
    pub janitor_ring_expired: u64,
    /// Of those, how many were re-routed to another agent.
    pub janitor_ring_rerouted: u64,
    /// Active sessions the janitor tore down at the hard lifetime cap
    /// since boot (both call UIs died without hanging up).
    pub janitor_active_expired: u64,
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
    /// Live hardware-bounded admission telemetry — the RAM/fd numbers
    /// that ACTUALLY cap connections now that the static caps default
    /// to unlimited (see `middleware::resource_guard`).
    pub resources: ResourceGuardStats,
}

/// Hardware-bounded admission telemetry — "how much headroom does this
/// box have for more realtime connections right now".
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResourceGuardStats {
    /// Host `MemAvailable` right now, bytes (`null` when procfs is
    /// unavailable — non-Linux dev environments).
    pub mem_available_bytes: Option<u64>,
    /// Configured memory floor (`WS_MIN_FREE_MEM_MB`), bytes. `0` = off.
    pub mem_floor_bytes: u64,
    /// Open file descriptors of this process right now.
    pub fd_used: u64,
    /// Soft `RLIMIT_NOFILE` of this process (`0` = unknown).
    pub fd_soft_limit: u64,
    /// fd usage as a percentage of the soft limit (0.0 when unknown).
    pub fd_used_pct: f64,
    /// Configured fd high watermark % (`WS_FD_HIGH_WATERMARK_PCT`).
    /// `0` = off.
    pub fd_high_watermark_pct: u32,
    /// Whether a NEW long-lived connection would be admitted right now
    /// (both watermarks evaluated against the live snapshot).
    pub admitting: bool,
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

    // ── Audio-call subsystem stats ────────────────────────────────
    // Live sessions split by state + the janitor's release counters.
    let (mut call_ringing, mut call_active) = (0usize, 0usize);
    for s in sessions().sessions_iter() {
        match s.state {
            CallState::Ringing => call_ringing += 1,
            CallState::Active => call_active += 1,
        }
    }
    let (ring_expired, ring_rerouted, active_expired) = janitor_stats();
    let calls = CallSystemStats {
        sessions: call_ringing + call_active,
        ringing: call_ringing,
        active: call_active,
        agent_sockets: call_hub().online_agent_count(),
        janitor_ring_expired: ring_expired,
        janitor_ring_rerouted: ring_rerouted,
        janitor_active_expired: active_expired,
    };

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

    // ── Hardware-bounded admission telemetry ───────────────────────
    let wm = crate::middleware::resource_guard::ResourceWatermarks::from_config(&st.config.ws);
    let snap = crate::middleware::resource_guard::ResourceSnapshot::read();
    let resources = ResourceGuardStats {
        mem_available_bytes: snap.mem_available_bytes,
        mem_floor_bytes: wm.min_free_mem_bytes,
        fd_used: snap.fd_used,
        fd_soft_limit: snap.fd_soft_limit,
        fd_used_pct: if snap.fd_soft_limit > 0 {
            (snap.fd_used as f64 / snap.fd_soft_limit as f64) * 100.0
        } else {
            0.0
        },
        fd_high_watermark_pct: wm.fd_high_watermark_pct,
        admitting: crate::middleware::resource_guard::decide(&snap, &wm).is_ok(),
    };

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
            resources,
        },
        calls,
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

// ── Database size / compaction diagnostics ──────────────────────────
//
// Answers "is the DB file size normal?" with NUMBERS instead of guesswork:
// file sizes (db + wal + shm), the pager's own accounting (page size,
// page count, freelist), a per-table dbstat breakdown, and — with
// `?probe=1` — a ground-truth compaction probe (`VACUUM INTO` a throwaway
// file, measure, delete). The probe is the one number that settles the
// "is my file bloated" debate: probe_bytes is what the SAME live data
// costs on a fresh, fully-compacted copy of the SAME engine.
//
// See deploy/DB-SIZE-RUNBOOK.md for the operating procedure (when to
// probe, how to read the ratio, how to run the guarded VACUUM).

/// Query params for `GET /api/admin/system/database`.
#[derive(Debug, Default, Deserialize)]
pub struct DatabaseSizeParams {
    /// `probe=1` → run a `VACUUM INTO` compaction probe (writes a
    /// throwaway copy next to the temp dir, measures it, deletes it).
    /// Costs one full-DB read + one compacted write + free disk ≈
    /// compacted size. Skip on a full disk / under heavy write load.
    pub probe: Option<u8>,
}

/// File-size block of the report.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DbFilesOut {
    /// Resolved on-disk path of the main database file (from DATABASE_URL).
    pub db_path: String,
    /// Main DB file size in bytes.
    pub db_bytes: u64,
    /// Write-ahead log size in bytes (WAL mode; checkpoints bound it).
    pub wal_bytes: u64,
    /// Shared-memory index size in bytes (present while WAL is active).
    pub shm_bytes: u64,
}

/// Pager-level pragmas that size/fragmentation questions need.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DbPragmasOut {
    /// Page size in bytes (fixed at file creation).
    pub page_size: i64,
    /// Total pages currently in the file (`page_size * page_count` ≈
    /// the on-disk size, modulo preallocation).
    pub page_count: i64,
    /// Pages on the freelist — reusable by future writes, but still
    /// occupying file space until a VACUUM.
    pub freelist_pages: i64,
    /// `journal_mode` (expect `wal`).
    pub journal_mode: String,
    /// Configured engine-wide page-cache budget in KiB
    /// (DATABASE_CACHE_KIB; the rust-sql engine shares ONE pager per
    /// file across the pool, so this is a single budget, not per-conn).
    pub cache_kib: i64,
}

/// One table's footprint from the `dbstat` virtual table.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DbTableSizeOut {
    /// Table (or index) name.
    pub name: String,
    /// Pages used by this object.
    pub pages: i64,
    /// Bytes used by this object.
    pub bytes: i64,
}

/// `?probe=1` result: the ground-truth compacted size.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DbProbeOut {
    /// Size of the `VACUUM INTO` copy — the same live data, fully
    /// compacted, on the SAME engine. This is the number to compare
    /// `dbBytes` against.
    pub compacted_bytes: u64,
    /// `compacted_bytes / db_bytes` — how much of the current file is
    /// live, compacted data.
    pub live_ratio: f64,
    /// `true` when live_ratio < 0.9 (≥ 10% of the file is freelist /
    /// fragmentation / slack) — a VACUUM would meaningfully shrink it.
    pub reclaimable: bool,
    /// Wall time of the probe (the VACUUM INTO write).
    pub probe_seconds: f64,
    /// Non-fatal probe errors (dbstat unavailable, wal missing, …).
    pub note: Option<String>,
}

/// Full `GET /api/admin/system/database` report.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSizeResponse {
    /// Engine identity (rust-sql build).
    pub engine: String,
    /// Masked DATABASE_URL (password-free display form).
    pub url_masked: String,
    pub files: DbFilesOut,
    pub pragmas: DbPragmasOut,
    /// Top-25 largest objects (tables + indexes) from `dbstat`; `None`
    /// when the engine build lacks the dbstat virtual table.
    pub top_tables: Option<Vec<DbTableSizeOut>>,
    /// Present only with `?probe=1`.
    pub probe: Option<DbProbeOut>,
}

/// `POST /api/admin/system/database/vacuum` result.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VacuumResponse {
    /// File size before the VACUUM (db + wal).
    pub before_bytes: u64,
    /// File size after the VACUUM + a WAL checkpoint (db + wal).
    pub after_bytes: u64,
    /// `before - after` (can legitimately be small: WAL + freelist were
    /// already bounded).
    pub reclaimed_bytes: u64,
    /// Wall time of the VACUUM (s) — expect roughly one full-DB
    /// read + write; plan the maintenance window around it.
    pub seconds: f64,
}

/// Resolve the main DB file path from the configured URL
/// (`sqlite://./app.db?mode=rwc` → `./app.db`).
fn db_file_path(url: &str) -> String {
    url.strip_prefix("sqlite://")
        .or_else(|| url.strip_prefix("sqlite:"))
        .unwrap_or(url)
        .split('?')
        .next()
        .unwrap_or("app.db")
        .to_string()
}

/// Read one integer PRAGMA (`PRAGMA page_count` → column `page_count`).
async fn pragma_i64(
    db: &sea_orm::DatabaseConnection,
    name: &'static str,
) -> Result<i64, sea_orm::DbErr> {
    use sea_orm::{ConnectionTrait, Statement};
    let rows = db
        .query_all(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            format!("PRAGMA {name}"),
        ))
        .await?;
    rows.first()
        .and_then(|r| r.try_get::<i64>("", name).ok())
        .ok_or_else(|| sea_orm::DbErr::Custom(format!("PRAGMA {name} returned no rows")))
}

/// Read one string PRAGMA (`PRAGMA journal_mode`).
async fn pragma_str(
    db: &sea_orm::DatabaseConnection,
    name: &'static str,
) -> Result<String, sea_orm::DbErr> {
    use sea_orm::{ConnectionTrait, Statement};
    let rows = db
        .query_all(Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            format!("PRAGMA {name}"),
        ))
        .await?;
    rows.first()
        .and_then(|r| r.try_get::<String>("", name).ok())
        .ok_or_else(|| sea_orm::DbErr::Custom(format!("PRAGMA {name} returned no rows")))
}

/// `db + wal` on-disk footprint in bytes.
fn db_footprint_bytes(db_path: &str) -> u64 {
    let main = std::fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);
    let wal = std::fs::metadata(format!("{db_path}-wal"))
        .map(|m| m.len())
        .unwrap_or(0);
    main + wal
}

/// Compaction probe: `VACUUM INTO` a uniquely-named temp file, measure,
/// delete. Returns (compacted_bytes, elapsed_seconds).
async fn vacuum_into_probe(db: &sea_orm::DatabaseConnection) -> Result<(u64, f64), String> {
    use sea_orm::ConnectionTrait;
    let started = std::time::Instant::now();
    let tmp = std::env::temp_dir().join(format!(
        "dbsize-probe-{}-{}.rsql",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    ));
    // Single-quote the path per SQL string literals; strip quotes from
    // the (already temporary-dir-derived) path defensively.
    let safe: String = tmp
        .display()
        .to_string()
        .chars()
        .map(|c| if c == '\'' { ' ' } else { c })
        .collect();
    let sql = format!("VACUUM INTO '{}';", safe);
    let res = db.execute_unprepared(&sql).await;
    let elapsed = started.elapsed().as_secs_f64();
    match res {
        Ok(_) => {
            let bytes = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
            let _ = std::fs::remove_file(&tmp);
            Ok((bytes, elapsed))
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(format!("VACUUM INTO failed: {e}"))
        }
    }
}

/// `GET /api/admin/system/database` — file sizes, pager pragmas, dbstat
/// top-25, and (with `?probe=1`) the ground-truth compacted size.
#[utoipa::path(
    get,
    path = "/api/admin/system/database",
    params(
        ("probe" = Option<u8>, Query, description = "1 = run a VACUUM INTO compaction probe (extra IO; skip under heavy write load)")
    ),
    responses(
        (status = 200, description = "Database size report", body = DatabaseSizeResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden")
    )
)]
pub async fn database_size(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(params): Query<DatabaseSizeParams>,
) -> AppResult<Json<DatabaseSizeResponse>> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;

    let db_path = db_file_path(&st.config.database.url);
    let db_bytes = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    let wal_bytes = std::fs::metadata(format!("{db_path}-wal"))
        .map(|m| m.len())
        .unwrap_or(0);
    let shm_bytes = std::fs::metadata(format!("{db_path}-shm"))
        .map(|m| m.len())
        .unwrap_or(0);

    let page_size = pragma_i64(&st.db, "page_size").await.unwrap_or(0);
    let page_count = pragma_i64(&st.db, "page_count").await.unwrap_or(0);
    let freelist_pages = pragma_i64(&st.db, "freelist_count").await.unwrap_or(0);
    let journal_mode = pragma_str(&st.db, "journal_mode").await.unwrap_or_default();

    // dbstat top-25 by footprint (tables + indexes). The rust-sql engine
    // may not build the dbstat virtual table — degrade to `None`.
    let top_tables: Option<Vec<DbTableSizeOut>> = {
        use sea_orm::{ConnectionTrait, Statement};
        let sql = "SELECT name, COUNT(*) AS pages, SUM(pgsize) AS bytes \
                   FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 25;";
        match st
            .db
            .query_all(Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                sql,
            ))
            .await
        {
            Ok(rows) => Some(
                rows.into_iter()
                    .filter_map(|r| {
                        let name: String = r.try_get("", "name").ok()?;
                        let pages: i64 = r.try_get("", "pages").ok()?;
                        let bytes: i64 = r.try_get("", "bytes").ok()?;
                        Some(DbTableSizeOut { name, pages, bytes })
                    })
                    .collect(),
            ),
            Err(_) => None,
        }
    };

    let probe = if params.probe.unwrap_or(0) == 1 {
        match vacuum_into_probe(&st.db).await {
            Ok((compacted_bytes, probe_seconds)) => {
                let live_ratio = if db_bytes > 0 {
                    compacted_bytes as f64 / db_bytes as f64
                } else {
                    1.0
                };
                Some(DbProbeOut {
                    compacted_bytes,
                    live_ratio,
                    reclaimable: live_ratio < 0.9,
                    probe_seconds,
                    note: None,
                })
            }
            Err(err) => Some(DbProbeOut {
                compacted_bytes: 0,
                live_ratio: 0.0,
                reclaimable: false,
                probe_seconds: 0.0,
                note: Some(err),
            }),
        }
    } else {
        None
    };

    Ok(Json(DatabaseSizeResponse {
        engine: crate::db::engine_source_id().to_string(),
        url_masked: mask_db_url(&st.config.database.url),
        files: DbFilesOut {
            db_path,
            db_bytes,
            wal_bytes,
            shm_bytes,
        },
        pragmas: DbPragmasOut {
            page_size,
            page_count,
            freelist_pages,
            journal_mode,
            cache_kib: st.config.database.cache_kib,
        },
        top_tables,
        probe,
    }))
}

/// `POST /api/admin/system/database/vacuum` — guarded in-place
/// compaction. Rebuilds the file (drops freelist + fragmentation
/// slack); expect IO ≈ one full-DB read + write for the duration.
/// Runs on the shared single-writer engine: concurrent writers queue on
/// the engine's own write lock — run it in a quiet window.
#[utoipa::path(
    post,
    path = "/api/admin/system/database/vacuum",
    responses(
        (status = 200, description = "VACUUM completed", body = VacuumResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "VACUUM failed (reported in body)")
    )
)]
pub async fn database_vacuum(
    State(st): State<AppState>,
    admin: AdminUser,
) -> AppResult<Json<VacuumResponse>> {
    use sea_orm::ConnectionTrait;

    st.rbac
        .require(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;

    let db_path = db_file_path(&st.config.database.url);
    let before_bytes = db_footprint_bytes(&db_path);
    let started = std::time::Instant::now();

    // The engine is single-writer: a VACUUM takes the write lock for its
    // duration. Failure surfaces as a 500 with the engine's own error.
    st.db
        .execute_unprepared("VACUUM;")
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("VACUUM failed: {e}")))?;

    // Roll the WAL into the main file so `after_bytes` reflects reality.
    let _ = st
        .db
        .execute_unprepared("PRAGMA wal_checkpoint(TRUNCATE);")
        .await;

    let seconds = started.elapsed().as_secs_f64();
    let after_bytes = db_footprint_bytes(&db_path);
    tracing::info!(
        before_bytes,
        after_bytes,
        reclaimed_bytes = before_bytes.saturating_sub(after_bytes),
        seconds,
        "admin-triggered database VACUUM completed"
    );
    Ok(Json(VacuumResponse {
        before_bytes,
        after_bytes,
        reclaimed_bytes: before_bytes.saturating_sub(after_bytes),
        seconds,
    }))
}

/// Build the system monitoring router (`/api/admin/system` +
/// `/api/admin/system/metrics` + `/api/admin/system/chat/stats` +
/// `/api/admin/system/database` + `/api/admin/system/database/vacuum`).
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/", get(system_status))
        .route("/metrics", get(system_metrics))
        .route("/memory", get(process_memory))
        .route("/database", get(database_size))
        .route("/database/vacuum", post(database_vacuum))
}

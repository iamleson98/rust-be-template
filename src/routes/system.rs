//! System monitoring endpoint — `/api/admin/system`.
//!
//! Returns real-time metrics about the server: WebSocket hub stats,
//! database pool, cache, uptime, and process info. Admin-only.
//!
//! The `database.engine` section identifies the linked SQLite build and
//! reports its process-wide heap usage (`sqlite3_status64`). Pool
//! occupancy and file/pager figures live in `database` itself and in
//! `/api/admin/system/database`; a value SQLite cannot report is left
//! out rather than shown as zero.
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
    /// Backend name — always `"sqlite (begin-concurrent)"`.
    pub backend: String,
    /// Masked DB URL (password hidden).
    pub url_masked: String,
    /// Configured max pool connections.
    pub max_connections: u32,
    /// Configured min pool connections.
    pub min_connections: u32,
    /// Pool connections currently checked out (open minus idle).
    pub active_connections: u32,
    /// Pool connections open and idle (available).
    pub idle_connections: u32,
    /// Database file size in MB (SQLite only — WAL + main DB file).
    /// `0.0` when no file backs the URL (not the case here).
    pub size_mb: f64,
    /// The linked SQLite build and its heap usage.
    pub engine: EngineStatsOut,
}

/// The linked SQLite build — the "database engine" card group on the
/// admin system page.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatsOut {
    /// Build identity (`sqlite3_sourceid()`: check-in timestamp + hash).
    pub version: String,
    /// `sqlite3_libversion()`, e.g. `3.51.3`.
    pub sqlite_version: String,
    pub memory: EngineMemoryOut,
}

/// SQLite's own heap usage, process-wide (`SQLITE_STATUS_MEMORY_USED`:
/// page caches, prepared statements, schema — not process RSS).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EngineMemoryOut {
    /// Bytes SQLite currently has allocated, in MB.
    pub heap_mb: f64,
    /// Highest value of `heap_mb` since process start.
    pub heap_peak_mb: f64,
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
    let (active_connections, idle_connections, size_mb) = collect_db_stats(&st);
    let engine = engine_stats();

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

/// Collect DB stats for the admin system endpoint: `(active, idle,
/// file_size_mb)`. Pool figures come from the sqlx pool; the file size
/// is `app.db` + `app.db-wal`.
fn collect_db_stats(st: &AppState) -> (u32, u32, f64) {
    let pool = st.db.get_sqlite_connection_pool();
    let open = pool.size();
    let idle = u32::try_from(pool.num_idle()).unwrap_or(u32::MAX);
    let size_mb =
        db_footprint_bytes(&db_file_path(&st.config.database.url)) as f64 / 1024.0 / 1024.0;
    (open.saturating_sub(idle), idle, size_mb)
}

/// SQLite's process-wide heap usage and peak (`sqlite3_status64`).
fn engine_stats() -> EngineStatsOut {
    let (mut current, mut peak) = (0_i64, 0_i64);
    // SAFETY: both out-pointers are valid for the call; `reset_flag` 0
    // leaves the high-water mark untouched.
    unsafe {
        libsqlite3_sys::sqlite3_status64(
            libsqlite3_sys::SQLITE_STATUS_MEMORY_USED,
            &mut current,
            &mut peak,
            0,
        );
    }
    EngineStatsOut {
        version: crate::db::sqlite_source_id().to_string(),
        sqlite_version: crate::db::sqlite_version().to_string(),
        memory: EngineMemoryOut {
            heap_mb: current as f64 / 1024.0 / 1024.0,
            heap_peak_mb: peak as f64 / 1024.0 / 1024.0,
        },
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
    /// Configured page-cache budget in KiB PER pooled connection
    /// (DATABASE_CACHE_KIB).
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
    /// Build identity of the linked SQLite (`sqlite3_sourceid()`).
    pub engine: String,
    /// Masked DATABASE_URL (password-free display form).
    pub url_masked: String,
    pub files: DbFilesOut,
    pub pragmas: DbPragmasOut,
    /// Top-25 largest objects (tables + indexes) from `dbstat`; `None`
    /// when that query fails.
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
        "dbsize-probe-{}-{}.db",
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

    // dbstat top-25 by footprint (tables + indexes); `None` when the
    // query fails.
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
        engine: crate::db::sqlite_source_id().to_string(),
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
/// VACUUM holds SQLite's write lock for its duration: concurrent writers
/// wait up to `busy_timeout` and then fail with SQLITE_BUSY — run it in
/// a quiet window.
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

    // A VACUUM takes the write lock for its duration. Failure surfaces
    // as a 500 with SQLite's own error.
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

//! System monitoring endpoint — `/api/admin/system`.
//!
//! Returns real-time metrics about the server: WebSocket hub stats,
//! database pool, cache, uptime, and process info. Admin-only.
//!
//! Also hosts `/api/admin/chat/stats` — aggregate chat stats for the
//! admin dashboard's top-row cards (open / assigned / closed counts +
//! average first-response time).

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

use crate::dto::chat::ChatStatsResponse;
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
    /// Backend name — `"sqlite"` or `"postgres"`.
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
    /// `0.0` for Postgres (no file).
    pub size_mb: f64,
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
        .check(admin.user_id(), rbac::ADMIN_STATS_READ)
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
    let online_employees = crate::ws::hub::hub().count_online_employees_total();

    // ── Process info (cross-platform via `sysinfo`) ───────────────
    //
    // `sysinfo` works on Linux, macOS, + Windows. It refreshes the
    // system + process info on each call. The first call after
    // startup may return CPU usage 0.0 (sysinfo needs two samples to
    // compute usage — the second call will have the real value).
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};
    let mut sys = System::new();
    sys.refresh_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
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
    let (active_connections, idle_connections, size_mb) =
        collect_db_stats(&st, &db_backend).await;

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
            online_employee_brands: ws_stats.online_employee_brands,
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
        .check(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;
    let stats = st.chats.chat_stats().await?;
    Ok(Json(stats))
}

/// Collect DB-pool + file-size stats. Returns
/// `(active_connections, idle_connections, size_mb)`.
///
/// - For SQLite: pool stats are unavailable (SQLite uses a single
///   connection, not a pool) → returns `(-1, -1, file_size_mb)`.
///   The file size is the sum of `app.db` + `app.db-wal` (WAL mode).
/// - For Postgres: queries `pg_stat_activity` for active + idle
///   connections in the current DB. File size is `0.0` (Postgres
///   doesn't map to a single file).
async fn collect_db_stats(st: &AppState, backend: &str) -> (i32, i32, f64) {
    if backend.eq_ignore_ascii_case("sqlite") {
        // SQLite — compute the file size (main DB + WAL).
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
        // SQLite uses a single connection (not a pool) — return -1
        // to indicate "not applicable".
        (-1, -1, size_mb)
    } else {
        // Postgres — query pg_stat_activity for connection counts.
        use sea_orm::ConnectionTrait;
        use sea_orm::FromQueryResult;

        #[derive(FromQueryResult)]
        struct ConnCount {
            state: String,
            count: i64,
        }

        let db = st.chats.db_for_stats();
        let rows = ConnCount::find_by_statement(sea_orm::Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"SELECT state, COUNT(*) as count
               FROM pg_stat_activity
               WHERE datname = current_database()
               GROUP BY state"#,
            [],
        ))
        .all(db)
        .await
        .unwrap_or_default();

        let mut active = 0i32;
        let mut idle = 0i32;
        for row in rows {
            if row.state == "active" {
                active = row.count as i32;
            } else {
                idle += row.count as i32;
            }
        }
        (active, idle, 0.0)
    }
}

fn mask_db_url(url: &str) -> String {
    // Mask password in postgres://user:pass@host/db
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

/// Build the system monitoring router (`/api/admin/system` + `/api/admin/chat/stats`).
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(system_status))
        .route("/chat/stats", get(chat_stats))
}

//! System monitoring endpoint — `/api/admin/system`.
//!
//! Returns real-time metrics about the server: WebSocket hub stats,
//! database pool, cache, uptime, and process info. Admin-only.

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

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
    pub connections: usize,
    pub max_connections: usize,
    pub rooms: usize,
    pub idempotency_entries: usize,
    pub online_employee_brands: usize,
    pub distinct_ips: usize,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStats {
    pub backend: String,
    pub url_masked: String,
    pub max_connections: u32,
    pub min_connections: u32,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStats {
    pub pid: u32,
    pub memory_mb: f64,
    pub cpu_count: usize,
}

/// Global startup timestamp (set once on first call).
static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

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

    let start = START_TIME.get_or_init(std::time::Instant::now);
    let elapsed = start.elapsed();
    let uptime_secs = elapsed.as_secs();

    // WebSocket hub stats
    let ws_stats = crate::ws::hub::hub().stats();

    // Process info
    let pid = std::process::id();
    let cpu_count = num_cpus::get();
    let memory_mb = get_rss_memory_mb();

    // Mask the DB URL for security
    let db_url_masked = mask_db_url(&st.config.database.url);
    let db_backend = crate::cli::util::db_backend_name().to_string();

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
            distinct_ips: ws_stats.distinct_ips,
        },
        database: DatabaseStats {
            backend: db_backend,
            url_masked: db_url_masked,
            max_connections: st.config.database.max_connections,
            min_connections: st.config.database.min_connections,
        },
        process: ProcessStats {
            pid,
            memory_mb,
            cpu_count,
        },
    }))
}

/// Get RSS memory in MB (Linux only; returns 0.0 on other platforms).
fn get_rss_memory_mb() -> f64 {
    #[cfg(target_os = "linux")]
    {
        // Read /proc/self/status → VmRSS line
        if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
            for line in status.lines() {
                if line.starts_with("VmRSS:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<u64>() {
                            return kb as f64 / 1024.0;
                        }
                    }
                }
            }
        }
        0.0
    }
    #[cfg(not(target_os = "linux"))]
    {
        0.0
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

/// Build the system monitoring router (`/api/admin/system`).
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new().route("/", get(system_status))
}

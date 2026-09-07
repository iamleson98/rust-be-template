//! System-metrics DTOs for the admin server-monitoring endpoint
//! (`GET /api/admin/system/metrics`).
//!
//! Live host-level metrics collected via the `sysinfo` crate
//! (cross-platform: Linux, macOS, Windows). All byte fields are RAW
//! BYTES; percentages are 0–100; uptime is in seconds. Mirrors the
//! pdf-tts admin "Server Metrics" feature so both products expose the
//! same wire shape (modulo this repo's camelCase convention) for the
//! same monitoring UI.

use serde::Serialize;
use utoipa::ToSchema;

/// Live host-level metrics for the admin server-monitoring page.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    /// Overall CPU utilization across all cores, 0–100.
    pub cpu_usage_percent: f32,
    /// Per-core utilization in core order, each 0–100.
    pub per_core_usage_percent: Vec<f32>,
    /// Logical CPU cores (what `nproc` reports).
    pub logical_cores: usize,
    /// Physical CPU cores (fewer than logical when hyper-threading).
    pub physical_cores: usize,
    /// Total installed RAM in bytes.
    pub memory_total_bytes: u64,
    /// RAM in use (includes cached/buffers as reported by the OS).
    pub memory_used_bytes: u64,
    /// RAM immediately available to processes.
    pub memory_available_bytes: u64,
    /// `used / total * 100`, 0–100.
    pub memory_usage_percent: f32,
    /// Resident set size of THIS server process in bytes.
    pub process_memory_bytes: u64,
    /// CPU used by THIS process, 0–100 where 100 = one full core
    /// (values > 100 mean multiple cores are in use).
    pub process_cpu_usage_percent: f32,
    /// Every mounted volume with a non-zero capacity.
    pub disks: Vec<DiskInfo>,
    /// Host uptime in seconds.
    pub uptime_secs: u64,
    /// OS display name, e.g. "Ubuntu 24.04" / "macOS 15.2".
    pub os_name: String,
    /// Kernel / OS version string.
    pub kernel_version: String,
    /// Host machine name.
    pub hostname: String,
    /// RFC-3339 collection timestamp.
    pub timestamp: String,
}

/// One mounted volume's capacity snapshot.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    /// Mount point, e.g. `/`, `/home`.
    pub mount_point: String,
    /// Filesystem type, e.g. `ext4`, `xfs`.
    pub fs_type: String,
    /// Total capacity in bytes.
    pub total_bytes: u64,
    /// Free space available to unprivileged users, in bytes.
    pub available_bytes: u64,
    /// `used / total * 100`, 0–100.
    pub usage_percent: f32,
    /// Removable media (USB, …) — surfaced as a badge in the UI.
    pub is_removable: bool,
}

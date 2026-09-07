//! Host system-metrics collector for the admin server-monitoring page
//! (`GET /api/admin/system/metrics`).
//!
//! Cross-platform by design: the `sysinfo` crate (already a dependency
//! for `/api/admin/system`) reports CPU, memory, disks and host info
//! uniformly on Linux, macOS and Windows. Nothing here shells out to
//! platform commands, so the same code path runs everywhere.
//!
//! CPU percentages require the two-refresh pattern: `sysinfo` computes
//! utilization by comparing tick counters between refreshes, so the
//! first `refresh_cpu_usage()` merely primes the counters and a second
//! refresh after `MINIMUM_CPU_UPDATE_INTERVAL` produces real numbers.
//! The wait uses `tokio::time::sleep` so the request worker thread is
//! never blocked (each scrape costs one ~200 ms await, not a spin).
//!
//! Ported from pdf-tts's `service/metrics.rs` (sysinfo 0.39 there;
//! this repo pins 0.32 — the collector was adapted to its API, notably
//! `physical_core_count()` being an instance method here).

use crate::dto::system::{DiskInfo, SystemMetrics};

/// This server's PID, in sysinfo's cross-platform representation.
fn current_pid() -> sysinfo::Pid {
    sysinfo::Pid::from_u32(std::process::id())
}

/// Collect a full host-metrics snapshot.
///
/// Costs one `MINIMUM_CPU_UPDATE_INTERVAL` (~200 ms) await for the CPU
/// sample window. Callers should poll at a sane cadence (the frontend
/// polls every 5 s); the snapshot is never cached server-side so every
/// scrape reflects live values.
pub async fn collect_system_metrics() -> SystemMetrics {
    let mut sys = sysinfo::System::new();

    // Memory + global CPU counters.
    sys.refresh_memory();
    sys.refresh_cpu_usage();

    // Per-process CPU counters for THIS process.
    let pid = current_pid();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);

    // Prime-then-sample: wait the minimum interval so the second
    // refresh has a real tick delta to measure against.
    tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;

    sys.refresh_cpu_usage();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);

    let logical_cores = sys.cpus().len();
    // sysinfo 0.32: instance method (0.39 made it a static).
    let physical_cores = sys.physical_core_count().unwrap_or(logical_cores);

    let per_core: Vec<f32> = sys.cpus().iter().map(|c| c.cpu_usage()).collect();
    // Global CPU = mean of per-core values (sysinfo's own aggregation).
    let cpu_usage = if per_core.is_empty() {
        0.0
    } else {
        per_core.iter().sum::<f32>() / per_core.len() as f32
    };

    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_available = sys.available_memory();
    let memory_usage_percent = usage_percent(memory_used, memory_total);

    // Process stats (RSS + CPU). Process CPU is NOT clamped to 100:
    // sysinfo reports up to `cores × 100%` — one full core = 100% —
    // and clamping would hide genuinely multi-core-saturating work.
    let (process_memory, process_cpu) = sys
        .process(current_pid())
        .map(|p| (p.memory(), p.cpu_usage()))
        .unwrap_or((0, 0.0));

    // Disks: enumerate every mounted volume; skip zero-capacity mounts
    // (e.g. squashfs/loop devices, some container overlays) and virtual
    // filesystems. FUSE network mounts (ossfs, juicefs, …) report
    // nonsense ~16 EiB totals that would poison the UI, and virtual
    // kernel mounts (snap squashfs, efivars) aren't storage the
    // operator can manage.
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk_infos: Vec<DiskInfo> = disks
        .list()
        .iter()
        .filter(|d| d.total_space() > 0)
        .filter(|d| {
            !is_virtual_filesystem(
                &d.mount_point().to_string_lossy(),
                &d.file_system().to_string_lossy(),
            )
        })
        .map(|d| {
            let total = d.total_space();
            let available = d.available_space();
            DiskInfo {
                mount_point: d.mount_point().to_string_lossy().to_string(),
                fs_type: d.file_system().to_string_lossy().to_string(),
                total_bytes: total,
                available_bytes: available,
                usage_percent: usage_percent(total.saturating_sub(available), total),
                is_removable: d.is_removable(),
            }
        })
        .collect();

    SystemMetrics {
        cpu_usage_percent: cpu_usage,
        per_core_usage_percent: per_core,
        logical_cores,
        physical_cores,
        memory_total_bytes: memory_total,
        memory_used_bytes: memory_used,
        memory_available_bytes: memory_available,
        memory_usage_percent,
        process_memory_bytes: process_memory,
        process_cpu_usage_percent: process_cpu,
        disks: disk_infos,
        uptime_secs: sysinfo::System::uptime(),
        os_name: os_display_name(),
        kernel_version: sysinfo::System::kernel_version().unwrap_or_else(|| "unknown".into()),
        hostname: sysinfo::System::host_name().unwrap_or_else(|| "unknown".into()),
        timestamp: chrono::Utc::now().to_rfc3339(),
    }
}

/// Best-effort human OS name with a portable fallback chain:
/// `long_os_version` ("Ubuntu 24.04" / "macOS 15.2") → `name`
/// ("Linux" / "Windows") → compile-time `std::env::consts::OS`.
fn os_display_name() -> String {
    sysinfo::System::long_os_version()
        .or_else(sysinfo::System::name)
        .unwrap_or_else(|| std::env::consts::OS.to_string())
}

/// Whether a mount belongs to a virtual filesystem that should not
/// appear in the disk list: FUSE network mounts ("fuse.ossfs",
/// "fuse.pfs", …) report bogus totals; snap squashfs images and
/// efivars/procfs-style kernel mounts aren't operator-managed storage.
fn is_virtual_filesystem(mount_point: &str, fs_type: &str) -> bool {
    const VIRTUAL_MOUNT_PREFIXES: [&str; 4] = ["/snap/", "/boot/efi", "/proc/", "/sys/"];
    let virtual_mount = VIRTUAL_MOUNT_PREFIXES
        .iter()
        .any(|p| mount_point.starts_with(p));
    // sysinfo reports FUSE filesystems as "fuse.<name>" on Linux; the
    // "fuse" prefix check covers all of them without hardcoding names.
    let fuse = fs_type.eq_ignore_ascii_case("fuse") || fs_type.starts_with("fuse.");
    virtual_mount || fuse
}

/// `used / total * 100`, safe for zero/absurd totals, clamped to [0, 100].
fn usage_percent(used: u64, total: u64) -> f32 {
    if total == 0 {
        return 0.0;
    }
    let ratio = used as f64 / total as f64;
    clamp_percent(ratio * 100.0)
}

/// Clamp a percentage into [0, 100]; NaN maps to 0.
fn clamp_percent(value: f64) -> f32 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 100.0) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_percent_handles_zero_total() {
        assert_eq!(usage_percent(0, 0), 0.0);
        assert_eq!(usage_percent(512, 0), 0.0);
    }

    #[test]
    fn usage_percent_computes_ratio() {
        assert_eq!(usage_percent(1, 2), 50.0);
        assert_eq!(usage_percent(1, 4), 25.0);
        assert!((usage_percent(3, 8) - 37.5).abs() < f32::EPSILON);
    }

    #[test]
    fn usage_percent_clamps_overfull() {
        // More "used" than total (bogus counters) must clamp, not explode.
        assert_eq!(usage_percent(200, 100), 100.0);
        assert_eq!(usage_percent(u64::MAX, u64::MAX), 100.0);
    }

    #[test]
    fn virtual_filesystems_are_filtered() {
        // Virtual kernel mounts.
        assert!(is_virtual_filesystem("/snap/irssi/1", "squashfs"));
        assert!(is_virtual_filesystem("/boot/efi", "vfat"));
        assert!(is_virtual_filesystem("/proc/self", "proc"));
        assert!(is_virtual_filesystem("/sys/fs/cgroup", "cgroup2"));
        // FUSE network mounts — both the "fuse.<name>" form and a
        // bare "fuse" (case-insensitive).
        assert!(is_virtual_filesystem("/mnt/oss", "fuse.ossfs"));
        assert!(is_virtual_filesystem("/mnt/pfs", "fuse.pfs"));
        assert!(is_virtual_filesystem("/mnt/nfsish", "FUSE"));
        // Real operator-managed storage must survive.
        assert!(!is_virtual_filesystem("/", "ext4"));
        assert!(!is_virtual_filesystem("/data", "xfs"));
        assert!(!is_virtual_filesystem("/home", "btrfs"));
    }

    #[tokio::test]
    async fn collect_system_metrics_smoke() {
        // One full scrape (~200 ms CPU sample window). Structural
        // assertions only — values vary by machine.
        let m = collect_system_metrics().await;

        assert!(m.logical_cores >= 1, "at least one logical core");
        assert!(m.physical_cores >= 1, "at least one physical core");
        assert_eq!(m.per_core_usage_percent.len(), m.logical_cores);
        // Every per-core value is a percentage; process CPU may exceed
        // 100 (100 = one full core) but host CPU may not.
        for core in &m.per_core_usage_percent {
            assert!(
                (*core >= 0.0 && *core <= 100.0) || core.is_nan(),
                "core in range"
            );
        }
        assert!(m.cpu_usage_percent >= 0.0 && m.cpu_usage_percent <= 100.0);
        assert!(m.memory_total_bytes > 0, "total RAM is non-zero");
        assert!(m.memory_used_bytes <= m.memory_total_bytes);
        assert!(m.memory_available_bytes <= m.memory_total_bytes);
        assert!(m.memory_usage_percent >= 0.0 && m.memory_usage_percent <= 100.0);
        // Process RSS: a running process always has some resident memory.
        assert!(m.process_memory_bytes > 0);
        assert!(m.uptime_secs > 0);
        assert!(!m.os_name.is_empty());
        assert!(!m.kernel_version.is_empty());
        assert!(!m.hostname.is_empty());
        assert!(!m.timestamp.is_empty());
        // Disks: every reported volume is non-virtual with capacity.
        for d in &m.disks {
            assert!(d.total_bytes > 0, "zero-capacity disk filtered");
            assert!(d.available_bytes <= d.total_bytes);
            assert!(d.usage_percent >= 0.0 && d.usage_percent <= 100.0);
            assert!(!d.mount_point.is_empty());
        }
        #[cfg(target_os = "linux")]
        {
            // The root filesystem is always present on the CI runners
            // (plain Docker/containerd — not a snap/FUSE mount).
            assert!(
                m.disks.iter().any(|d| d.mount_point == "/"),
                "root mount is reported: {:?}",
                m.disks.iter().map(|d| &d.mount_point).collect::<Vec<_>>()
            );
        }
    }
}

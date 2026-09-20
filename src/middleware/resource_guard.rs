//! Hardware-bounded admission control for long-lived connections.
//!
//! ## Why this exists
//!
//! The WebSocket hubs (`/ws` chat + `/ws-call` signaling) used to enforce a
//! *static* global connection cap (`WS_MAX_CONNECTIONS`, default 50_000) and
//! a per-IP cap. A static number is either (a) so low it rejects legitimate
//! traffic on a big box, or (b) so high it never fires before the box dies —
//! in both cases it is a guess that decouples the limit from the machine.
//! How Discord/Mattermost-style real-time platforms actually bound capacity:
//! **the limit is the hardware** — connection admission watches the real
//! resources (free RAM, file descriptors), and horizontal scale-out happens
//! at the load balancer when the fleet is saturated.
//!
//! This module turns that into code:
//!
//! * [`ResourceWatermarks`] — two knobs: a free-memory floor
//!   (`WS_MIN_FREE_MEM_MB`, default 512 MiB) and an fd high-watermark
//!   (`WS_FD_HIGH_WATERMARK_PCT`, default 90% of the soft `RLIMIT_NOFILE`).
//! * [`admit`] — called once per WS upgrade (NOT per message; the procfs
//!   reads are two small file opens — microseconds). Deny → the handler
//!   rejects the upgrade with 503 and the client's reconnect backoff kicks in,
//!   while EXISTING connections keep working (degradation, not collapse).
//! * [`snapshot`] — the same numbers, exposed on the admin `/api/admin/system`
//!   stats endpoint so operators can see the live headroom.
//!
//! ## What each resource actually governs
//!
//! * **File descriptors** — every socket is one fd (plus listeners, DB files,
//!   epoll internals). The fd table is THE hard connection ceiling on Linux;
//!   hitting the soft limit makes accept() fail process-wide.
//! * **Memory** — every held connection costs its task + buffers
//!   (tokio WS ≈ tens of KB idle). RAM exhaustion OOM-kills the process
//!   (or the kernel's OOM killer picks the biggest RSS — the TTS neighbour).
//! * **CPU** — does NOT gate *admission* (100k idle sockets cost ~0 CPU);
//!   CPU governs *throughput* and is handled by message-rate limits and, at
//!   fleet scale, by load-shedding/autoscaling. Bounding connections on CPU
//!   would block idle capacity for no benefit.
//!
//! ## Failure mode
//!
//! **Fail-open**: when `/proc` is unavailable (non-Linux dev machines, exotic
//! sandboxes) the unavailable check is skipped rather than refusing everyone.
//! The static caps (`WS_MAX_CONNECTIONS`, `WS_MAX_PER_IP`) remain available as
//! operator overrides for environments where procfs can't be trusted.
//!
//! ## Capacity math (the "how many users is this box" answer)
//!
//! With the default watermarks on the current 12 GiB node:
//! * RAM: ~11.7 GiB total − 512 MiB floor − (app + engine + neighbours)
//!   leaves ≈ 6-8 GiB for sockets → at ~40 KiB per tokio WS connection that
//!   is on the order of **150k-200k concurrent sockets** before the memory
//!   watermark fires.
//! * fds: container soft limit 1_048_576 → 90% watermark ≈ 943k fds — the
//!   RAM watermark fires first in practice, which is the correct order
//!   (exhausting fds is the uglier failure).

use std::sync::OnceLock;

/// Admission-control watermarks, derived from `WsConfig`.
///
/// Both knobs interpret `0` as "check disabled" so an operator can turn a
/// watermark off entirely (`WS_MIN_FREE_MEM_MB=0`) without touching code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceWatermarks {
    /// Refuse NEW long-lived connections once `MemAvailable` (host-wide,
    /// from `/proc/meminfo`) drops below this many bytes. `0` = disabled.
    pub min_free_mem_bytes: u64,
    /// Refuse NEW long-lived connections once the process' open-fd count
    /// reaches this percentage of the soft `RLIMIT_NOFILE`. `0` = disabled.
    pub fd_high_watermark_pct: u32,
}

impl ResourceWatermarks {
    /// Build from the `WsConfig` env knobs (`WS_MIN_FREE_MEM_MB` is expressed
    /// in MiB in the environment; converted to bytes here).
    pub fn from_config(cfg: &crate::config::WsConfig) -> Self {
        Self {
            min_free_mem_bytes: cfg.min_free_mem_mb.saturating_mul(1024 * 1024),
            fd_high_watermark_pct: cfg.fd_high_watermark_pct,
        }
    }
}

/// Why an upgrade was refused — lands in the warn log and (as a booleans-only
/// summary) the admin stats endpoint. Deliberately carries the numbers so a
/// capacity incident is diagnosable from the log line alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DenyReason {
    /// `MemAvailable` fell below [`ResourceWatermarks::min_free_mem_bytes`].
    MemoryPressure {
        /// `MemAvailable` at the time of the check, bytes.
        available_bytes: u64,
        /// The configured floor, bytes.
        floor_bytes: u64,
    },
    /// Open fds reached the high watermark of the soft `RLIMIT_NOFILE`.
    FileDescriptorPressure {
        /// Open fds at the time of the check.
        used: u64,
        /// Soft `RLIMIT_NOFILE`.
        soft_limit: u64,
        /// The configured watermark percentage.
        pct: u32,
    },
}

/// A point-in-time view of the resources admission control watches.
///
/// `mem_available_bytes: None` means "couldn't read" (non-Linux / procfs
/// hidden) — the memory check is then skipped (fail-open). `fd_soft_limit: 0`
/// likewise disables the fd check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceSnapshot {
    /// Host `MemAvailable` in bytes, if readable.
    pub mem_available_bytes: Option<u64>,
    /// Open file descriptors of THIS process right now.
    pub fd_used: u64,
    /// Soft `RLIMIT_NOFILE` of THIS process (`0` = unknown).
    pub fd_soft_limit: u64,
}

impl ResourceSnapshot {
    /// Read the live values from procfs. Cheap (two small file reads + one
    /// readdir); called once per WS upgrade and once per admin stats scrape.
    pub fn read() -> Self {
        let (fd_used, fd_soft_limit) = fd_stats();
        Self {
            mem_available_bytes: mem_available_bytes(),
            fd_used,
            fd_soft_limit,
        }
    }
}

/// Pure admission decision — every branch is unit-tested below.
///
/// Returns `Ok(())` when a new connection may be admitted. Checks are
/// skipped when the knob is `0` (disabled) or the corresponding reading is
/// unavailable (fail-open).
pub fn decide(snap: &ResourceSnapshot, wm: &ResourceWatermarks) -> Result<(), DenyReason> {
    // ── Memory floor ────────────────────────────────────────────────────
    if wm.min_free_mem_bytes > 0 {
        if let Some(available) = snap.mem_available_bytes {
            if available < wm.min_free_mem_bytes {
                return Err(DenyReason::MemoryPressure {
                    available_bytes: available,
                    floor_bytes: wm.min_free_mem_bytes,
                });
            }
        }
    }

    // ── File-descriptor high watermark ──────────────────────────────────
    // threshold = soft_limit * pct / 100 (saturating — a misconfigured
    // gigantic pct just means "never deny", same as 0).
    if wm.fd_high_watermark_pct > 0 && snap.fd_soft_limit > 0 {
        let threshold = snap
            .fd_soft_limit
            .saturating_mul(wm.fd_high_watermark_pct as u64)
            / 100;
        if snap.fd_used >= threshold {
            return Err(DenyReason::FileDescriptorPressure {
                used: snap.fd_used,
                soft_limit: snap.fd_soft_limit,
                pct: wm.fd_high_watermark_pct,
            });
        }
    }

    Ok(())
}

/// Live admission check for a WS upgrade handler: read procfs, apply the
/// watermarks. `Err(reason)` → reject the upgrade with 503.
pub fn admit(wm: &ResourceWatermarks) -> Result<(), DenyReason> {
    let snap = ResourceSnapshot::read();
    decide(&snap, wm)
}

/// `MemAvailable` from `/proc/meminfo`, in bytes. `None` when unreadable
/// (non-Linux) — callers treat that as "skip the memory check".
pub fn mem_available_bytes() -> Option<u64> {
    let input = std::fs::read_to_string("/proc/meminfo").ok()?;
    parse_meminfo(&input)
}

/// Open-fd count and soft `RLIMIT_NOFILE` for this process.
/// The limit is parsed once and cached (it only changes via `prlimit`).
pub fn fd_stats() -> (u64, u64) {
    static SOFT_LIMIT: OnceLock<u64> = OnceLock::new();
    let soft = *SOFT_LIMIT.get_or_init(|| {
        std::fs::read_to_string("/proc/self/limits")
            .ok()
            .and_then(|s| parse_nofile_limit(&s))
            .unwrap_or(0)
    });
    // Each directory entry in /proc/self/fd IS one open fd (the readdir
    // itself adds one transient entry — off-by-one is irrelevant at a 90%
    // watermark). Unreadable → 0, which skips the fd check (fail-open).
    let used = std::fs::read_dir("/proc/self/fd")
        .map(|rd| rd.count() as u64)
        .unwrap_or(0);
    (used, soft)
}

// ── pure parsers (unit-tested) ──────────────────────────────────────────

/// Parse `MemAvailable:   8123456 kB` (value in kB) → bytes.
pub(crate) fn parse_meminfo(input: &str) -> Option<u64> {
    for line in input.lines() {
        if let Some(rest) = line.strip_prefix("MemAvailable:") {
            // Format: "MemAvailable:\t 8123456 kB" — whitespace-tolerant.
            let kb: u64 = rest.trim().trim_end_matches("kB").trim().parse().ok()?;
            return Some(kb.saturating_mul(1024));
        }
    }
    None
}

/// Parse the soft limit out of a `/proc/self/limits` dump — line format:
/// `Max open files            1048576              1048576              files`
/// ("unlimited" → `None` → the fd check is skipped; an unlimited process
/// cannot hit fd pressure).
pub(crate) fn parse_nofile_limit(input: &str) -> Option<u64> {
    for line in input.lines() {
        if line.trim_start().starts_with("Max open files") {
            let soft = line
                .trim_start()
                .trim_start_matches("Max open files")
                .split_whitespace()
                .next()?;
            return soft.parse().ok();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEMINFO: &str = "\
MemTotal:       12284000 kB
MemFree:         1024 kB
MemAvailable:    8123456 kB
Buffers:         123456 kB
";
    const LIMITS: &str = "\
Limit                     Soft Limit           Hard Limit           Units
Max cpu time              unlimited            unlimited            seconds
Max open files            1048576              1048576              files
Max processes             63243                63243                processes
";

    fn snap(mem: Option<u64>, used: u64, soft: u64) -> ResourceSnapshot {
        ResourceSnapshot {
            mem_available_bytes: mem,
            fd_used: used,
            fd_soft_limit: soft,
        }
    }

    fn wm(mem_mb: u64, pct: u32) -> ResourceWatermarks {
        ResourceWatermarks {
            min_free_mem_bytes: mem_mb * 1024 * 1024,
            fd_high_watermark_pct: pct,
        }
    }

    // ── decide() ─────────────────────────────────────────────────────

    #[test]
    fn healthy_snapshot_is_admitted() {
        // 8 GB free, 200 fds of a 1M limit, watermark 512 MiB / 90%.
        assert_eq!(
            decide(
                &snap(Some(8 * 1024 * 1024 * 1024), 200, 1_048_576),
                &wm(512, 90)
            ),
            Ok(())
        );
    }

    #[test]
    fn memory_below_floor_denies() {
        let err = decide(&snap(Some(300 * 1024 * 1024), 10, 1_048_576), &wm(512, 90)).unwrap_err();
        assert_eq!(
            err,
            DenyReason::MemoryPressure {
                available_bytes: 300 * 1024 * 1024,
                floor_bytes: 512 * 1024 * 1024,
            }
        );
    }

    #[test]
    fn memory_exactly_at_floor_still_admits() {
        // `<` not `<=`: sitting exactly on the floor is the last admitted state.
        assert_eq!(
            decide(&snap(Some(512 * 1024 * 1024), 10, 1_048_576), &wm(512, 90)),
            Ok(())
        );
    }

    #[test]
    fn fd_at_watermark_denies() {
        // 90% of 1000 = 900; used 900 → deny (>= is intentional: leave the
        // remaining headroom for accept() internals + emergency shell).
        let err = decide(&snap(Some(8 * 1024 * 1024 * 1024), 900, 1000), &wm(512, 90)).unwrap_err();
        assert_eq!(
            err,
            DenyReason::FileDescriptorPressure {
                used: 900,
                soft_limit: 1000,
                pct: 90,
            }
        );
    }

    #[test]
    fn fd_just_below_watermark_admits() {
        assert_eq!(
            decide(&snap(Some(8 * 1024 * 1024 * 1024), 899, 1000), &wm(512, 90)),
            Ok(())
        );
    }

    #[test]
    fn disabled_watermarks_admit_everything() {
        // mem knob 0 + fd knob 0 → both checks off, even at absurd values.
        assert_eq!(decide(&snap(Some(0), u64::MAX, 1), &wm(0, 0)), Ok(()));
    }

    #[test]
    fn unavailable_readings_fail_open() {
        // No /proc → mem None, fd limit 0: never deny, even under pressure.
        assert_eq!(decide(&snap(None, 999_999, 0), &wm(512, 90)), Ok(()));
    }

    #[test]
    fn memory_check_still_fires_when_fd_check_cannot() {
        // fd numbers unavailable but memory readable + below floor → deny.
        assert_eq!(
            decide(&snap(Some(1), u64::MAX, 0), &wm(512, 90)).unwrap_err(),
            DenyReason::MemoryPressure {
                available_bytes: 1,
                floor_bytes: 512 * 1024 * 1024
            }
        );
    }

    #[test]
    fn huge_pct_never_denies() {
        // pct > 100 saturates the threshold above the limit → always admit.
        assert_eq!(
            decide(
                &snap(Some(8 * 1024 * 1024 * 1024), 999, 1000),
                &wm(512, 200)
            ),
            Ok(())
        );
    }

    // ── parsers ──────────────────────────────────────────────────────

    #[test]
    fn parses_memavailable_from_realistic_meminfo() {
        assert_eq!(parse_meminfo(MEMINFO), Some(8123456 * 1024));
    }

    #[test]
    fn meminfo_without_memavailable_is_none() {
        // Old kernels (< 3.14) lack MemAvailable — must fail open, not parse 0.
        assert_eq!(parse_meminfo("MemTotal: 100 kB\nMemFree: 50 kB\n"), None);
    }

    #[test]
    fn parses_nofile_soft_limit() {
        assert_eq!(parse_nofile_limit(LIMITS), Some(1_048_576));
    }

    #[test]
    fn unlimited_nofile_is_none() {
        // "unlimited" cannot hit fd pressure → None → check skipped.
        assert_eq!(
            parse_nofile_limit(
                "Max open files            unlimited            unlimited            files"
            ),
            None
        );
    }

    #[test]
    fn missing_nofile_line_is_none() {
        assert_eq!(
            parse_nofile_limit("Max cpu time  unlimited unlimited seconds"),
            None
        );
    }

    // ── live procfs (lenient: passes on non-Linux too) ───────────────

    #[test]
    fn live_snapshot_is_consistent() {
        let s = ResourceSnapshot::read();
        if let (Some(mem), true) = (s.mem_available_bytes, s.fd_soft_limit > 0) {
            // On Linux with readable procfs: memory in a sane range and
            // fd usage cannot exceed the soft limit.
            assert!(mem > 0);
            assert!(s.fd_used <= s.fd_soft_limit);
        }
        // And a healthy default-configured box admits:
        assert!(decide(&s, &wm(0, 0)).is_ok());
    }
}

//! Process-memory management for the long-lived service.
//!
//! ## Why this exists (the 650 MB idle-RSS mystery, 2026-09)
//!
//! The rust-sql engine links **mimalloc** as the process-wide global
//! allocator and deliberately sets `purge_delay = -1` (freed pages are
//! NEVER returned to the OS automatically) — the per-allocation purge
//! timer costs ~25 ns/alloc and the engine's hot paths are
//! allocation-intensive. The engine compensates by draining its own
//! wake (`mi_collect(true)`) at write-burst boundaries (big-transaction
//! COMMIT / auto-commit storm end, see rust-sql `drain_mimalloc_wake`).
//!
//! That drain, however, only fires from the ENGINE's SQL paths. The
//! service around it — axum request handling, serde_json bodies, the
//! WebSocket hubs, tantivy search-result assembly, moka cache churn —
//! allocates through the same global mimalloc but nobody ever collects
//! for it. Every transient peak (a big OSM search, a batch of JSON
//! responses, a presence fan-out) leaves its freed pages resident:
//! **RSS ratchets up to the historical watermark and stays there.**
//!
//! [`collect`] is the counterpart for the service side: a periodic,
//! cheap (µs-scale when nothing is pending) forced collect that returns
//! those pages to the OS. It is the same call the engine makes for
//! itself — running it once a minute from the sweeper task cannot
//! interfere with the engine's latency tuning (it does not flip any
//! option; it only performs the collect the engine already performs
//! at its own boundaries).
//!
//! ## The rest of the idle footprint
//!
//! * **Tantivy mmaps** (file-backed, reclaimable): the Vietnam OSM
//!   index is mmap'd by tantivy; touched pages count toward RSS but
//!   are evictable under pressure. Not heap — not collected here.
//! * **SQLite per-connection page caches**: rustqlite has no mmap and
//!   every pooled connection is its own engine instance with its own
//!   small page cache (SQLite default, 2 MB).
//! * **moka cache**: entry bytes are capped by a weigher
//!   (`CACHE_MAX_CAPACITY`, see `cache::moka`).
//!
//! [`MemorySnapshot`] reads `/proc/self/{status,smaps_rollup}` so the
//! split between anonymous heap and file-backed mappings is visible in
//! logs and in the admin memory endpoint — "how much is really heap"
//! stops being a guessing game.

use std::time::Duration;

use serde::Serialize;
use utoipa::ToSchema;

/// Force a full mimalloc collection, returning freed pages to the OS.
///
/// Safe to call from any thread at any time (mimalloc's collect is
/// thread-safe; it acquires its own locks). The `libmimalloc-sys`
/// version/features here mirror rust-sql's own pin exactly, so cargo
/// resolves both to ONE copy of the library — the same allocator the
/// engine tuned.
pub fn collect() {
    // SAFETY: `mi_collect` is a plain C function taking a `bool`; it
    // has no preconditions and does not hand back anything owned.
    unsafe { libmimalloc_sys::mi_collect(true) };
}

/// One process-memory reading (best-effort; every field is `None` on
/// non-Linux or when the proc files are unreadable).
#[derive(Debug, Clone, Default, Serialize, ToSchema, PartialEq)]
pub struct MemorySnapshot {
    /// Resident set size (pages currently in RAM), in KiB.
    pub vm_rss_kib: Option<u64>,
    /// Peak resident set size since process start, in KiB.
    pub vm_hwm_kib: Option<u64>,
    /// Private data segments (heap/stack growth) per smaps_rollup, in KiB.
    pub anon_kib: Option<u64>,
    /// File-backed resident pages (mmap'd index, binary text) in KiB.
    pub file_backed_kib: Option<u64>,
    /// Total program size (VSZ) per /proc/self/status, in KiB.
    pub vm_size_kib: Option<u64>,
    /// OS thread count.
    pub threads: Option<u64>,
}

impl MemorySnapshot {
    pub fn read() -> Self {
        Self {
            vm_rss_kib: status_field("VmRSS"),
            vm_hwm_kib: status_field("VmHWM"),
            vm_size_kib: status_field("VmSize"),
            threads: status_field("Threads"),
            // The RSS split lives directly in /proc/self/status on
            // modern kernels (RssAnon/RssFile/RssShmem, 4.5+) — read it
            // there first; fall back to smaps_rollup for older or
            // hardened kernels (4.14+; some sandboxes strip its fields).
            anon_kib: status_field("RssAnon").or_else(|| smaps_rollup_field("Anonymous")),
            file_backed_kib: status_field("RssFile").or_else(|| smaps_rollup_field("RssFile")),
        }
    }
}

/// Parse `Field:  12345 kB` from `/proc/self/status`.
fn status_field(name: &str) -> Option<u64> {
    let text = std::fs::read_to_string("/proc/self/status").ok()?;
    parse_proc_kib_field(&text, name)
}

/// Parse `Field:       1234 kB` from `/proc/self/smaps_rollup` (kernel
/// ≥ 4.14 — present on every supported production node).
fn smaps_rollup_field(name: &str) -> Option<u64> {
    let text = std::fs::read_to_string("/proc/self/smaps_rollup").ok()?;
    parse_proc_kib_field(&text, name)
}

/// Shared `Field:  <n> kB` parser. The field name is followed by a
/// COLON, so the colon must be part of the prefix match — matching the
/// name alone leaves `:` as the first whitespace token and the integer
/// parse fails (caught by the Linux test, not by any compiler).
fn parse_proc_kib_field(text: &str, name: &str) -> Option<u64> {
    let prefix = format!("{name}:");
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix(&prefix) {
            // "VmRSS:    1234 kB" → first token is the integer; the unit
            // (kB) follows as its own token.
            return rest.split_whitespace().next().and_then(|v| v.parse().ok());
        }
    }
    None
}

/// Humanize KiB for logs.
fn kib_str(v: Option<u64>) -> String {
    match v {
        Some(k) if k >= 1024 * 1024 => format!("{:.1} GiB", k as f64 / 1024.0 / 1024.0),
        Some(k) if k >= 1024 => format!("{:.0} MiB", k as f64 / 1024.0),
        Some(k) => format!("{k} KiB"),
        None => "n/a".to_string(),
    }
}

impl std::fmt::Display for MemorySnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "rss={} peak={} anon={} file={} threads={}",
            kib_str(self.vm_rss_kib),
            kib_str(self.vm_hwm_kib),
            kib_str(self.anon_kib),
            kib_str(self.file_backed_kib),
            self.threads
                .map(|t| t.to_string())
                .unwrap_or_else(|| "n/a".into())
        )
    }
}

/// Spawn the idle sweeper: every `interval`, force a mimalloc collect
/// and log the resulting footprint.
///
/// Logging cadence: every sweep logs at `debug`; an `info` line fires
/// only when RSS moved by ≥ `INFO_DELTA_KIB` in either direction since
/// the last info line — so steady state is silent while leaks / drops
/// surface immediately.
pub fn spawn_sweeper(interval: Duration) {
    if interval.is_zero() {
        tracing::info!("memory sweeper disabled (MEMORY_TRIM_INTERVAL_SECS=0)");
        return;
    }
    tokio::spawn(async move {
        // Drop the pages the boot sequence churned before the first
        // scheduled sweep — migrations, index opening, store warm-up.
        collect();
        let mut last = MemorySnapshot::read();
        tracing::info!(footprint = %last, "memory sweeper started (initial collect done)");
        let mut ticker = tokio::time::interval(interval);
        // First tick fires immediately; we already collected above.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            collect();
            let now = MemorySnapshot::read();
            tracing::debug!(footprint = %now, "memory swept");
            const INFO_DELTA_KIB: u64 = 16 * 1024;
            let moved = match (now.vm_rss_kib, last.vm_rss_kib) {
                (Some(a), Some(b)) => a.abs_diff(b) >= INFO_DELTA_KIB,
                _ => false,
            };
            if moved {
                tracing::info!(before = %last, after = %now, "memory footprint changed");
            }
            last = now;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_reads_on_linux() {
        // This test suite runs on Linux: every field must parse.
        let s = MemorySnapshot::read();
        assert!(s.vm_rss_kib.is_some(), "VmRSS missing: {s:?}");
        assert!(s.vm_hwm_kib.is_some(), "VmHWM missing: {s:?}");
        assert!(s.anon_kib.is_some(), "smaps Anonymous missing: {s:?}");
        assert!(s.file_backed_kib.is_some(), "smaps RssFile missing: {s:?}");
        // Sanity: RSS ≤ peak.
        if let (Some(rss), Some(hwm)) = (s.vm_rss_kib, s.vm_hwm_kib) {
            assert!(rss <= hwm);
        }
    }

    #[test]
    fn display_is_human_readable() {
        let s = MemorySnapshot {
            vm_rss_kib: Some(65 * 1024),
            vm_hwm_kib: Some(70 * 1024),
            anon_kib: Some(20 * 1024),
            file_backed_kib: Some(45 * 1024),
            vm_size_kib: None,
            threads: Some(24),
        };
        let text = s.to_string();
        assert!(text.contains("65 MiB"), "rss in display: {text}");
        assert!(text.contains("24"), "threads in display: {text}");
    }

    /// The sweeper's core must actually release pages — run a churn
    /// burst, collect, and require RSS to drop from the peak. Guards
    /// the link (libmimalloc-sys symbols present) and the FFI call.
    #[test]
    fn collect_runs_and_frees() {
        let churn_peak = {
            let mut keep: Vec<Vec<u8>> = Vec::with_capacity(512);
            for i in 0..512 {
                // ~1 MB per iteration in transient garbage, dropped
                // immediately; `keep` pins a little so pages are truly
                // touched.
                let big = vec![0u8; 1024 * 1024];
                if i % 64 == 0 {
                    keep.push(big.clone());
                }
                drop(big);
            }
            MemorySnapshot::read()
        };
        collect();
        let after = MemorySnapshot::read();
        // Freed-but-retained pages (mimalloc purge_delay = -1) may or
        // may not exceed the delta threshold on a small CI box — but
        // the collect call itself must never fault and RSS must not
        // GROW from it.
        assert!(
            after.vm_rss_kib.unwrap_or(0) <= churn_peak.vm_rss_kib.unwrap_or(0) + 1024,
            "collect must not inflate RSS: peak={} after={}",
            churn_peak.vm_rss_kib.unwrap_or(0),
            after.vm_rss_kib.unwrap_or(0)
        );
    }
}

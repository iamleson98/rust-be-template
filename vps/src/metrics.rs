//! What `/v1/status` reports about the machine and the service: CPU, memory,
//! disk, load, request latency. Read from `/proc` on Linux (the VPS); fields
//! the platform cannot provide are `null`, never a made-up zero.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

/// Latency samples kept per endpoint for the percentiles.
const WINDOW: usize = 2048;

#[derive(Default)]
struct Window {
    samples: VecDeque<f32>,
    count: u64,
    errors: u64,
}

/// Request count, error count and recent latency of one endpoint.
#[derive(Default)]
pub struct Latency(Mutex<Window>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencySummary {
    pub count: u64,
    pub errors: u64,
    /// Over the last `window` requests.
    pub window: usize,
    pub p50_ms: Option<f32>,
    pub p95_ms: Option<f32>,
    pub p99_ms: Option<f32>,
    pub max_ms: Option<f32>,
}

impl Latency {
    pub fn record(&self, elapsed: Duration, ok: bool) {
        let mut w = self.0.lock().unwrap();
        w.count += 1;
        if !ok {
            w.errors += 1;
        }
        if w.samples.len() == WINDOW {
            w.samples.pop_front();
        }
        w.samples.push_back(elapsed.as_secs_f32() * 1000.0);
    }

    pub fn summary(&self) -> LatencySummary {
        let w = self.0.lock().unwrap();
        let mut sorted: Vec<f32> = w.samples.iter().copied().collect();
        sorted.sort_by(f32::total_cmp);
        let pct = |p: f32| -> Option<f32> {
            if sorted.is_empty() {
                return None;
            }
            let i = ((sorted.len() - 1) as f32 * p).round() as usize;
            Some((sorted[i] * 100.0).round() / 100.0)
        };
        LatencySummary {
            count: w.count,
            errors: w.errors,
            window: sorted.len(),
            p50_ms: pct(0.5),
            p95_ms: pct(0.95),
            p99_ms: pct(0.99),
            max_ms: sorted.last().map(|m| (m * 100.0).round() / 100.0),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub cpus: usize,
    /// Whole machine, percent of all cores, over the last sampling interval.
    pub cpu_percent: Option<f32>,
    /// This service, percent of one core (100 = one core busy).
    pub process_cpu_percent: Option<f32>,
    pub load_average: Option<[f32; 3]>,
    pub memory_total_bytes: Option<u64>,
    pub memory_available_bytes: Option<u64>,
    pub process_rss_bytes: Option<u64>,
    pub disk_total_bytes: Option<u64>,
    pub disk_free_bytes: Option<u64>,
    pub system_uptime_secs: Option<u64>,
}

/// CPU counters at one instant (clock ticks).
#[derive(Clone, Copy)]
struct CpuTicks {
    busy: u64,
    total: u64,
    process: u64,
    at: std::time::Instant,
}

/// Samples CPU usage periodically (a percentage needs two readings) and
/// answers the rest on demand.
pub struct Sampler {
    data_dir: PathBuf,
    last: Mutex<Option<CpuTicks>>,
    cpu: Mutex<(Option<f32>, Option<f32>)>,
}

impl Sampler {
    pub fn new(data_dir: &Path) -> Sampler {
        Sampler {
            data_dir: data_dir.to_path_buf(),
            last: Mutex::new(read_cpu_ticks()),
            cpu: Mutex::new((None, None)),
        }
    }

    /// Takes a CPU reading; call every few seconds.
    pub fn tick(&self) {
        let Some(now) = read_cpu_ticks() else {
            return;
        };
        let mut last = self.last.lock().unwrap();
        if let Some(prev) = *last {
            let total = now.total.saturating_sub(prev.total);
            let busy = now.busy.saturating_sub(prev.busy);
            let secs = now.at.duration_since(prev.at).as_secs_f32();
            let machine = (total > 0).then(|| busy as f32 * 100.0 / total as f32);
            let process = (secs > 0.0).then(|| {
                now.process.saturating_sub(prev.process) as f32 / clock_ticks() / secs * 100.0
            });
            *self.cpu.lock().unwrap() = (machine.map(round1), process.map(round1));
        }
        *last = Some(now);
    }

    pub fn snapshot(&self) -> SystemSnapshot {
        let (cpu_percent, process_cpu_percent) = *self.cpu.lock().unwrap();
        let meminfo = std::fs::read_to_string("/proc/meminfo").ok();
        let mem = |key: &str| meminfo.as_deref().and_then(|m| kib_field(m, key));
        let (disk_total_bytes, disk_free_bytes) = disk(&self.data_dir).unzip();
        SystemSnapshot {
            cpus: std::thread::available_parallelism().map_or(1, |n| n.get()),
            cpu_percent,
            process_cpu_percent,
            load_average: load_average(),
            memory_total_bytes: mem("MemTotal:"),
            memory_available_bytes: mem("MemAvailable:"),
            process_rss_bytes: std::fs::read_to_string("/proc/self/status")
                .ok()
                .and_then(|s| kib_field(&s, "VmRSS:")),
            disk_total_bytes,
            disk_free_bytes,
            system_uptime_secs: std::fs::read_to_string("/proc/uptime")
                .ok()
                .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
                .map(|s| s as u64),
        }
    }
}

fn round1(x: f32) -> f32 {
    (x * 10.0).round() / 10.0
}

/// `Key:   12345 kB` → bytes.
fn kib_field(text: &str, key: &str) -> Option<u64> {
    let line = text.lines().find(|l| l.starts_with(key))?;
    let kib: u64 = line[key.len()..].split_whitespace().next()?.parse().ok()?;
    Some(kib * 1024)
}

fn clock_ticks() -> f32 {
    // SAFETY: sysconf has no preconditions.
    let t = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if t > 0 {
        t as f32
    } else {
        100.0
    }
}

fn read_cpu_ticks() -> Option<CpuTicks> {
    let stat = std::fs::read_to_string("/proc/stat").ok()?;
    let fields: Vec<u64> = stat
        .lines()
        .next()?
        .split_whitespace()
        .skip(1)
        .filter_map(|f| f.parse().ok())
        .collect();
    // user nice system idle iowait irq softirq steal …
    let idle = fields.get(3)? + fields.get(4).copied().unwrap_or(0);
    let total: u64 = fields.iter().take(8).sum();
    let own = std::fs::read_to_string("/proc/self/stat").ok()?;
    // The command name may contain spaces: fields start after the last ')'.
    let after = &own[own.rfind(')')? + 2..];
    let f: Vec<&str> = after.split_whitespace().collect();
    // utime and stime are fields 14 and 15 of the full line (11 and 12 here).
    let process = f.get(11)?.parse::<u64>().ok()? + f.get(12)?.parse::<u64>().ok()?;
    Some(CpuTicks {
        busy: total - idle,
        total,
        process,
        at: std::time::Instant::now(),
    })
}

fn load_average() -> Option<[f32; 3]> {
    let text = std::fs::read_to_string("/proc/loadavg").ok()?;
    let mut it = text.split_whitespace().map(|v| v.parse::<f32>().ok());
    Some([it.next()??, it.next()??, it.next()??])
}

fn disk(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: `c` is a valid NUL-terminated path and `buf` is a properly sized out-parameter.
    let mut buf: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut buf) } != 0 {
        return None;
    }
    let block = buf.f_frsize as u64;
    Some((buf.f_blocks as u64 * block, buf.f_bavail as u64 * block))
}

/// Resource use of finished child processes (the extractor), cumulative.
#[derive(Debug, Clone, Copy, Default)]
pub struct ChildUsage {
    pub cpu_secs: f64,
    /// Largest resident set of any finished child, bytes.
    pub max_rss_bytes: u64,
}

pub fn children_usage() -> ChildUsage {
    // SAFETY: getrusage fills the zeroed out-parameter.
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrusage(libc::RUSAGE_CHILDREN, &mut ru) } != 0 {
        return ChildUsage::default();
    }
    let secs = |t: libc::timeval| t.tv_sec as f64 + t.tv_usec as f64 / 1e6;
    // Linux reports kilobytes, macOS bytes.
    let rss_unit = if cfg!(target_os = "macos") { 1 } else { 1024 };
    ChildUsage {
        cpu_secs: secs(ru.ru_utime) + secs(ru.ru_stime),
        max_rss_bytes: ru.ru_maxrss as u64 * rss_unit,
    }
}

/// Lowers the calling thread's CPU and I/O priority for good: the weekly
/// index run must never slow down search. (Unprivileged code cannot raise
/// it again, so call it only on a thread or process made for the job.)
pub fn lower_priority() {
    #[cfg(target_os = "linux")]
    // SAFETY: plain syscalls on the calling thread; failures are harmless.
    unsafe {
        let tid = libc::syscall(libc::SYS_gettid) as libc::id_t;
        libc::setpriority(libc::PRIO_PROCESS, tid, 19);
        // IOPRIO_WHO_PROCESS = 1, class IDLE = 3 (shifted by IOPRIO_CLASS_SHIFT = 13).
        libc::syscall(libc::SYS_ioprio_set, 1, tid, 3 << 13);
    }
    #[cfg(not(target_os = "linux"))]
    // SAFETY: setpriority on the calling process; failure is harmless.
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, 19);
    }
}

/// Returns freed heap pages to the OS (glibc keeps them otherwise, and the
/// service's resident size would stay at the build's peak all week).
pub fn release_free_memory() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: malloc_trim only releases memory the allocator holds unused.
    unsafe {
        libc::malloc_trim(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_over_the_window() {
        let l = Latency::default();
        assert_eq!(l.summary().p50_ms, None);
        for ms in 1..=100 {
            l.record(Duration::from_millis(ms), ms != 100);
        }
        let s = l.summary();
        assert_eq!((s.count, s.errors, s.window), (100, 1, 100));
        assert_eq!(s.p50_ms, Some(51.0));
        assert_eq!(s.p95_ms, Some(95.0));
        assert_eq!(s.max_ms, Some(100.0));
    }

    #[test]
    fn parses_proc_fields() {
        let meminfo = "MemTotal:        4028536 kB\nMemAvailable:    3120000 kB\n";
        assert_eq!(kib_field(meminfo, "MemTotal:"), Some(4028536 * 1024));
        assert_eq!(kib_field(meminfo, "Missing:"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reports_real_numbers_on_linux() {
        let sampler = Sampler::new(Path::new("/"));
        // Burn a little CPU so the second reading differs from the first.
        let mut x = 0u64;
        for i in 0..20_000_000u64 {
            x = x.wrapping_add(i * i);
        }
        assert!(x > 0);
        sampler.tick();
        let s = sampler.snapshot();
        assert!(s.memory_total_bytes.unwrap() > 0);
        assert!(s.memory_available_bytes.unwrap() <= s.memory_total_bytes.unwrap());
        assert!(s.process_rss_bytes.unwrap() > 0);
        assert!(s.load_average.is_some());
        assert!(s.system_uptime_secs.unwrap() > 0);
        assert!(s.cpu_percent.is_some() && s.process_cpu_percent.is_some());
    }

    #[test]
    fn reads_the_disk_of_a_path() {
        let (total, free) = disk(Path::new("/")).unwrap();
        assert!(total > 0 && free <= total);
    }
}

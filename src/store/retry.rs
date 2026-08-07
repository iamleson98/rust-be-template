//! Retry policy trait. Implemented by any struct that wants `#[retry]`
//! to apply to its methods. Default impl is 3 retries, 100ms base delay,
//! exponential backoff **with jitter** to avoid thundering herd.

use std::time::Duration;

use super::error::StoreError;

/// Retry policy for `#[retry]`-annotated impls. The macro calls these
/// methods on `self` to decide when and how long to wait between attempts.
///
/// Override any method on your struct to customize the policy.
pub trait RetryPolicy: Send + Sync {
    /// Max retry attempts (excluding the initial attempt). Default: 3.
    fn max_retries(&self) -> usize {
        3
    }

    /// Base delay before the first retry. Default: 100ms.
    fn base_delay(&self) -> Duration {
        Duration::from_millis(100)
    }

    /// Whether to retry on this error. Default: only retryable DB errors.
    fn should_retry(&self, err: &StoreError) -> bool {
        err.is_retryable()
    }

    /// Delay before attempt N (0-indexed). Default: `base_delay * 2^attempt`
    /// (exponential backoff) **plus up to 25% jitter** to avoid
    /// thundering-herd retries overwhelming a recovering DB.
    fn delay_for(&self, attempt: usize) -> Duration {
        let base = self.base_delay() * (1u32 << attempt.min(10));
        // Add up to 25% jitter to avoid synchronized retry storms.
        // Using `Instant`/`rand` would add a dep; we use a thread-local
        // PRNG seeded by the attempt + a per-process counter.
        let jitter_micros = (base.as_micros() as u64) / 4;
        let jitter = thread_local_rng() % jitter_micros.saturating_add(1);
        base + Duration::from_micros(jitter)
    }
}

/// Tiny thread-local xorshift PRNG — no external deps, no global state.
/// Adequate for jitter; not for crypto.
fn thread_local_rng() -> u64 {
    use std::cell::Cell;
    thread_local! {
        static STATE: Cell<u64> = Cell::new({
            // Seed from time + thread id. Good enough for jitter.
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(1);
            let tid = std::thread::current().id();
            // Convert ThreadId to u64 via its Debug repr (lossy but unique enough).
            let tid_hash = format!("{tid:?}").bytes().fold(0u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64));
            nanos ^ tid_hash ^ 0x9E3779B97F4A7C15
        });
    }
    STATE.with(|s| {
        let mut x = s.get();
        // xorshift64*
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        s.set(x);
        x.wrapping_mul(0x2545F4914F6CDD1D)
    })
}

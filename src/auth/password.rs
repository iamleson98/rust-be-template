use std::sync::mpsc;
use std::sync::OnceLock;

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher as _, PasswordVerifier as _, SaltString,
};
use argon2::Argon2;
use tokio::sync::oneshot;

/// Wrapper around `argon2` for hashing and verifying passwords.
#[derive(Clone, Default)]
pub struct PasswordHasher;

/// A job for the dedicated argon2 worker pool.
enum Job {
    Hash {
        password: String,
        reply: oneshot::Sender<anyhow::Result<String>>,
    },
    Verify {
        password: String,
        hash: String,
        reply: oneshot::Sender<bool>,
    },
}

/// Number of dedicated argon2 worker threads.
///
/// Argon2id at the default params (m=19 MiB, t=2) takes 50–150 ms per
/// operation — two workers absorb sustained login bursts of ~15–40/s;
/// beyond that callers queue (each queued job is two short `String`s,
/// so queue memory is trivial). See [`workers`] for why the count is
/// small and FIXED rather than elastic.
const WORKER_THREADS: usize = 2;

/// The dedicated argon2 worker pool — THE fix for the 2026-09-21
/// login-RSS leak.
///
/// ## What went wrong before (measured in production)
///
/// `login`/`register` used to run Argon2 via
/// `tokio::task::spawn_blocking`. Tokio's blocking pool spins up a FRESH
/// OS thread whenever its existing ones are busy, and the process
/// allocator is **mimalloc with `purge_delay = -1`** (set once by the
/// rust-sql engine for write-latency; see `rust-sql/src/lib.rs`).
/// mimalloc heaps are THREAD-LOCAL: Argon2's multi-MB working set —
/// freed at the end of every verify — stays resident in whichever
/// blocking thread happened to run it, and with purging disabled those
/// pages are never returned to the OS. Under a burst of concurrent
/// logins every request landed on a different blocking thread, each
/// stranding its own copy:
///
/// ```text
/// 60 concurrent logins  →  +154 MB RSS (≈2.5 MB stranded per login)
/// 60 sequential logins  →  +40 kB       (same thread → heap reuse)
/// mi_collect(true) × N  →  0 kB returned (live thread heaps untouched)
/// 9 minutes later       →  still 0 kB returned (permanent)
/// ```
///
/// For a public site where every customer login costs 2.5 MB forever,
/// that is ~1 GB/day of ratchet at modest traffic — the "RAM slowly
/// increases and never decreases" report.
///
/// ## The fix
///
/// Run ALL Argon2 work on a FIXED pair of dedicated threads. The first
/// verify pays the one-time working set; every subsequent verify
/// reuses the same thread's heap (free lists — that is exactly the
/// sequential-login measurement above), so steady-state cost is a
/// bounded 2 × ~2.5 MB regardless of login volume or concurrency.
///
/// The pool is a process-wide `OnceLock` shared by every
/// `PasswordHasher` clone (it is a unit struct — one global is one pool).
/// Threads are plain `std::thread`s named for diagnostics; they exit
/// with the process (the channel closes at shutdown → `recv` errors →
/// loop breaks).
fn workers() -> &'static mpsc::Sender<Job> {
    static WORKERS: OnceLock<mpsc::Sender<Job>> = OnceLock::new();
    WORKERS.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        // One receiver, N threads: `Receiver` is single-consumer, so the
        // threads share it behind a mutex. `recv()` blocks while holding
        // the lock — exactly the semantics we want: whichever worker is
        // parked first takes the next job; the other parks behind it.
        let rx = std::sync::Arc::new(std::sync::Mutex::new(rx));
        for i in 0..WORKER_THREADS {
            let rx = rx.clone();
            std::thread::Builder::new()
                .name(format!("argon2-worker-{i}"))
                .spawn(move || loop {
                    let job = {
                        let guard = rx.lock().expect("argon2 worker lock poisoned");
                        guard.recv()
                    };
                    match job {
                        Ok(Job::Hash { password, reply }) => {
                            let _ = reply.send(hash_blocking(&password));
                        }
                        Ok(Job::Verify {
                            password,
                            hash,
                            reply,
                        }) => {
                            let _ = reply.send(verify_blocking(&password, &hash));
                        }
                        // Channel closed — the process is shutting down.
                        Err(_) => break,
                    }
                })
                .expect("failed to spawn argon2 worker thread");
        }
        tx
    })
}

/// Plain (blocking) hash — used by the worker loop and available for
/// non-async callers (CLI, tests).
fn hash_blocking(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("hash: {e}"))?;
    Ok(hash.to_string())
}

/// Plain (blocking) verify — used by the worker loop and available for
/// non-async callers (CLI, tests).
fn verify_blocking(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

impl PasswordHasher {
    pub fn new() -> Self {
        Self
    }

    pub fn hash(&self, password: &str) -> anyhow::Result<String> {
        hash_blocking(password)
    }

    pub fn verify(&self, password: &str, hash: &str) -> bool {
        verify_blocking(password, hash)
    }

    /// Async hash on the dedicated argon2 pool.
    ///
    /// Replaces `spawn_blocking(hash)` in `register`: the working set is
    /// allocated on a FIXED worker thread whose mimalloc heap is reused
    /// by the next job instead of being stranded (see [`workers`]).
    /// A dropped reply (worker died mid-job) surfaces as an error.
    pub async fn hash_async(&self, password: String) -> anyhow::Result<String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        if workers()
            .send(Job::Hash {
                password,
                reply: reply_tx,
            })
            .is_err()
        {
            anyhow::bail!("argon2 worker pool is shut down");
        }
        reply_rx
            .await
            .unwrap_or_else(|_| anyhow::bail!("argon2 worker dropped the hash job"))
    }

    /// Async verify on the dedicated argon2 pool.
    ///
    /// Replaces `spawn_blocking(verify)` in `login`: same thread-reuse
    /// guarantee (see [`workers`]). A dropped reply (worker died
    /// mid-job) is conservatively reported as a FAILED verification —
    /// the caller responds 401 and the client retries.
    pub async fn verify_async(&self, password: String, hash: String) -> bool {
        let (reply_tx, reply_rx) = oneshot::channel();
        if workers()
            .send(Job::Verify {
                password,
                hash,
                reply: reply_tx,
            })
            .is_err()
        {
            return false;
        }
        reply_rx.await.unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify_roundtrip_blocking() {
        let h = PasswordHasher::new();
        let hash = h.hash("correct horse battery staple").expect("hash");
        assert!(h.verify("correct horse battery staple", &hash));
        assert!(!h.verify("wrong password", &hash));
    }

    #[tokio::test]
    async fn hash_then_verify_roundtrip_async() {
        let h = PasswordHasher::new();
        let hash = h
            .hash_async("correct horse battery staple".into())
            .await
            .expect("hash_async");
        assert!(
            h.verify_async("correct horse battery staple".into(), hash.clone())
                .await
        );
        assert!(!h.verify_async("wrong password".into(), hash).await);
    }

    #[tokio::test]
    async fn malformed_hash_fails_closed() {
        let h = PasswordHasher::new();
        assert!(!h.verify_async("pw".into(), "not-a-phc-hash".into()).await);
    }

    /// A burst of concurrent verifies must all round-trip correctly
    /// through the shared worker pool (job fan-out + reply pairing).
    #[tokio::test]
    async fn concurrent_verifies_pair_replies_correctly() {
        let h = PasswordHasher::new();
        // One distinct hash per task; each task verifies its own password
        // against its own hash AND a decoy — replies must never cross.
        let mut tasks = Vec::new();
        for i in 0..8 {
            let h = h.clone();
            tasks.push(tokio::spawn(async move {
                let pw = format!("password-{i}");
                let hash = h.hash_async(pw.clone()).await.expect("hash");
                let good = h.verify_async(pw, hash.clone()).await;
                let bad = h.verify_async("decoy".into(), hash).await;
                (good, !bad)
            }));
        }
        for t in tasks {
            let (good, bad_rejected) = t.await.expect("task join");
            assert!(good, "own password must verify");
            assert!(bad_rejected, "decoy must be rejected");
        }
    }
}

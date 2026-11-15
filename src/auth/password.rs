use std::sync::mpsc;
use std::sync::OnceLock;

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher as _, PasswordVerifier as _, SaltString,
};
use argon2::{Argon2, Params};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use sha2::Sha256;
use tokio::sync::oneshot;

/// Wrapper around `argon2` for hashing and verifying passwords.
///
/// New hashes are always Argon2id. Verification also accepts the
/// `pbkdf2$<iterations>$<salt>$<hash>` form the Cloudflare Worker wrote
/// (WebCrypto cannot run Argon2, so it re-hashed every user to PBKDF2);
/// [`needs_rehash`] tells the login path to upgrade such a row.
#[derive(Clone, Default)]
pub struct PasswordHasher;

/// Largest PBKDF2 iteration count a stored hash may ask for, so a
/// tampered or imported row cannot burn CPU. The Worker wrote 100 000.
const PBKDF2_MAX_ITERATIONS: u32 = 1_000_000;

/// Length of the derived key in a Worker-written PBKDF2 hash.
const PBKDF2_KEY_LEN: usize = 32;

/// Upper bounds on the Argon2 parameters of a stored hash (memory in
/// KiB, passes, lanes), for the same reason.
const ARGON2_MAX_MEMORY_KIB: u32 = 64 * 1024;
const ARGON2_MAX_PASSES: u32 = 6;
const ARGON2_MAX_LANES: u32 = 4;

/// An Argon2id hash (default parameters) of a password nobody knows:
/// what an unknown account is "verified" against, so the answer takes as
/// long as a real check. See [`PasswordHasher::spend_verify_time`].
const DECOY_HASH: &str =
    "$argon2id$v=19$m=19456,t=2,p=1$/vkPL4HQlKXIVmXe8+HXpA$0DlHKUpIPwRsS9KU97iVcp1HQgwIf6/7uaeCLKu+0CE";

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
/// allocator is **mimalloc**. When this was measured it ran with
/// `purge_delay = -1` (an option the previous database engine set; it
/// is no longer set, but the thread-local heap behaviour below is
/// allocator design and still applies). SQLite itself now allocates
/// through glibc malloc, not mimalloc. mimalloc heaps are THREAD-LOCAL:
/// Argon2's multi-MB working set — freed at the end of every verify —
/// stays resident in whichever blocking thread happened to run it, and
/// with purging disabled those pages are never returned to the OS.
/// Under a burst of concurrent logins every request landed on a
/// different blocking thread, each stranding its own copy:
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
/// non-async callers (CLI, tests). Dispatches on the stored format;
/// anything unrecognised or malformed fails closed.
fn verify_blocking(password: &str, hash: &str) -> bool {
    if hash.starts_with("pbkdf2$") {
        verify_pbkdf2(password, hash)
    } else {
        verify_argon2(password, hash)
    }
}

fn verify_argon2(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    let Ok(params) = Params::try_from(&parsed) else {
        return false;
    };
    if params.m_cost() > ARGON2_MAX_MEMORY_KIB
        || params.t_cost() > ARGON2_MAX_PASSES
        || params.p_cost() > ARGON2_MAX_LANES
    {
        return false;
    }
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// `pbkdf2$<iterations>$<salt>$<hash>`: PBKDF2-HMAC-SHA256, a 32-byte
/// key, salt and key in standard padded base64.
fn verify_pbkdf2(password: &str, hash: &str) -> bool {
    let mut parts = hash.split('$');
    let (Some("pbkdf2"), Some(iterations), Some(salt), Some(expected), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return false;
    };
    let Ok(iterations) = iterations.parse::<u32>() else {
        return false;
    };
    if !(1..=PBKDF2_MAX_ITERATIONS).contains(&iterations) {
        return false;
    }
    let (Ok(salt), Ok(expected)) = (STANDARD.decode(salt), STANDARD.decode(expected)) else {
        return false;
    };
    let mut derived = [0u8; PBKDF2_KEY_LEN];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, iterations, &mut derived);
    constant_time_eq::constant_time_eq(&derived, &expected)
}

/// Whether a stored hash should be replaced by a fresh Argon2id one now
/// that the plaintext is at hand: anything that is not Argon2id with the
/// current parameters (a Worker-written PBKDF2 hash, or a weaker or
/// stronger Argon2 setting).
pub fn needs_rehash(stored: &str) -> bool {
    PasswordHash::new(stored)
        .ok()
        .filter(|parsed| parsed.algorithm.as_str() == "argon2id")
        .and_then(|parsed| Params::try_from(&parsed).ok())
        .is_none_or(|params| !same_cost(&params, &Params::default()))
}

/// Whether two parameter sets cost the same (the PHC string's hash
/// length is not part of the cost).
fn same_cost(a: &Params, b: &Params) -> bool {
    (a.m_cost(), a.t_cost(), a.p_cost()) == (b.m_cost(), b.t_cost(), b.p_cost())
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

    /// Run one verification against a throwaway hash on the worker pool.
    ///
    /// The unknown-account path of a login calls this so that a wrong
    /// email and a wrong password take the same time to answer.
    pub async fn spend_verify_time(&self, password: String) {
        self.verify_async(password, DECOY_HASH.to_string()).await;
    }

    /// Async hash on the dedicated argon2 pool.
    ///
    /// Replaces `spawn_blocking(hash)` in `register`: the working set is
    /// allocated on a FIXED worker thread whose mimalloc heap is reused
    /// by the next job instead of being stranded (see `workers`).
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
    /// guarantee (see `workers`). A dropped reply (worker died
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

    /// The Worker's own `hashPassword` output (Node WebCrypto, see
    /// `tests/fixtures/wp6_ref_auth.json`) verifies, constant-time, and a
    /// wrong password does not.
    #[test]
    fn worker_pbkdf2_hash_verifies() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/wp6_ref_auth.json"))
                .expect("fixture");
        let hash = fixture["passwordHash"].as_str().expect("hash");
        let password = fixture["password"].as_str().expect("password");
        assert!(hash.starts_with("pbkdf2$100000$"));
        let h = PasswordHasher::new();
        assert!(h.verify(password, hash));
        assert!(!h.verify("mật-khẩu Ü 124", hash));
        assert!(!h.verify("", hash));
    }

    fn pbkdf2_hash(password: &str, iterations: u32) -> String {
        let salt = [7u8; 16];
        let mut derived = [0u8; PBKDF2_KEY_LEN];
        pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, iterations, &mut derived);
        format!(
            "pbkdf2${iterations}${}${}",
            STANDARD.encode(salt),
            STANDARD.encode(derived)
        )
    }

    #[test]
    fn pbkdf2_iteration_count_is_bounded_both_ways() {
        let h = PasswordHasher::new();
        assert!(h.verify("pw", &pbkdf2_hash("pw", 1)));
        assert!(h.verify("pw", &pbkdf2_hash("pw", 1_000)));
        // A count outside 1..=1_000_000 is refused before any work is done,
        // even when the key matches what that count would have produced.
        let zero = pbkdf2_hash("pw", 1).replacen("$1$", "$0$", 1);
        assert!(!h.verify("pw", &zero));
        let huge = pbkdf2_hash("pw", 1).replacen("$1$", "$1000001$", 1);
        assert!(!h.verify("pw", &huge));
    }

    #[test]
    fn malformed_pbkdf2_hashes_fail_closed() {
        let h = PasswordHasher::new();
        let good = pbkdf2_hash("pw", 10);
        assert!(h.verify("pw", &good));
        for bad in [
            "pbkdf2$",
            "pbkdf2$10$",
            "pbkdf2$10$AAAA",
            "pbkdf2$ten$AAAA$AAAA",
            "pbkdf2$-5$AAAA$AAAA",
            "pbkdf2$10$not base64!$AAAA",
            "pbkdf2$10$AAAA$not base64!",
        ] {
            assert!(!h.verify("pw", bad), "{bad}");
        }
        assert!(!h.verify("pw", &format!("{good}$extra")));
        // Unpadded base64 is not the Worker's format.
        assert!(!h.verify("pw", &good.replace('=', "")));
        // A wrong-length key never matches.
        let short = format!("pbkdf2$10${}$AAAA", STANDARD.encode([7u8; 16]));
        assert!(!h.verify("pw", &short));
    }

    /// A hash the Worker imported from this backend (argon2-cffi output
    /// with `Argon2::default()` parameters) still verifies.
    #[test]
    fn legacy_argon2_hash_verifies() {
        let h = PasswordHasher::new();
        assert!(h.verify("S3cret-pässword", DECOY_HASH));
        assert!(!h.verify("wrong", DECOY_HASH));
    }

    #[test]
    fn oversized_argon2_parameters_are_refused() {
        let h = PasswordHasher::new();
        let huge_memory = DECOY_HASH.replace("m=19456", "m=4194304");
        assert!(!h.verify("S3cret-pässword", &huge_memory));
        let many_passes = DECOY_HASH.replace("t=2", "t=7");
        assert!(!h.verify("S3cret-pässword", &many_passes));
        let many_lanes = DECOY_HASH.replace("p=1", "p=5");
        assert!(!h.verify("S3cret-pässword", &many_lanes));
    }

    #[test]
    fn only_current_argon2id_hashes_skip_the_rehash() {
        let h = PasswordHasher::new();
        let fresh = h.hash("pw").expect("hash");
        assert!(!needs_rehash(&fresh));
        assert!(!needs_rehash(DECOY_HASH));
        assert!(needs_rehash(&pbkdf2_hash("pw", 100_000)));
        assert!(needs_rehash(&DECOY_HASH.replace("t=2", "t=3")));
        assert!(needs_rehash(&DECOY_HASH.replace("argon2id", "argon2i")));
        assert!(needs_rehash("hashed_password"));
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

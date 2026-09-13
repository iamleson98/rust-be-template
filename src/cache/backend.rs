use async_trait::async_trait;
use dashmap::DashMap;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::watch;

/// Values stored in the cache must be serializable. We round-trip via
/// `serde_json::Value` so backend implementations only need to handle
/// one type (`CacheValue::Json`) regardless of the user's struct.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CacheValue {
    Json(serde_json::Value),
    Bytes(Vec<u8>),
}

impl CacheValue {
    pub fn from_serializable<T: Serialize>(v: &T) -> anyhow::Result<Self> {
        Ok(CacheValue::Json(serde_json::to_value(v)?))
    }
    pub fn into_serializable<T: DeserializeOwned>(self) -> anyhow::Result<T> {
        match self {
            CacheValue::Json(v) => Ok(serde_json::from_value(v)?),
            CacheValue::Bytes(b) => Ok(serde_json::from_slice(&b)?),
        }
    }

    /// Rough in-memory size of the value (bytes), used by the moka
    /// weigher so `CACHE_MAX_CAPACITY` caps total cached BYTES. Exact
    /// accounting (re-serializing every JSON value) would cost more
    /// than it is worth; string bytes + a per-node overhead estimate
    /// is well within "honest budget" territory for eviction.
    pub fn estimated_bytes(&self) -> usize {
        const NODE_OVERHEAD: usize = 48;
        fn json_size(v: &serde_json::Value) -> usize {
            match v {
                serde_json::Value::Null => 8,
                serde_json::Value::Bool(_) => 8,
                serde_json::Value::Number(_) => 16,
                serde_json::Value::String(s) => s.capacity() + NODE_OVERHEAD,
                serde_json::Value::Array(a) => {
                    a.capacity().wrapping_mul(NODE_OVERHEAD)
                        + a.iter().map(json_size).sum::<usize>()
                }
                serde_json::Value::Object(o) => o
                    .iter()
                    .map(|(k, val)| k.capacity() + NODE_OVERHEAD + json_size(val))
                    .sum(),
            }
        }
        match self {
            CacheValue::Json(v) => json_size(v),
            CacheValue::Bytes(b) => b.capacity() + NODE_OVERHEAD,
        }
    }
}

/// Abstract cache backend. Both `MokaBackend` and `RedisBackend` implement
/// this; the rest of the app uses dynamic dispatch (`Arc<dyn CacheBackend>`).
///
/// Generic-free trait so it stays dyn-compatible. The convenience
/// wrappers `get_serializable` / `set_serializable` live as free functions
/// in [`cache::backend`] instead of as trait methods.
#[async_trait]
pub trait CacheBackend: Send + Sync {
    async fn get(&self, key: &str) -> anyhow::Result<Option<CacheValue>>;
    async fn set(&self, key: &str, value: CacheValue, ttl: Option<Duration>) -> anyhow::Result<()>;
    async fn delete(&self, key: &str) -> anyhow::Result<()>;
    async fn get_many(&self, keys: &[String]) -> anyhow::Result<HashMap<String, CacheValue>>;
    async fn set_many(
        &self,
        items: Vec<(String, CacheValue)>,
        ttl: Option<Duration>,
    ) -> anyhow::Result<()>;
    async fn delete_many(&self, keys: &[String]) -> anyhow::Result<()>;
}

/// Free function: store a `Serialize` value under `key`.
pub async fn set_serializable<T: Serialize + Send + Sync>(
    backend: &dyn CacheBackend,
    key: &str,
    value: &T,
    ttl: Option<Duration>,
) -> anyhow::Result<()> {
    let v = CacheValue::from_serializable(value)?;
    backend.set(key, v, ttl).await
}

/// Free function: load and deserialize a value from `key`.
pub async fn get_serializable<T: DeserializeOwned>(
    backend: &dyn CacheBackend,
    key: &str,
) -> anyhow::Result<Option<T>> {
    match backend.get(key).await? {
        None => Ok(None),
        Some(v) => Ok(Some(v.into_serializable()?)),
    }
}

/// Stampede-protected get-or-fetch. If the key is in the cache, returns the
/// cached value. If not, calls `fetch` to load it from the DB, stores the
/// result, and returns it. Concurrent callers for the SAME key will all
/// wait for the first fetch to complete and share its result — only one DB
/// query is issued per cache window.
///
/// This is a simpler alternative to `moka::try_get_with` that works across
/// any `CacheBackend` (including Redis). It uses a process-local
/// in-flight registry (a `DashMap` of `watch` channels) to deduplicate
/// concurrent fetches; the first caller becomes the leader, runs the
/// fetch once and broadcasts the serialized result to every follower
/// waiting on the same slot. If the cache backend is Redis (shared across
/// processes), cross-process stampede protection is NOT provided — only
/// per-process dedup.
///
/// Failure semantics match the un-deduplicated path: a leader error is
/// broadcast to every follower (they all see the same error instead of
/// each issuing their own query), the slot is vacated so the NEXT caller
/// retries the fetch, and nothing is written to the cache. A dropped or
/// cancelled leader (channel closed without a value) makes followers fall
/// back to fetching for themselves — a stampede can never deadlock, only
/// briefly lose dedup on that one key.
pub async fn get_or_fetch<T, F, Fut>(
    backend: &dyn CacheBackend,
    key: &str,
    ttl: Duration,
    fetch: F,
) -> anyhow::Result<T>
where
    T: Serialize + DeserializeOwned + Clone + Send + Sync + 'static,
    F: FnOnce() -> Fut + Send,
    Fut: std::future::Future<Output = anyhow::Result<T>> + Send,
{
    // Fast path: cache hit.
    if let Some(v) = get_serializable::<T>(backend, key).await? {
        return Ok(v);
    }

    // Cache miss — reserve a flight slot. The first caller for this key
    // becomes the LEADER (it runs the fetch); concurrent callers become
    // FOLLOWERS (they wait on the watch channel). No guard is held across
    // an await: the map entry is dropped before any async work.
    let registry = in_flight();
    let slot = {
        use dashmap::mapref::entry::Entry;
        match registry.entry(key.to_string()) {
            Entry::Occupied(occ) => Flight::Follower(occ.get().subscribe()),
            Entry::Vacant(vac) => {
                let (tx, _rx) = watch::channel(None);
                vac.insert(Arc::new(tx));
                Flight::Leader
            }
        }
    };

    match slot {
        Flight::Leader => {
            // Run the fetch exactly once, then publish the outcome to
            // every follower that piled up while it ran.
            let result = fetch().await;
            let broadcast = match &result {
                Ok(v) => match serde_json::to_value(v) {
                    Ok(json) => Some(Ok(json)),
                    Err(e) => Some(Err(anyhow::Error::new(e))),
                },
                // The error is stringified for the broadcast (`anyhow::Error`
                // is not `Clone`) — the leader itself returns the ORIGINAL
                // error with its full context.
                Err(e) => Some(Err(anyhow::anyhow!("{e}"))),
            };
            // Publish BEFORE removing the slot: `send` wakes every
            // subscriber; the entry removal then lets the NEXT wave of
            // callers (post-TTL) start a fresh flight instead of latching
            // onto a completed one. `send` fails only when every receiver
            // is gone — no followers waited, nothing to wake.
            if let Some((_, tx)) = registry.remove(key) {
                let _ = tx.send(broadcast);
            }
            match result {
                Ok(value) => {
                    // Best-effort cache write. If this fails (e.g. Redis
                    // blip), the next request will re-fetch — not a
                    // correctness issue.
                    if let Err(e) = set_serializable(backend, key, &value, Some(ttl)).await {
                        tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
                    }
                    Ok(value)
                }
                Err(e) => Err(e),
            }
        }
        Flight::Follower(mut rx) => {
            // Wait for the leader's broadcast. `changed()` errs when the
            // sender was dropped without publishing (leader cancelled /
            // panicked) — fall back to fetching for ourselves rather
            // than failing the request.
            //
            // The borrow is scoped BEFORE the match arms so the watch
            // guard is never held across an await; the leader's error is
            // stringified in the same step (`anyhow::Error` is not
            // `Clone`, the broadcast payload carries it by value).
            enum Outcome<T> {
                Value(T),
                Failed(String),
                Pending,
            }
            let outcome = match rx.changed().await {
                Ok(()) => {
                    let guard = rx.borrow_and_update();
                    match &*guard {
                        Some(Ok(json)) => match serde_json::from_value::<T>(json.clone()) {
                            Ok(v) => Outcome::Value(v),
                            Err(e) => Outcome::Failed(e.to_string()),
                        },
                        Some(Err(e)) => Outcome::Failed(e.to_string()),
                        None => Outcome::Pending,
                    }
                }
                Err(_) => Outcome::Pending,
            };
            match outcome {
                Outcome::Value(v) => Ok(v),
                Outcome::Failed(msg) => Err(anyhow::anyhow!(msg)),
                // Leader vanished (or published nothing) — fetch for
                // ourselves: dedup degrades, correctness does not.
                Outcome::Pending => fetch_and_cache(backend, key, ttl, fetch).await,
            }
        }
    }
}

/// Which role this caller plays for a cache-key flight.
enum Flight {
    /// First caller: runs the fetch and broadcasts the result.
    Leader,
    /// Concurrent caller: waits on the leader's broadcast channel.
    Follower(watch::Receiver<FlightResult>),
}

/// What a flight leader publishes: the serialized value on success, the
/// failure on error. The channel's initial value is `None` ("leader still
/// running") — a follower that ever observes `None` after `changed()` fell
/// through to the un-deduplicated fallback.
type FlightResult = Option<anyhow::Result<serde_json::Value>>;

/// Shared broadcast handle for one in-flight key.
type FlightTx = Arc<watch::Sender<FlightResult>>;

/// The un-deduplicated fallback: fetch, cache, return. Used by followers
/// whose leader vanished without publishing.
async fn fetch_and_cache<T, F, Fut>(
    backend: &dyn CacheBackend,
    key: &str,
    ttl: Duration,
    fetch: F,
) -> anyhow::Result<T>
where
    T: Serialize + DeserializeOwned + Clone + Send + Sync + 'static,
    F: FnOnce() -> Fut + Send,
    Fut: std::future::Future<Output = anyhow::Result<T>> + Send,
{
    let value = fetch().await?;
    if let Err(e) = set_serializable(backend, key, &value, Some(ttl)).await {
        tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
    }
    Ok(value)
}

/// Process-wide in-flight fetch registry (the singleflight map).
///
/// Entries exist ONLY while a fetch is running — the leader removes its
/// slot on completion (success OR failure), so the registry cannot grow
/// with key cardinality.
fn in_flight() -> &'static DashMap<String, FlightTx> {
    static IN_FLIGHT: OnceLock<DashMap<String, FlightTx>> = OnceLock::new();
    IN_FLIGHT.get_or_init(DashMap::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::MokaBackend;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    /// A fresh Moka backend with a long TTL, so every test wave runs
    /// against an empty cache (each test constructs its own). `Arc` so
    /// spawned tasks can own a reference (tokio requires 'static).
    fn fresh_backend() -> Arc<MokaBackend> {
        Arc::new(MokaBackend::new(64 * 1024 * 1024, Duration::from_secs(300)))
    }

    /// A `serde` round-trippable probe value (a bare string would test
    /// less of the type-erased broadcast path).
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct Probe {
        payload: String,
        n: u64,
    }

    /// THE singleflight contract: N concurrent misses for the same key
    /// issue exactly ONE fetch, and every caller receives the same value.
    ///
    /// The fetch sleeps so the followers reliably pile onto the flight
    /// while the leader is still running (without the sleep the leader
    /// may complete before the followers even arrive, weakening the
    /// test to a no-op).
    #[tokio::test]
    async fn concurrent_misses_share_one_fetch() {
        let backend = fresh_backend();
        let fetches = Arc::new(AtomicUsize::new(0));

        let mut joins = Vec::new();
        for i in 0..16 {
            let backend = backend.clone();
            let fetches = fetches.clone();
            joins.push(tokio::spawn(async move {
                // Stagger arrivals slightly so a clear leader emerges.
                tokio::time::sleep(std::time::Duration::from_millis(i)).await;
                get_or_fetch(
                    backend.as_ref(),
                    "probe:single",
                    Duration::from_secs(300),
                    || {
                        let fetches = fetches.clone();
                        async move {
                            fetches.fetch_add(1, Ordering::SeqCst);
                            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
                            Ok(Probe {
                                payload: "shared".into(),
                                n: 42,
                            })
                        }
                    },
                )
                .await
            }));
        }
        for j in joins {
            let v = j.await.expect("join").expect("value");
            assert_eq!(
                v,
                Probe {
                    payload: "shared".into(),
                    n: 42
                }
            );
        }
        assert_eq!(
            fetches.load(Ordering::SeqCst),
            1,
            "16 concurrent misses must collapse into exactly one fetch"
        );
        // The slot must be vacated after completion — no lingering entry.
        assert!(
            in_flight().get("probe:single").is_none(),
            "flight registry entry must be removed after the leader finishes"
        );
    }

    /// A leader failure is broadcast: every concurrent caller sees the
    /// error (none of them issues its own query), and the NEXT caller
    /// after the wave retries the fetch.
    #[tokio::test]
    async fn leader_failure_broadcasts_and_slot_vacates() {
        let backend = fresh_backend();
        let fetches = Arc::new(AtomicUsize::new(0));

        let mut joins = Vec::new();
        for i in 0..8 {
            let backend = backend.clone();
            let fetches = fetches.clone();
            joins.push(tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(i)).await;
                get_or_fetch::<Probe, _, _>(
                    backend.as_ref(),
                    "probe:err",
                    Duration::from_secs(300),
                    || {
                        let fetches = fetches.clone();
                        async move {
                            fetches.fetch_add(1, Ordering::SeqCst);
                            tokio::time::sleep(std::time::Duration::from_millis(80)).await;
                            anyhow::bail!("db down")
                        }
                    },
                )
                .await
            }));
        }
        for j in joins {
            let err = j.await.expect("join").expect_err("must fail");
            assert!(err.to_string().contains("db down"), "err: {err}");
        }
        assert_eq!(
            fetches.load(Ordering::SeqCst),
            1,
            "8 concurrent failing misses must collapse into exactly one fetch"
        );
        assert!(
            in_flight().get("probe:err").is_none(),
            "slot vacated after failure"
        );

        // The next caller after the failed wave retries (slot was vacated).
        let fetches2 = fetches.clone();
        let v = get_or_fetch(
            backend.as_ref(),
            "probe:err",
            Duration::from_secs(300),
            || {
                let fetches2 = fetches2.clone();
                async move {
                    fetches2.fetch_add(1, Ordering::SeqCst);
                    Ok(Probe {
                        payload: "recovered".into(),
                        n: 7,
                    })
                }
            },
        )
        .await
        .expect("retry succeeds");
        assert_eq!(v.payload, "recovered");
        assert_eq!(fetches.load(Ordering::SeqCst), 2);
    }

    /// Different keys do not share flights: a miss on key B does not wait
    /// on key A's in-flight fetch.
    #[tokio::test]
    async fn different_keys_fetch_independently() {
        let backend = fresh_backend();
        let fetches = Arc::new(AtomicUsize::new(0));

        let a = {
            let backend = backend.clone();
            let fetches = fetches.clone();
            tokio::spawn(async move {
                get_or_fetch(
                    backend.as_ref(),
                    "probe:a",
                    Duration::from_secs(300),
                    || {
                        let fetches = fetches.clone();
                        async move {
                            fetches.fetch_add(1, Ordering::SeqCst);
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                            Ok(Probe {
                                payload: "a".into(),
                                n: 1,
                            })
                        }
                    },
                )
                .await
            })
        };
        // Give A's flight time to register before B starts.
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let b = {
            let backend = backend.clone();
            let fetches = fetches.clone();
            tokio::spawn(async move {
                get_or_fetch(
                    backend.as_ref(),
                    "probe:b",
                    Duration::from_secs(300),
                    || {
                        let fetches = fetches.clone();
                        async move {
                            fetches.fetch_add(1, Ordering::SeqCst);
                            Ok(Probe {
                                payload: "b".into(),
                                n: 2,
                            })
                        }
                    },
                )
                .await
            })
        };
        assert_eq!(a.await.expect("join a").expect("a").payload, "a");
        assert_eq!(b.await.expect("join b").expect("b").payload, "b");
        assert_eq!(fetches.load(Ordering::SeqCst), 2);
    }
}

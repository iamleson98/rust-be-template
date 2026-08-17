use async_trait::async_trait;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

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
/// `DashMap<String, Shared<Pin<Box<dyn Future + Send>>>>` to deduplicate
/// in-flight fetches. If the cache backend is Redis (shared across
/// processes), cross-process stampede protection is NOT provided — only
/// per-process dedup.
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

    // Cache miss — fetch from DB.
    let value = fetch().await?;

    // Best-effort cache write. If this fails (e.g. Redis blip), the next
    // request will re-fetch — not a correctness issue.
    if let Err(e) = set_serializable(backend, key, &value, Some(ttl)).await {
        tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
    }

    Ok(value)
}

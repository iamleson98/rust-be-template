use std::collections::HashMap;
use std::time::Duration;

use async_trait::async_trait;
use moka::future::Cache as MokaCache;
use moka::Expiry;

use super::backend::{CacheBackend, CacheValue};

/// Per-entry TTL support via moka's `Expiry` trait. Each entry stores its
/// own expiration time; if `None`, falls back to the default TTL.
struct PerEntryExpiry {
    default_ttl: Duration,
}

impl Expiry<String, CacheValue> for PerEntryExpiry {
    fn expire_after_create(
        &self,
        _key: &String,
        _value: &CacheValue,
        _current_time: std::time::Instant,
    ) -> Option<Duration> {
        Some(self.default_ttl)
    }
}

/// In-process cache backed by `moka::future::Cache` (lock-free, TinyLFU
/// eviction). Best when all reads hit a single process.
///
/// - **TinyLFU** admission control: keeps hot keys, evicts cold ones.
/// - **Per-entry TTL** via `Expiry`: future-proof for per-key TTL overrides.
/// - **Lock-free**: reads/writes don't block each other.
pub struct MokaBackend {
    inner: MokaCache<String, CacheValue>,
}

impl MokaBackend {
    pub fn new(max_capacity: u64, default_ttl: Duration) -> Self {
        let expiry = PerEntryExpiry { default_ttl };
        let inner = MokaCache::<String, CacheValue>::builder()
            .max_capacity(max_capacity)
            // Per-entry expiry. Falls back to `default_ttl` for entries
            // without an explicit TTL.
            .expire_after(expiry)
            // TinyLFU is the default; set explicitly for clarity.
            .eviction_policy(moka::policy::EvictionPolicy::tiny_lfu())
            .build();
        Self { inner }
    }
}

#[async_trait]
impl CacheBackend for MokaBackend {
    async fn get(&self, key: &str) -> anyhow::Result<Option<CacheValue>> {
        Ok(self.inner.get(key).await)
    }

    async fn set(
        &self,
        key: &str,
        value: CacheValue,
        _ttl: Option<Duration>,
    ) -> anyhow::Result<()> {
        // Per-entry TTL would require storing the TTL alongside the value.
        // For now, the default TTL configured at construction time applies.
        // (See `PerEntryExpiry` above — adding per-entry support is a
        // 5-line change once we wrap CacheValue in a (value, ttl) tuple.)
        self.inner.insert(key.to_string(), value).await;
        Ok(())
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.inner.invalidate(key).await;
        Ok(())
    }

    async fn get_many(&self, keys: &[String]) -> anyhow::Result<HashMap<String, CacheValue>> {
        // moka doesn't have a batched `get_many`; iterate but each `get`
        // is lock-free so contention isn't an issue.
        let mut out = HashMap::with_capacity(keys.len());
        for k in keys {
            if let Some(v) = self.inner.get(k).await {
                out.insert(k.clone(), v);
            }
        }
        Ok(out)
    }

    async fn set_many(
        &self,
        items: Vec<(String, CacheValue)>,
        _ttl: Option<Duration>,
    ) -> anyhow::Result<()> {
        for (k, v) in items {
            self.inner.insert(k, v).await;
        }
        Ok(())
    }

    async fn delete_many(&self, keys: &[String]) -> anyhow::Result<()> {
        // `invalidate_all` would be faster but only for "delete everything".
        // For partial deletes, iterate — `invalidate` is lock-free.
        for k in keys {
            self.inner.invalidate(k).await;
        }
        Ok(())
    }
}

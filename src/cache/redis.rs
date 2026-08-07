use std::collections::HashMap;
use std::time::Duration;

use async_trait::async_trait;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;

use super::backend::{CacheBackend, CacheValue};

/// Shared cache backed by Redis (or any Redis-compatible server such as
/// Dragonfly or KeyDB). Values are stored as JSON strings under `key` with
/// the configured default TTL.
pub struct RedisBackend {
    conn: ConnectionManager,
    default_ttl: Duration,
}

impl RedisBackend {
    pub async fn connect(url: &str, default_ttl: Duration) -> anyhow::Result<Self> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self {
            conn,
            default_ttl,
        })
    }
}

#[async_trait]
impl CacheBackend for RedisBackend {
    async fn get(&self, key: &str) -> anyhow::Result<Option<CacheValue>> {
        let mut conn = self.conn.clone();
        let bytes: Option<Vec<u8>> = conn.get(key).await?;
        match bytes {
            None => Ok(None),
            Some(b) => Ok(Some(CacheValue::Bytes(b))),
        }
    }

    async fn set(&self, key: &str, value: CacheValue, ttl: Option<Duration>) -> anyhow::Result<()> {
        let mut conn = self.conn.clone();
        let payload: Vec<u8> = match value {
            CacheValue::Json(v) => serde_json::to_vec(&v)?,
            CacheValue::Bytes(b) => b,
        };
        let ttl_secs = ttl.unwrap_or(self.default_ttl).as_secs();
        let _: () = conn.set_ex(key, payload, ttl_secs).await?;
        Ok(())
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        let mut conn = self.conn.clone();
        let _: i64 = conn.del(key).await?;
        Ok(())
    }

    async fn get_many(&self, keys: &[String]) -> anyhow::Result<HashMap<String, CacheValue>> {
        if keys.is_empty() {
            return Ok(HashMap::new());
        }
        let mut conn = self.conn.clone();
        let values: Vec<Option<Vec<u8>>> = conn.mget(keys).await?;
        let mut out = HashMap::with_capacity(keys.len());
        for (k, v) in keys.iter().zip(values) {
            if let Some(b) = v {
                out.insert(k.clone(), CacheValue::Bytes(b));
            }
        }
        Ok(out)
    }

    async fn set_many(
        &self,
        items: Vec<(String, CacheValue)>,
        ttl: Option<Duration>,
    ) -> anyhow::Result<()> {
        if items.is_empty() {
            return Ok(());
        }
        let ttl_secs = ttl.unwrap_or(self.default_ttl).as_secs();
        let mut pipe = redis::pipe();
        pipe.atomic();
        for (k, v) in items {
            let payload: Vec<u8> = match v {
                CacheValue::Json(v) => serde_json::to_vec(&v)?,
                CacheValue::Bytes(b) => b,
            };
            pipe.set_ex(k, payload, ttl_secs).ignore();
        }
        let mut conn = self.conn.clone();
        let _: () = pipe.query_async(&mut conn).await?;
        Ok(())
    }

    async fn delete_many(&self, keys: &[String]) -> anyhow::Result<()> {
        if keys.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.clone();
        let _: i64 = conn.del(keys).await?;
        Ok(())
    }
}

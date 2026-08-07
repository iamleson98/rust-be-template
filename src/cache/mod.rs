//! Pluggable cache abstraction.
//!
//! Used by both the `CacheStore` layer (for caching entities) and the RBAC
//! checker (for caching permission lookups). Two backends:
//! - `MokaBackend`: in-process LRU, zero infra, ~10ns hits
//! - `RedisBackend`: shared across instances, ~0.3ms/hit
//!
//! Both implement [`CacheBackend`]; the rest of the app talks to the trait.

pub use self::backend::{get_serializable, set_serializable, CacheBackend, CacheValue};
pub use self::moka::MokaBackend;
pub use self::redis::RedisBackend;

mod backend;
mod moka;
mod redis;

use std::sync::Arc;

use crate::config::{CacheBackend as CacheBackendCfg, CacheConfig};

/// Construct the configured backend as a shared trait object.
pub async fn build_shared(cfg: &CacheConfig) -> anyhow::Result<Arc<dyn CacheBackend>> {
    match cfg.backend {
        CacheBackendCfg::Moka => Ok(Arc::new(MokaBackend::new(cfg.max_capacity, cfg.ttl()))),
        CacheBackendCfg::Redis => Ok(Arc::new(RedisBackend::connect(&cfg.redis_url, cfg.ttl()).await?)),
    }
}

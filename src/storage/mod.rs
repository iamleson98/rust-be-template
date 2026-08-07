//! Pluggable file storage. Trait + 3 backends:
//! - `LocalStorage`: filesystem (default for dev)
//! - `S3Storage`: AWS S3 or any S3-compatible API
//! - `MinioStorage`: just an `S3Storage` preset pointed at a MinIO endpoint
//!
//! All backends implement [`FileStorage`]; the rest of the app uses the
//! trait. Selection is driven by `STORAGE_BACKEND` in `.env`.

pub use self::backend::{FileMeta, FileStorage, PutOptions};
pub use self::local::LocalStorage;
pub use self::s3::{MinioStorage, S3Storage};

mod backend;
mod local;
mod s3;

use crate::config::{StorageBackend as StorageBackendCfg, StorageConfig};

/// Construct the configured backend.
pub async fn build(cfg: &StorageConfig) -> anyhow::Result<Box<dyn FileStorage>> {
    match cfg.backend {
        StorageBackendCfg::Local => Ok(Box::new(LocalStorage::new(cfg.local_root.clone()).await?)),
        StorageBackendCfg::S3 => Ok(Box::new(S3Storage::new(cfg).await?)),
        StorageBackendCfg::Minio => Ok(Box::new(MinioStorage::new(cfg).await?)),
    }
}

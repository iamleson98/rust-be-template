//! Pluggable file storage. Trait + 4 backends:
//! - `LocalStorage`: filesystem (default for dev)
//! - `S3Storage`: AWS S3 or any S3-compatible API
//! - `MinioStorage`: `S3Storage` preset pointed at a MinIO endpoint
//! - `RustFsStorage`: `S3Storage` preset pointed at a RustFS endpoint
//!
//! All backends implement [`FileStorage`]; the rest of the app uses the
//! trait. Selection is driven by `STORAGE_BACKEND` in `.env`.
//!
//! The S3 wire protocol is the portability layer: RustFS, MinIO,
//! SeaweedFS, Garage and AWS S3 all speak it, so swapping the object
//! store is an endpoint + credentials change — never an app change.

pub use self::backend::{FileMeta, FileStorage, PutOptions};
pub use self::local::LocalStorage;
pub use self::s3::{MinioStorage, RustFsStorage, S3Storage};

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
        StorageBackendCfg::Rustfs => Ok(Box::new(RustFsStorage::new(cfg).await?)),
    }
}

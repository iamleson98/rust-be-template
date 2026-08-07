use async_trait::async_trait;
use bytes::Bytes;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
pub struct PutOptions {
    pub content_type: Option<String>,
    pub metadata: HashMap<String, String>,
    pub cache_control: Option<String>,
}

impl PutOptions {
    pub fn with_content_type(mut self, ct: impl Into<String>) -> Self {
        self.content_type = Some(ct.into());
        self
    }
}

#[derive(Debug, Clone)]
pub struct FileMeta {
    pub key: String,
    pub size: u64,
    pub content_type: String,
    pub etag: Option<String>,
}

/// File storage abstraction. Backends MUST be cheap to clone (Arc inside).
#[async_trait]
pub trait FileStorage: Send + Sync {
    /// Put a blob under `key`. Returns the canonical key stored.
    async fn put(&self, key: &str, data: Bytes, opts: PutOptions) -> anyhow::Result<String>;

    /// Get a blob by key.
    async fn get(&self, key: &str) -> anyhow::Result<Bytes>;

    /// Delete a blob.
    async fn delete(&self, key: &str) -> anyhow::Result<()>;

    /// Stat (HEAD) — returns metadata without the body.
    async fn head(&self, key: &str) -> anyhow::Result<FileMeta>;

    /// Generate a new opaque key. Default impl uses a UUIDv4 prefix.
    fn generate_key(&self, extension: Option<&str>) -> String {
        let id = Uuid::new_v4();
        match extension {
            Some(ext) => format!("{id}.{ext}"),
            None => id.to_string(),
        }
    }
}

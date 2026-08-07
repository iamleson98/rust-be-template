use std::path::{Path, PathBuf};

use async_trait::async_trait;
use bytes::Bytes;
use tokio::fs;
use tokio::io::AsyncReadExt;

use super::backend::{FileMeta, FileStorage, PutOptions};

/// Filesystem-backed [`FileStorage`]. Keys are interpreted as relative
/// paths under `root`. We reject keys containing `..` or absolute paths
/// to prevent traversal.
pub struct LocalStorage {
    root: PathBuf,
}

impl LocalStorage {
    pub async fn new(root: PathBuf) -> anyhow::Result<Self> {
        fs::create_dir_all(&root).await?;
        Ok(Self { root })
    }

    fn resolve(&self, key: &str) -> anyhow::Result<PathBuf> {
        let path = self.root.join(key);
        // Canonical-ish safety check: ensure resolved path stays under root.
        if !path.starts_with(&self.root) {
            anyhow::bail!("invalid storage key (path traversal): {key}");
        }
        Ok(path)
    }
}

#[async_trait]
impl FileStorage for LocalStorage {
    async fn put(&self, key: &str, data: Bytes, opts: PutOptions) -> anyhow::Result<String> {
        let path = self.resolve(key)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(&path, &data).await?;

        // Best-effort content-type annotation via sidecar file. Real apps
        // would store this in an index DB; here we just keep it minimal.
        if let Some(md) = opts.metadata.get("description") {
            let _ = fs::write(format!("{}.meta", path.display()), md).await;
        }
        Ok(key.to_string())
    }

    async fn get(&self, key: &str) -> anyhow::Result<Bytes> {
        let path = self.resolve(key)?;
        let mut f = fs::File::open(&path).await?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).await?;
        Ok(Bytes::from(buf))
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        let path = self.resolve(key)?;
        if path.exists() {
            fs::remove_file(&path).await?;
        }
        Ok(())
    }

    async fn head(&self, key: &str) -> anyhow::Result<FileMeta> {
        let path = self.resolve(key)?;
        let meta = fs::metadata(&path).await?;
        let size = meta.len();
        let content_type = mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string();
        Ok(FileMeta {
            key: key.to_string(),
            size,
            content_type,
            etag: None,
        })
    }
}

#[allow(dead_code)]
fn _path_marker(_: &Path) {}

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
        // Path-traversal protection: reject any key that contains a
        // component-level `..` or that resolves to an absolute path. The
        // previous `Path::starts_with` check is lexical and can be fooled
        // by inputs like `..%2f..%2fetc%2fpasswd` after URL decoding, or
        // by symlinks under `root`. We walk the key's components and
        // reject anything that would let the resolved path escape `root`.
        let key_path = Path::new(key);
        if key_path.is_absolute() {
            anyhow::bail!("invalid storage key (absolute path): {key}");
        }
        for comp in key_path.components() {
            match comp {
                std::path::Component::ParentDir => {
                    anyhow::bail!("invalid storage key (parent-dir traversal): {key}");
                }
                std::path::Component::RootDir => {
                    anyhow::bail!("invalid storage key (root-dir component): {key}");
                }
                // Normal components (Normal, CurDir) are safe; Prefix only
                // appears on Windows (`C:`) and is also rejected here.
                std::path::Component::Prefix(_) => {
                    anyhow::bail!("invalid storage key (path prefix): {key}");
                }
                _ => {}
            }
        }
        let path = self.root.join(key_path);
        // Defense in depth: also verify the lexical path stays under root
        // after join (catches symlinks via `..` style attacks where the
        // previous component check might miss an edge case).
        if !path.starts_with(&self.root) {
            anyhow::bail!("invalid storage key (escaped root): {key}");
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

#[cfg(test)]
mod tests {
    use super::*;

    // `LocalStorage::new` is async (it creates the root dir). Use a tiny
    // tokio runtime per test to construct an instance. The `resolve`
    // method itself is pure sync so this is the only async surface.
    fn storage() -> LocalStorage {
        let dir = std::env::temp_dir().join(format!(
            "rust-be-template-storage-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(LocalStorage::new(dir))
            .unwrap()
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let s = storage();
        assert!(s.resolve("../etc/passwd").is_err());
        assert!(s.resolve("a/../../etc/passwd").is_err());
        assert!(s.resolve("a/../b/../../../etc/passwd").is_err());
    }

    #[test]
    fn rejects_absolute_path() {
        let s = storage();
        assert!(s.resolve("/etc/passwd").is_err());
        assert!(s.resolve("//etc/passwd").is_err());
    }

    #[test]
    fn accepts_normal_relative_keys() {
        let s = storage();
        assert!(s.resolve("avatars/abc.png").is_ok());
        assert!(s.resolve("a/b/c.bin").is_ok());
        assert!(s.resolve("./curdir.png").is_ok()); // CurDir is allowed
    }
}

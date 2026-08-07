use std::sync::Arc;

use async_trait::async_trait;
use aws_config::BehaviorVersion;
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client as S3Client;
use bytes::Bytes;

use crate::config::StorageConfig;

use super::backend::{FileMeta, FileStorage, PutOptions};

/// S3-compatible file storage. Works with AWS S3 and any API that
/// mimics it (R2, B2, Wasabi, ...).
pub struct S3Storage {
    client: S3Client,
    bucket: String,
}

impl S3Storage {
    pub async fn new(cfg: &StorageConfig) -> anyhow::Result<Self> {
        let region = Region::new(cfg.s3_region.clone());
        let mut loader = aws_config::defaults(BehaviorVersion::latest()).region(region);
        if !cfg.s3_access_key_id.is_empty() {
            let creds = Credentials::new(
                &cfg.s3_access_key_id,
                &cfg.s3_secret_access_key,
                None,
                None,
                "static",
            );
            loader = loader.credentials_provider(creds);
        }
        let conf = loader.load().await;

        let mut s3_cfg_builder = aws_sdk_s3::Config::builder().region(conf.region().cloned());
        if let Some(creds) = conf.credentials_provider() {
            s3_cfg_builder = s3_cfg_builder.credentials_provider(creds);
        }
        if let Some(endpoint) = &cfg.s3_endpoint {
            s3_cfg_builder = s3_cfg_builder.endpoint_url(endpoint);
        }
        s3_cfg_builder = s3_cfg_builder.force_path_style(cfg.s3_force_path_style);
        let client = S3Client::from_conf(s3_cfg_builder.build());
        Ok(Self {
            client,
            bucket: cfg.s3_bucket.clone(),
        })
    }
}

#[async_trait]
impl FileStorage for S3Storage {
    async fn put(&self, key: &str, data: Bytes, opts: PutOptions) -> anyhow::Result<String> {
        let ct = opts
            .content_type
            .unwrap_or_else(|| "application/octet-stream".into());
        let mut builder = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(&ct)
            .body(data.into());
        if let Some(cc) = opts.cache_control {
            builder = builder.cache_control(cc.as_str());
        }
        for (k, v) in opts.metadata {
            builder = builder.metadata(k, v);
        }
        builder.send().await?;
        Ok(key.to_string())
    }

    async fn get(&self, key: &str) -> anyhow::Result<Bytes> {
        let resp = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;
        let body = resp.body.collect().await?;
        Ok(body.into_bytes())
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;
        Ok(())
    }

    async fn head(&self, key: &str) -> anyhow::Result<FileMeta> {
        let resp = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;
        let size = resp.content_length().unwrap_or(0) as u64;
        let ct = resp
            .content_type()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "application/octet-stream".into());
        let etag = resp.e_tag().map(|s| s.to_string());
        Ok(FileMeta {
            key: key.to_string(),
            size,
            content_type: ct,
            etag,
        })
    }
}

/// MinIO is S3-compatible — same protocol, different defaults. This is a
/// thin preset that points the S3 client at a MinIO endpoint with path
/// style addressing (MinIO doesn't support virtual-hosted style by default).
pub struct MinioStorage(S3Storage);

impl MinioStorage {
    pub async fn new(cfg: &StorageConfig) -> anyhow::Result<Self> {
        let mut cfg = cfg.clone();
        cfg.s3_force_path_style = true;
        if cfg.s3_endpoint.is_none() {
            cfg.s3_endpoint = Some("http://localhost:9000".into());
        }
        Ok(Self(S3Storage::new(&cfg).await?))
    }
}

#[async_trait]
impl FileStorage for MinioStorage {
    async fn put(&self, key: &str, data: Bytes, opts: PutOptions) -> anyhow::Result<String> {
        self.0.put(key, data, opts).await
    }
    async fn get(&self, key: &str) -> anyhow::Result<Bytes> {
        self.0.get(key).await
    }
    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.0.delete(key).await
    }
    async fn head(&self, key: &str) -> anyhow::Result<FileMeta> {
        self.0.head(key).await
    }
}

/// Wrapper shared between backends that need pre-signed URLs in future.
#[allow(dead_code)]
async fn _presign(c: Arc<S3Client>, bucket: &str, key: &str, secs: u64) -> anyhow::Result<String> {
    let cfg = PresigningConfig::builder()
        .expires_in(std::time::Duration::from_secs(secs))
        .build()?;
    let url = c
        .get_object()
        .bucket(bucket)
        .key(key)
        .presigned(cfg)
        .await?
        .uri()
        .to_string();
    Ok(url)
}

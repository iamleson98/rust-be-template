//! Typed application configuration loaded from `.env` (or actual environment).
//!
//! Resolved once at startup and stored in [`AppState`]. No environment
//! reads happen elsewhere — every module takes a typed [`Config`] borrow.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use figment::providers::{Env, Format, Serialized, Toml};
use figment::Figment;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub jwt: JwtConfig,
    pub cookie: CookieConfig,
    pub csrf: CsrfConfig,
    pub cache: CacheConfig,
    pub storage: StorageConfig,
    pub worker: WorkerConfig,
    pub rate_limit: RateLimitConfig,
    pub static_files: StaticFilesConfig,
    pub cors: CorsConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            database: DatabaseConfig::default(),
            jwt: JwtConfig::default(),
            cookie: CookieConfig::default(),
            csrf: CsrfConfig::default(),
            cache: CacheConfig::default(),
            storage: StorageConfig::default(),
            worker: WorkerConfig::default(),
            rate_limit: RateLimitConfig::default(),
            static_files: StaticFilesConfig::default(),
            cors: CorsConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub rust_log: String,
    /// Hard per-request timeout in seconds. A handler that exceeds this
    /// returns 408. Protects against slow handlers + slowloris.
    pub request_timeout_secs: u64,
    /// Max bytes for request bodies (POST/PATCH/PUT). Protects against
    /// memory DoS. 2 MB is enough for typical JSON; raise for uploads.
    pub max_request_body_bytes: usize,
    /// TCP keepalive interval for accepted connections. None = use OS default.
    pub tcp_keepalive_secs: Option<u64>,
    /// TCP_NODELAY — disable Nagle's algorithm for lower latency.
    pub tcp_nodelay: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".into(),
            port: 8080,
            rust_log: "info,backend=debug,tower_http=info".into(),
            request_timeout_secs: 30,
            max_request_body_bytes: 2 * 1024 * 1024, // 2 MB
            tcp_keepalive_secs: Some(60),
            tcp_nodelay: true,
        }
    }
}

impl ServerConfig {
    pub fn addr(&self) -> SocketAddr {
        format!("{}:{}", self.host, self.port)
            .parse()
            .expect("invalid host:port")
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub connect_timeout_secs: u64,
    pub idle_timeout_secs: u64,
    /// Maximum lifetime of a connection before it's recycled. Prevents
    /// long-lived connections from being killed by DB-side idle limits.
    pub max_lifetime_secs: u64,
    /// sqlx statement cache size per connection. Default 100 (sqlx default).
    /// Set to 0 to disable. Larger = fewer recompiles but more memory.
    pub statement_cache_capacity: usize,
    pub enable_sqlx_logs: bool,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: "sqlite://./app.db?mode=rwc".into(),
            max_connections: 20,
            min_connections: 5,
            connect_timeout_secs: 10,
            idle_timeout_secs: 600,
            max_lifetime_secs: 1800,           // 30 minutes
            statement_cache_capacity: 100,
            enable_sqlx_logs: false,
        }
    }
}

impl DatabaseConfig {
    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(self.connect_timeout_secs)
    }
    pub fn idle_timeout(&self) -> Duration {
        Duration::from_secs(self.idle_timeout_secs)
    }
    pub fn max_lifetime(&self) -> Duration {
        Duration::from_secs(self.max_lifetime_secs)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct JwtConfig {
    pub secret: String,
    pub access_ttl_secs: u64,
    pub refresh_ttl_secs: u64,
    pub issuer: String,
}

impl Default for JwtConfig {
    fn default() -> Self {
        Self {
            secret: "change-me-in-production-please-use-32-bytes-or-more".into(),
            access_ttl_secs: 900,
            refresh_ttl_secs: 7 * 24 * 3600,
            issuer: "backend".into(),
        }
    }
}

impl JwtConfig {
    pub fn access_ttl(&self) -> Duration {
        Duration::from_secs(self.access_ttl_secs)
    }
    pub fn refresh_ttl(&self) -> Duration {
        Duration::from_secs(self.refresh_ttl_secs)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct CookieConfig {
    pub domain: String,
    pub secure: bool,
    pub samesite: SameSite,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SameSite {
    Strict,
    Lax,
    None,
}

impl Default for CookieConfig {
    fn default() -> Self {
        Self {
            domain: "localhost".into(),
            secure: false,
            samesite: SameSite::Lax,
        }
    }
}

impl SameSite {
    pub fn as_axum(&self) -> axum_extra::extract::cookie::SameSite {
        use axum_extra::extract::cookie::SameSite as AxumSameSite;
        match self {
            SameSite::Strict => AxumSameSite::Strict,
            SameSite::Lax => AxumSameSite::Lax,
            SameSite::None => AxumSameSite::None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct CsrfConfig {
    pub token_ttl_secs: u64,
}

impl Default for CsrfConfig {
    fn default() -> Self {
        Self {
            token_ttl_secs: 3600,
        }
    }
}

impl CsrfConfig {
    pub fn ttl(&self) -> Duration {
        Duration::from_secs(self.token_ttl_secs)
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CacheBackend {
    Moka,
    Redis,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct CacheConfig {
    pub backend: CacheBackend,
    pub ttl_secs: u64,
    pub max_capacity: u64,
    pub redis_url: String,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            backend: CacheBackend::Moka,
            ttl_secs: 300,
            max_capacity: 100_000,
            redis_url: "redis://localhost:6379/0".into(),
        }
    }
}

impl CacheConfig {
    pub fn ttl(&self) -> Duration {
        Duration::from_secs(self.ttl_secs)
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StorageBackend {
    Local,
    S3,
    Minio,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct StorageConfig {
    pub backend: StorageBackend,
    pub local_root: PathBuf,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_access_key_id: String,
    pub s3_secret_access_key: String,
    pub s3_endpoint: Option<String>,
    pub s3_force_path_style: bool,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            backend: StorageBackend::Local,
            local_root: PathBuf::from("./storage"),
            s3_region: "us-east-1".into(),
            s3_bucket: "app-uploads".into(),
            s3_access_key_id: String::new(),
            s3_secret_access_key: String::new(),
            s3_endpoint: None,
            s3_force_path_style: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkerBackend {
    Redis,
    Db,
    Kafka,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct WorkerConfig {
    pub backend: WorkerBackend,
    pub concurrency: usize,
    pub poll_interval_ms: u64,
    pub kafka_brokers: String,
    pub kafka_group_id: String,
    pub kafka_topic: String,
}

impl Default for WorkerConfig {
    fn default() -> Self {
        Self {
            backend: WorkerBackend::Redis,
            concurrency: 4,
            poll_interval_ms: 1000,
            kafka_brokers: "localhost:9092".into(),
            kafka_group_id: "backend-workers".into(),
            kafka_topic: "jobs".into(),
        }
    }
}

impl WorkerConfig {
    pub fn poll_interval(&self) -> Duration {
        Duration::from_millis(self.poll_interval_ms)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct RateLimitConfig {
    pub rpm: u32,
    pub burst: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            rpm: 60,
            burst: 10,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct StaticFilesConfig {
    pub dir: PathBuf,
    pub cache_max_age: u64,
}

impl Default for StaticFilesConfig {
    fn default() -> Self {
        Self {
            dir: PathBuf::from("./static"),
            cache_max_age: 86_400,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct CorsConfig {
    /// Comma-separated origin list. Empty means "allow same-origin only".
    pub origins: String,
}

impl Default for CorsConfig {
    fn default() -> Self {
        Self {
            origins: "http://localhost:3000,http://localhost:5173".into(),
        }
    }
}

impl CorsConfig {
    pub fn origin_list(&self) -> Vec<String> {
        self.origins
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }
}

impl Config {
    /// Load config in this order, last wins:
    /// 1. built-in defaults
    /// 2. `backend.toml` if present
    /// 3. environment variables (prefixed with no separator, e.g. `DATABASE_URL`)
    /// 4. `.env` file (loaded explicitly by `dotenvy::dotenv()`)
    pub fn load() -> anyhow::Result<Self> {
        // Load .env into process env if present. Ignore errors (file may not exist).
        let _ = dotenvy::dotenv();

        let fig = Figment::from(Serialized::defaults(Config::default()))
            .merge(Toml::file("backend.toml").nested())
            .merge(Env::prefixed("").split("__"));

        let cfg: Config = fig.extract().map_err(|e| anyhow::anyhow!("config error: {e}"))?;
        cfg.validate()?;
        Ok(cfg)
    }

    fn validate(&self) -> anyhow::Result<()> {
        if self.jwt.secret.len() < 32 {
            anyhow::bail!("JWT_SECRET must be at least 32 bytes for HS256");
        }
        if self.worker.concurrency == 0 {
            anyhow::bail!("WORKER_CONCURRENCY must be > 0");
        }
        Ok(())
    }
}

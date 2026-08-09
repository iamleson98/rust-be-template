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
    pub zeroclaw: ZeroClawConfig,
    pub audio_call: AudioCallConfig,
    pub search: SearchConfig,
    pub ws: WsConfig,
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
            zeroclaw: ZeroClawConfig::default(),
            audio_call: AudioCallConfig::default(),
            search: SearchConfig::default(),
            ws: WsConfig::default(),
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
    /// Valhalla routing service URL (optional). If not set, routing endpoints
    /// return 503. Example: `http://localhost:8002`
    pub valhalla_url: Option<String>,
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
            valhalla_url: None,
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

// ────────────────────────────────────────────────────────────────
//  ZeroClaw AI assistant
// ────────────────────────────────────────────────────────────────

/// Configuration for the ZeroClaw AI assistant. When `enabled` is false
/// (or no `api_url`/`api_key` is set), a no-op provider is used and chat
/// messages are never forwarded to an external model.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct ZeroClawConfig {
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    /// Request timeout in milliseconds.
    pub timeout_ms: u64,
    /// Max conversation turns sent to the model as context.
    pub max_history: usize,
    /// If at least this many employees are online, skip the AI reply and
    /// let humans handle the conversation.
    pub fallback_online_employees: usize,
}

impl Default for ZeroClawConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            api_url: String::new(),
            api_key: String::new(),
            model: "zeroclaw-default".into(),
            timeout_ms: 15_000,
            max_history: 12,
            fallback_online_employees: 1,
        }
    }
}

impl ZeroClawConfig {
    /// True when the HTTP provider should be used.
    pub fn is_active(&self) -> bool {
        self.enabled && !self.api_url.is_empty() && !self.api_key.is_empty()
    }
}

// ────────────────────────────────────────────────────────────────
//  Audio call (WebRTC signaling relay)
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct AudioCallConfig {
    pub enabled: bool,
    /// ICE servers (STUN/TURN) delivered to clients on `register`.
    /// Parsed from a JSON env var: `[{"urls":"stun:..."},{"urls":"turn:...","username":"...","credential":"..."}]`.
    pub ice_servers: String,
}

impl Default for AudioCallConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            ice_servers: String::new(),
        }
    }
}

impl AudioCallConfig {
    /// Parse the `ice_servers` JSON into a `serde_json::Value` array.
    /// Returns an empty array on parse failure (clients get no ICE servers
    /// and will fall back to host candidates only).
    pub fn ice_servers_json(&self) -> serde_json::Value {
        if self.ice_servers.is_empty() {
            return serde_json::Value::Array(vec![]);
        }
        serde_json::from_str(&self.ice_servers).unwrap_or_else(|_| serde_json::Value::Array(vec![]))
    }
}

// ────────────────────────────────────────────────────────────────
//  Search / OSM place index
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct SearchConfig {
    /// Directory containing the Tantivy place index. If the directory does
    /// not exist or is empty, place search/reverse-geocode return 503.
    pub index_dir: Option<PathBuf>,
    /// Path to the OSM PBF file used by `import-osm` to build the index.
    pub osm_pbf_path: Option<PathBuf>,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            index_dir: None,
            osm_pbf_path: None,
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  WebSocket chat hub
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct WsConfig {
    /// Hard cap on total live WS connections across the server. 0 = unlimited.
    pub max_connections: usize,
    /// Max concurrent connections per client IP.
    pub max_per_ip: usize,
    /// Bounded outbound channel capacity per session. A slow consumer fills
    /// the queue, then `try_send` drops further messages.
    pub channel_capacity: usize,
    /// Server-initiated Ping interval (seconds). Keeps NAT bindings warm.
    pub heartbeat_sec: u64,
    /// Idle timeout (seconds). A socket with no inbound frame is force-closed.
    pub idle_timeout_sec: u64,
    /// Max WS message size (bytes).
    pub max_message_bytes: usize,
    /// Max WS frame size (bytes).
    pub max_frame_bytes: usize,
}

impl Default for WsConfig {
    fn default() -> Self {
        Self {
            max_connections: 50_000,
            max_per_ip: 10,
            channel_capacity: 256,
            heartbeat_sec: 30,
            idle_timeout_sec: 90,
            max_message_bytes: 64 * 1024,
            max_frame_bytes: 64 * 1024,
        }
    }
}

impl Config {
    /// Load config in this order, last wins:
    /// 1. built-in defaults
    /// 2. `backend.toml` if present
    /// 3. environment variables with `__` nesting (e.g. `DATABASE__URL` → `database.url`)
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

    /// Log the active configuration at startup. Secrets are masked so they
    /// never appear in plain text in log output.
    pub fn log_active(&self) {
        use crate::cli::util::mask_secret;

        tracing::info!("active configuration (from .env / environment / backend.toml):");

        tracing::info!("  server:");
        tracing::info!("    host:               {}", self.server.host);
        tracing::info!("    port:               {}", self.server.port);
        tracing::info!("    rust_log:           {}", self.server.rust_log);
        tracing::info!("    request_timeout:    {}s", self.server.request_timeout_secs);
        tracing::info!("    max_body_bytes:     {}", self.server.max_request_body_bytes);
        tracing::info!("    tcp_keepalive:      {:?}", self.server.tcp_keepalive_secs);
        tracing::info!("    tcp_nodelay:        {}", self.server.tcp_nodelay);
        tracing::info!("    valhalla_url:       {:?}", self.server.valhalla_url);

        tracing::info!("  database:");
        tracing::info!("    url:                {}", self.database.url);
        tracing::info!("    max_connections:    {}", self.database.max_connections);
        tracing::info!("    min_connections:    {}", self.database.min_connections);
        tracing::info!("    connect_timeout:    {}s", self.database.connect_timeout_secs);
        tracing::info!("    idle_timeout:       {}s", self.database.idle_timeout_secs);
        tracing::info!("    max_lifetime:       {}s", self.database.max_lifetime_secs);
        tracing::info!("    statement_cache:    {}", self.database.statement_cache_capacity);
        tracing::info!("    sqlx_logs:          {}", self.database.enable_sqlx_logs);

        tracing::info!("  jwt:");
        tracing::info!("    secret:             {}", mask_secret(&self.jwt.secret));
        tracing::info!("    access_ttl:         {}s", self.jwt.access_ttl_secs);
        tracing::info!("    refresh_ttl:        {}s", self.jwt.refresh_ttl_secs);
        tracing::info!("    issuer:             {}", self.jwt.issuer);

        tracing::info!("  cookie:");
        tracing::info!("    domain:             {}", self.cookie.domain);
        tracing::info!("    secure:             {}", self.cookie.secure);
        tracing::info!("    samesite:           {:?}", self.cookie.samesite);

        tracing::info!("  csrf:");
        tracing::info!("    token_ttl:          {}s", self.csrf.token_ttl_secs);

        tracing::info!("  cache:");
        tracing::info!("    backend:            {:?}", self.cache.backend);
        tracing::info!("    ttl:                {}s", self.cache.ttl_secs);
        tracing::info!("    max_capacity:       {}", self.cache.max_capacity);
        tracing::info!("    redis_url:          {}", self.cache.redis_url);

        tracing::info!("  storage:");
        tracing::info!("    backend:            {:?}", self.storage.backend);
        tracing::info!("    local_root:         {:?}", self.storage.local_root);
        tracing::info!("    s3_bucket:          {}", self.storage.s3_bucket);
        tracing::info!("    s3_region:          {}", self.storage.s3_region);
        tracing::info!("    s3_endpoint:        {:?}", self.storage.s3_endpoint);
        tracing::info!("    s3_access_key_id:   {}", mask_secret(&self.storage.s3_access_key_id));
        tracing::info!("    s3_secret_access:   {}", mask_secret(&self.storage.s3_secret_access_key));
        tracing::info!("    s3_force_path_style:{}", self.storage.s3_force_path_style);

        tracing::info!("  worker:");
        tracing::info!("    backend:            {:?}", self.worker.backend);
        tracing::info!("    concurrency:        {}", self.worker.concurrency);
        tracing::info!("    poll_interval:      {}ms", self.worker.poll_interval_ms);
        tracing::info!("    kafka_brokers:      {}", self.worker.kafka_brokers);
        tracing::info!("    kafka_group_id:     {}", self.worker.kafka_group_id);
        tracing::info!("    kafka_topic:        {}", self.worker.kafka_topic);

        tracing::info!("  rate_limit:");
        tracing::info!("    rpm:                {}", self.rate_limit.rpm);
        tracing::info!("    burst:              {}", self.rate_limit.burst);

        tracing::info!("  static_files:");
        tracing::info!("    dir:                {:?}", self.static_files.dir);
        tracing::info!("    cache_max_age:      {}s", self.static_files.cache_max_age);

        tracing::info!("  cors:");
        tracing::info!("    origins:            {:?}", self.cors.origin_list());
    }
}

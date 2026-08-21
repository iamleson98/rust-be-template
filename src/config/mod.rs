//! Typed application configuration loaded exclusively from `.env` (or environment).
//!
//! Resolved once at startup and stored in [`AppState`].

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub jwt: JwtConfig,
    pub cookie: CookieConfig,
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
    pub payment: PaymentConfig,
    #[allow(dead_code)]
    pub contact: ContactConfig,
    pub oauth: OAuthConfig,
}

// ────────────────────────────────────────────────────────────────
// Helper functions for clean environment variable extraction
// ────────────────────────────────────────────────────────────────

fn env_var(key: &str) -> Option<String> {
    env::var(key).ok().filter(|s| !s.trim().is_empty())
}

fn env_parse<T: std::str::FromStr>(key: &str) -> Option<T> {
    env_var(key).and_then(|v| v.parse().ok())
}

// ────────────────────────────────────────────────────────────────
// Struct Definitions & Defaults
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub rust_log: String,
    pub request_timeout_secs: u64,
    pub max_request_body_bytes: usize,
    pub tcp_keepalive_secs: Option<u64>,
    pub tcp_nodelay: bool,
    pub valhalla_url: Option<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: env_var("SERVER_HOST").unwrap_or_else(|| "0.0.0.0".into()),
            port: env_parse("SERVER_PORT").unwrap_or(8080),
            rust_log: env_var("RUST_LOG")
                .unwrap_or_else(|| "info,backend=debug,tower_http=info".into()),
            request_timeout_secs: env_parse("SERVER_REQUEST_TIMEOUT_SECS").unwrap_or(30),
            max_request_body_bytes: env_parse("SERVER_MAX_REQUEST_BODY_BYTES")
                .unwrap_or(2 * 1024 * 1024),
            tcp_keepalive_secs: env_parse("SERVER_TCP_KEEPALIVE_SECS").or(Some(60)),
            tcp_nodelay: env_parse("SERVER_TCP_NODELAY").unwrap_or(true),
            valhalla_url: env_var("SERVER_VALHALLA_URL"),
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
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub connect_timeout_secs: u64,
    pub idle_timeout_secs: u64,
    pub max_lifetime_secs: u64,
    pub statement_cache_capacity: usize,
    pub enable_sqlx_logs: bool,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: env_var("DATABASE_URL").unwrap_or_else(|| "sqlite://./app.db?mode=rwc".into()),
            max_connections: env_parse("DATABASE_MAX_CONNECTIONS").unwrap_or(20),
            min_connections: env_parse("DATABASE_MIN_CONNECTIONS").unwrap_or(5),
            connect_timeout_secs: env_parse("DATABASE_CONNECT_TIMEOUT_SECS").unwrap_or(10),
            idle_timeout_secs: env_parse("DATABASE_IDLE_TIMEOUT_SECS").unwrap_or(600),
            max_lifetime_secs: env_parse("DATABASE_MAX_LIFETIME_SECS").unwrap_or(1800),
            statement_cache_capacity: env_parse("DATABASE_STATEMENT_CACHE_CAPACITY").unwrap_or(100),
            enable_sqlx_logs: env_parse("DATABASE_ENABLE_SQLX_LOGS").unwrap_or(false),
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
pub struct JwtConfig {
    pub secret: String,
    pub access_ttl_secs: u64,
    pub refresh_ttl_secs: u64,
    pub issuer: String,
}

impl Default for JwtConfig {
    fn default() -> Self {
        Self {
            secret: env_var("JWT_SECRET")
                .unwrap_or_else(|| "change-me-in-production-please-use-32-bytes-or-more".into()),
            access_ttl_secs: env_parse("JWT_ACCESS_TTL_SECS").unwrap_or(900),
            refresh_ttl_secs: env_parse("JWT_REFRESH_TTL_SECS").unwrap_or(7 * 24 * 3600),
            issuer: env_var("JWT_ISSUER").unwrap_or_else(|| "backend".into()),
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
        let samesite = match env_var("COOKIE_SAMESITE").as_deref() {
            Some("strict") => SameSite::Strict,
            Some("none") => SameSite::None,
            _ => SameSite::Lax,
        };

        Self {
            // Default: empty domain → browser uses the request's host.
            // This is CRITICAL for same-origin cookie sharing:
            //   - In dev: Vite proxies /api → localhost:8080, so the
            //     browser sees cookies for `localhost` (the Vite origin).
            //     If we set domain=127.0.0.1, the cookies would be scoped
            //     to 127.0.0.1 but the browser is on localhost → mismatch.
            //   - In production: Rust serves both UI + API on the same
            //     origin. Empty domain → cookies are scoped to the origin
            //     host automatically.
            // Only set COOKIE_DOMAIN if you need cross-subdomain cookies
            // (e.g. COOKIE_DOMAIN=vexevn.vn for app.vexevn.vn + api.vexevn.vn).
            domain: env_var("COOKIE_DOMAIN").unwrap_or_default(),
            secure: env_parse("COOKIE_SECURE").unwrap_or(false),
            samesite,
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
#[serde(rename_all = "lowercase")]
pub enum CacheBackend {
    Moka,
    Redis,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CacheConfig {
    pub backend: CacheBackend,
    pub ttl_secs: u64,
    pub max_capacity: u64,
    pub redis_url: String,
}

impl Default for CacheConfig {
    fn default() -> Self {
        let backend = match env_var("CACHE_BACKEND").as_deref() {
            Some("redis") => CacheBackend::Redis,
            _ => CacheBackend::Moka,
        };

        Self {
            backend,
            ttl_secs: env_parse("CACHE_TTL_SECS").unwrap_or(300),
            max_capacity: env_parse("CACHE_MAX_CAPACITY").unwrap_or(100_000),
            redis_url: env_var("CACHE_REDIS_URL")
                .unwrap_or_else(|| "redis://127.0.0.1:6379/0".into()),
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
        let backend = match env_var("STORAGE_BACKEND").as_deref() {
            Some("s3") => StorageBackend::S3,
            Some("minio") => StorageBackend::Minio,
            _ => StorageBackend::Local,
        };

        Self {
            backend,
            local_root: env_var("STORAGE_LOCAL_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./storage")),
            s3_region: env_var("STORAGE_S3_REGION").unwrap_or_else(|| "us-east-1".into()),
            s3_bucket: env_var("STORAGE_S3_BUCKET").unwrap_or_else(|| "app-uploads".into()),
            s3_access_key_id: env_var("STORAGE_S3_ACCESS_KEY_ID").unwrap_or_default(),
            s3_secret_access_key: env_var("STORAGE_S3_SECRET_ACCESS_KEY").unwrap_or_default(),
            s3_endpoint: env_var("STORAGE_S3_ENDPOINT"),
            s3_force_path_style: env_parse("STORAGE_S3_FORCE_PATH_STYLE").unwrap_or(false),
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
        let backend = match env_var("WORKER_BACKEND").as_deref() {
            Some("db") => WorkerBackend::Db,
            Some("kafka") => WorkerBackend::Kafka,
            _ => WorkerBackend::Redis,
        };

        Self {
            backend,
            concurrency: env_parse("WORKER_CONCURRENCY").unwrap_or(4),
            poll_interval_ms: env_parse("WORKER_POLL_INTERVAL_MS").unwrap_or(1000),
            kafka_brokers: env_var("WORKER_KAFKA_BROKERS")
                .unwrap_or_else(|| "127.0.0.1:9092".into()),
            kafka_group_id: env_var("WORKER_KAFKA_GROUP_ID")
                .unwrap_or_else(|| "backend-workers".into()),
            kafka_topic: env_var("WORKER_KAFKA_TOPIC").unwrap_or_else(|| "jobs".into()),
        }
    }
}

impl WorkerConfig {
    pub fn poll_interval(&self) -> Duration {
        Duration::from_millis(self.poll_interval_ms)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RateLimitConfig {
    pub rpm: u32,
    pub burst: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            rpm: env_parse("RATE_LIMIT_RPM").unwrap_or(600),
            burst: env_parse("RATE_LIMIT_BURST").unwrap_or(100),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StaticFilesConfig {
    pub dir: PathBuf,
    pub cache_max_age: u64,
}

impl Default for StaticFilesConfig {
    fn default() -> Self {
        Self {
            dir: env_var("STATIC_FILES_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("./static")),
            cache_max_age: env_parse("STATIC_FILES_CACHE_MAX_AGE").unwrap_or(86_400),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CorsConfig {
    pub origins: String,
}

impl Default for CorsConfig {
    fn default() -> Self {
        Self {
            origins: env_var("CORS_ORIGINS")
                .unwrap_or_else(|| "http://127.0.0.1:3000,http://127.0.0.1:5173".into()),
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

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ZeroClawConfig {
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    pub timeout_ms: u64,
    pub max_history: usize,
    pub fallback_online_employees: usize,
}

impl Default for ZeroClawConfig {
    fn default() -> Self {
        Self {
            enabled: env_parse("ZEROCLAW_ENABLED").unwrap_or(false),
            api_url: env_var("ZEROCLAW_API_URL").unwrap_or_default(),
            api_key: env_var("ZEROCLAW_API_KEY").unwrap_or_default(),
            model: env_var("ZEROCLAW_MODEL").unwrap_or_else(|| "zeroclaw-default".into()),
            timeout_ms: env_parse("ZEROCLAW_TIMEOUT_MS").unwrap_or(15_000),
            max_history: env_parse("ZEROCLAW_MAX_HISTORY").unwrap_or(12),
            fallback_online_employees: env_parse("ZEROCLAW_FALLBACK_ONLINE_EMPLOYEES").unwrap_or(1),
        }
    }
}

impl ZeroClawConfig {
    pub fn is_active(&self) -> bool {
        self.enabled && !self.api_url.is_empty() && !self.api_key.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AudioCallConfig {
    pub enabled: bool,
    pub ice_servers: String,
}

impl Default for AudioCallConfig {
    fn default() -> Self {
        Self {
            enabled: env_parse("AUDIO_CALL_ENABLED").unwrap_or(true),
            ice_servers: env_var("AUDIO_CALL_ICE_SERVERS").unwrap_or_default(),
        }
    }
}

impl AudioCallConfig {
    pub fn ice_servers_json(&self) -> serde_json::Value {
        if self.ice_servers.is_empty() {
            return serde_json::Value::Array(vec![]);
        }
        serde_json::from_str(&self.ice_servers).unwrap_or_else(|_| serde_json::Value::Array(vec![]))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct SearchConfig {
    pub index_dir: Option<PathBuf>,
    pub osm_pbf_path: Option<PathBuf>,
}

impl SearchConfig {
    pub fn from_env() -> Self {
        Self {
            index_dir: env_var("SEARCH_INDEX_DIR").map(PathBuf::from),
            osm_pbf_path: env_var("SEARCH_OSM_PBF_PATH").map(PathBuf::from),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WsConfig {
    pub max_connections: usize,
    pub max_per_ip: usize,
    pub channel_capacity: usize,
    pub heartbeat_sec: u64,
    pub idle_timeout_sec: u64,
    pub max_message_bytes: usize,
    pub max_frame_bytes: usize,
}

impl Default for WsConfig {
    fn default() -> Self {
        Self {
            max_connections: env_parse("WS_MAX_CONNECTIONS").unwrap_or(50_000),
            max_per_ip: env_parse("WS_MAX_PER_IP").unwrap_or(10),
            channel_capacity: env_parse("WS_CHANNEL_CAPACITY").unwrap_or(256),
            heartbeat_sec: env_parse("WS_HEARTBEAT_SEC").unwrap_or(30),
            idle_timeout_sec: env_parse("WS_IDLE_TIMEOUT_SEC").unwrap_or(90),
            max_message_bytes: env_parse("WS_MAX_MESSAGE_BYTES").unwrap_or(64 * 1024),
            max_frame_bytes: env_parse("WS_MAX_FRAME_BYTES").unwrap_or(64 * 1024),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct ContactConfig {
    pub phone: String,
    pub email: String,
    pub address: String,
    pub zalo_url: String,
    pub facebook_url: String,
}

impl ContactConfig {
    pub fn from_env() -> Self {
        Self {
            phone: env_var("CONTACT_PHONE").unwrap_or_default(),
            email: env_var("CONTACT_EMAIL").unwrap_or_default(),
            address: env_var("CONTACT_ADDRESS").unwrap_or_default(),
            zalo_url: env_var("CONTACT_ZALO_URL").unwrap_or_default(),
            facebook_url: env_var("CONTACT_FACEBOOK_URL").unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PaymentConfig {
    pub public_base_url: String,
    pub default_expiry_minutes: u32,
    pub vnpay: VnpayConfig,
    pub momo: MomoConfig,
    pub zalopay: ZalopayConfig,
    pub vietqr: VietQrConfig,
    pub cod_enabled: bool,
}

impl Default for PaymentConfig {
    fn default() -> Self {
        Self {
            public_base_url: env_var("PAYMENT_PUBLIC_BASE_URL")
                .unwrap_or_else(|| "http://127.0.0.1:8080".into()),
            default_expiry_minutes: env_parse("PAYMENT_DEFAULT_EXPIRY_MINUTES").unwrap_or(10),
            vnpay: VnpayConfig::default(),
            momo: MomoConfig::default(),
            zalopay: ZalopayConfig::default(),
            vietqr: VietQrConfig::default(),
            cod_enabled: env_parse("PAYMENT_COD_ENABLED").unwrap_or(true),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VnpayConfig {
    pub enabled: bool,
    pub env: String,
    pub tmn_code: String,
    pub hash_secret: String,
}

impl Default for VnpayConfig {
    fn default() -> Self {
        Self {
            enabled: env_parse("VNPAY_ENABLED").unwrap_or(false),
            env: env_var("VNPAY_ENV").unwrap_or_else(|| "sandbox".into()),
            tmn_code: env_var("VNPAY_TMN_CODE").unwrap_or_default(),
            hash_secret: env_var("VNPAY_HASH_SECRET").unwrap_or_default(),
        }
    }
}

impl VnpayConfig {
    pub fn endpoint_base(&self) -> &'static str {
        if self.env == "production" {
            "https://payment.vnpayment.vn/paymentv2/vpcpay.html"
        } else {
            "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"
        }
    }

    pub fn is_active(&self) -> bool {
        self.enabled && !self.tmn_code.is_empty() && !self.hash_secret.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MomoConfig {
    pub enabled: bool,
    pub env: String,
    pub partner_code: String,
    pub access_key: String,
    pub secret_key: String,
}

impl Default for MomoConfig {
    fn default() -> Self {
        Self {
            enabled: env_parse("MOMO_ENABLED").unwrap_or(false),
            env: env_var("MOMO_ENV").unwrap_or_else(|| "sandbox".into()),
            partner_code: env_var("MOMO_PARTNER_CODE").unwrap_or_default(),
            access_key: env_var("MOMO_ACCESS_KEY").unwrap_or_default(),
            secret_key: env_var("MOMO_SECRET_KEY").unwrap_or_default(),
        }
    }
}

impl MomoConfig {
    pub fn endpoint(&self) -> &'static str {
        if self.env == "production" {
            "https://payment.momo.vn/v2/gateway/api/create"
        } else {
            "https://test-payment.momo.vn/v2/gateway/api/create"
        }
    }

    pub fn is_active(&self) -> bool {
        self.enabled
            && !self.partner_code.is_empty()
            && !self.access_key.is_empty()
            && !self.secret_key.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ZalopayConfig {
    pub enabled: bool,
    pub env: String,
    pub app_id: String,
    pub key1: String,
    pub key2: String,
}

impl Default for ZalopayConfig {
    fn default() -> Self {
        Self {
            enabled: env_parse("ZALOPAY_ENABLED").unwrap_or(false),
            env: env_var("ZALOPAY_ENV").unwrap_or_else(|| "sandbox".into()),
            app_id: env_var("ZALOPAY_APP_ID").unwrap_or_default(),
            key1: env_var("ZALOPAY_KEY1").unwrap_or_default(),
            key2: env_var("ZALOPAY_KEY2").unwrap_or_default(),
        }
    }
}

impl ZalopayConfig {
    pub fn endpoint_base(&self) -> &'static str {
        if self.env == "production" {
            "https://openapi.zalopay.com/v2"
        } else {
            "https://sb-openapi.zalopay.com/v2"
        }
    }

    pub fn is_active(&self) -> bool {
        self.enabled && !self.app_id.is_empty() && !self.key1.is_empty() && !self.key2.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct VietQrConfig {
    pub enabled: bool,
    pub bank_bin: String,
    pub account_no: String,
    pub account_name: String,
}

impl VietQrConfig {
    pub fn from_env() -> Self {
        Self {
            enabled: env_parse("VIETQR_ENABLED").unwrap_or(false),
            bank_bin: env_var("VIETQR_BANK_BIN").unwrap_or_default(),
            account_no: env_var("VIETQR_ACCOUNT_NO").unwrap_or_default(),
            account_name: env_var("VIETQR_ACCOUNT_NAME").unwrap_or_default(),
        }
    }

    pub fn is_active(&self) -> bool {
        self.enabled
            && !self.bank_bin.is_empty()
            && !self.account_no.is_empty()
            && !self.account_name.is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct OAuthConfig {
    pub redirect_base_url: String,
    pub frontend_url: String,
    pub facebook: OAuthProviderConfig,
    pub google: OAuthProviderConfig,
    pub twitter: OAuthProviderConfig,
}

impl OAuthConfig {
    pub fn from_env() -> Self {
        Self {
            redirect_base_url: env_var("OAUTH_REDIRECT_BASE_URL").unwrap_or_default(),
            frontend_url: env_var("OAUTH_FRONTEND_URL").unwrap_or_default(),
            facebook: OAuthProviderConfig::from_env("FACEBOOK"),
            google: OAuthProviderConfig::from_env("GOOGLE"),
            twitter: OAuthProviderConfig::from_env("TWITTER"),
        }
    }

    pub fn any_enabled(&self) -> bool {
        self.facebook.is_active() || self.google.is_active() || self.twitter.is_active()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct OAuthProviderConfig {
    pub enabled: bool,
    pub client_id: String,
    pub client_secret: String,
    pub scopes: String,
}

impl OAuthProviderConfig {
    pub fn from_env(provider: &str) -> Self {
        Self {
            enabled: env_parse(&format!("OAUTH_{}_ENABLED", provider)).unwrap_or(false),
            client_id: env_var(&format!("OAUTH_{}_CLIENT_ID", provider)).unwrap_or_default(),
            client_secret: env_var(&format!("OAUTH_{}_CLIENT_SECRET", provider))
                .unwrap_or_default(),
            scopes: env_var(&format!("OAUTH_{}_SCOPES", provider)).unwrap_or_default(),
        }
    }

    pub fn is_active(&self) -> bool {
        self.enabled && !self.client_id.is_empty() && !self.client_secret.is_empty()
    }
}

// ────────────────────────────────────────────────────────────────
// Core Config Loader & Validation
// ────────────────────────────────────────────────────────────────

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        // Parse `.env` file into standard std::env
        let _ = dotenvy::dotenv();

        let cfg = Config {
            server: ServerConfig::default(),
            database: DatabaseConfig::default(),
            jwt: JwtConfig::default(),
            cookie: CookieConfig::default(),
            cache: CacheConfig::default(),
            storage: StorageConfig::default(),
            worker: WorkerConfig::default(),
            rate_limit: RateLimitConfig::default(),
            static_files: StaticFilesConfig::default(),
            cors: CorsConfig::default(),
            zeroclaw: ZeroClawConfig::default(),
            audio_call: AudioCallConfig::default(),
            search: SearchConfig::from_env(),
            ws: WsConfig::default(),
            payment: PaymentConfig::default(),
            contact: ContactConfig::from_env(),
            oauth: OAuthConfig::from_env(),
        };

        cfg.validate()?;
        Ok(cfg)
    }

    fn validate(&self) -> anyhow::Result<()> {
        if self.jwt.secret.len() < 32 {
            anyhow::bail!("JWT_SECRET must be at least 32 bytes for HS256");
        }
        if self.jwt.secret == "change-me-in-production-please-use-32-bytes-or-more" {
            anyhow::bail!(
                "JWT_SECRET is the default placeholder shipped in source. \
                 Set a real 32+ byte secret via the JWT_SECRET env var."
            );
        }
        if self.worker.concurrency == 0 {
            anyhow::bail!("WORKER_CONCURRENCY must be > 0");
        }
        if !self.cookie.secure {
            tracing::warn!(
                "COOKIE_SECURE=false — refresh token will be sent over HTTP. \
                 Set COOKIE_SECURE=true in production."
            );
        }
        Ok(())
    }

    pub fn log_active(&self) {
        use crate::cli::util::mask_secret;

        tracing::info!("active configuration (loaded directly from .env / environment):");
        tracing::info!("  server: {}:{}", self.server.host, self.server.port);
        tracing::info!("  database url: {}", self.database.url);
        tracing::info!("  jwt issuer: {}", self.jwt.issuer);
        tracing::info!("  jwt secret: {}", mask_secret(&self.jwt.secret));
        tracing::info!("  storage backend: {:?}", self.storage.backend);
        tracing::info!("  worker backend: {:?}", self.worker.backend);
        tracing::info!("  payment cod_enabled: {}", self.payment.cod_enabled);
    }
}

//! `backend config show` — print resolved configuration (secrets masked).

use crate::cli::util::mask_secret;
use crate::config::Config;

pub fn run() -> anyhow::Result<()> {
    let cfg = Config::load()?;

    println!("Resolved configuration:");
    println!("  (loaded from .env / environment / backend.toml)");
    println!();
    println!("Server:");
    println!("  host:               {}", cfg.server.host);
    println!("  port:               {}", cfg.server.port);
    println!("  rust_log:           {}", cfg.server.rust_log);
    println!("  request_timeout:    {}s", cfg.server.request_timeout_secs);
    println!("  max_body_bytes:     {}", cfg.server.max_request_body_bytes);
    println!("  tcp_keepalive:      {:?}", cfg.server.tcp_keepalive_secs);
    println!("  tcp_nodelay:        {}", cfg.server.tcp_nodelay);
    println!();
    println!("Database:");
    println!("  url:                {}", cfg.database.url);
    println!("  max_conns:          {}", cfg.database.max_connections);
    println!("  min_conns:          {}", cfg.database.min_connections);
    println!("  conn_timeout:       {}s", cfg.database.connect_timeout_secs);
    println!("  idle_timeout:       {}s", cfg.database.idle_timeout_secs);
    println!("  max_lifetime:       {}s", cfg.database.max_lifetime_secs);
    println!("  statement_cache:    {}", cfg.database.statement_cache_capacity);
    println!("  sqlx_logs:          {}", cfg.database.enable_sqlx_logs);
    println!();
    println!("JWT:");
    println!("  secret:             {}", mask_secret(&cfg.jwt.secret));
    println!("  access_ttl:         {}s", cfg.jwt.access_ttl_secs);
    println!("  refresh_ttl:        {}s", cfg.jwt.refresh_ttl_secs);
    println!("  issuer:             {}", cfg.jwt.issuer);
    println!();
    println!("Cookie:");
    println!("  domain:             {}", cfg.cookie.domain);
    println!("  secure:             {}", cfg.cookie.secure);
    println!("  samesite:           {:?}", cfg.cookie.samesite);
    println!();
    println!("Cache:");
    println!("  backend:            {:?}", cfg.cache.backend);
    println!("  ttl_secs:           {}", cfg.cache.ttl_secs);
    println!("  max_cap:            {}", cfg.cache.max_capacity);
    println!("  redis_url:          {}", cfg.cache.redis_url);
    println!();
    println!("Storage:");
    println!("  backend:            {:?}", cfg.storage.backend);
    println!("  local_root:         {:?}", cfg.storage.local_root);
    println!("  s3_bucket:          {}", cfg.storage.s3_bucket);
    println!("  s3_region:          {}", cfg.storage.s3_region);
    println!("  s3_endpoint:        {:?}", cfg.storage.s3_endpoint);
    println!("  s3_access_key_id:   {}", mask_secret(&cfg.storage.s3_access_key_id));
    println!("  s3_secret_access:   {}", mask_secret(&cfg.storage.s3_secret_access_key));
    println!("  s3_force_path_style:{}", cfg.storage.s3_force_path_style);
    println!();
    println!("Worker:");
    println!("  backend:            {:?}", cfg.worker.backend);
    println!("  concurrency:       {}", cfg.worker.concurrency);
    println!("  poll_int_ms:        {}", cfg.worker.poll_interval_ms);
    println!("  kafka_brokers:      {}", cfg.worker.kafka_brokers);
    println!("  kafka_group_id:     {}", cfg.worker.kafka_group_id);
    println!("  kafka_topic:        {}", cfg.worker.kafka_topic);
    println!();
    println!("Rate limit:");
    println!("  rpm:                {}", cfg.rate_limit.rpm);
    println!("  burst:              {}", cfg.rate_limit.burst);
    println!();
    println!("Static files:");
    println!("  dir:                {:?}", cfg.static_files.dir);
    println!("  cache_max_age:      {}s", cfg.static_files.cache_max_age);
    println!();
    println!("CORS origins: {:?}", cfg.cors.origin_list());

    Ok(())
}

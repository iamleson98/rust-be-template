//! `backend config show` — print resolved configuration (secrets masked).

use crate::cli::util::mask_secret;
use crate::config::Config;

pub fn run() -> anyhow::Result<()> {
    let cfg = Config::load()?;

    println!("Resolved configuration:");
    println!("  (loaded from .env / environment / backend.toml)");
    println!();
    println!("Server:");
    println!("  host:        {}", cfg.server.host);
    println!("  port:        {}", cfg.server.port);
    println!("  rust_log:    {}", cfg.server.rust_log);
    println!();
    println!("Database:");
    println!("  url:         {}", cfg.database.url);
    println!("  max_conns:   {}", cfg.database.max_connections);
    println!("  min_conns:   {}", cfg.database.min_connections);
    println!("  conn_timeout: {}s", cfg.database.connect_timeout_secs);
    println!("  idle_timeout: {}s", cfg.database.idle_timeout_secs);
    println!("  sqlx_logs:   {}", cfg.database.enable_sqlx_logs);
    println!();
    println!("JWT:");
    println!("  secret:      {}", mask_secret(&cfg.jwt.secret));
    println!("  access_ttl:  {}s", cfg.jwt.access_ttl_secs);
    println!("  refresh_ttl: {}s", cfg.jwt.refresh_ttl_secs);
    println!("  issuer:      {}", cfg.jwt.issuer);
    println!();
    println!("Cache:");
    println!("  backend:     {:?}", cfg.cache.backend);
    println!("  ttl_secs:    {}", cfg.cache.ttl_secs);
    println!("  max_cap:     {}", cfg.cache.max_capacity);
    println!("  redis_url:   {}", cfg.cache.redis_url);
    println!();
    println!("Storage:");
    println!("  backend:     {:?}", cfg.storage.backend);
    println!("  local_root:  {:?}", cfg.storage.local_root);
    println!("  s3_bucket:   {}", cfg.storage.s3_bucket);
    println!("  s3_region:   {}", cfg.storage.s3_region);
    println!("  s3_endpoint:  {:?}", cfg.storage.s3_endpoint);
    println!();
    println!("Worker:");
    println!("  backend:     {:?}", cfg.worker.backend);
    println!("  concurrency: {}", cfg.worker.concurrency);
    println!("  poll_int_ms: {}", cfg.worker.poll_interval_ms);
    println!();
    println!("Rate limit:");
    println!("  rpm:         {}", cfg.rate_limit.rpm);
    println!("  burst:       {}", cfg.rate_limit.burst);
    println!();
    println!("CORS origins: {:?}", cfg.cors.origin_list());

    Ok(())
}

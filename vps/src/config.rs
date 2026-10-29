//! Service configuration: a TOML file for everything that is not secret, the
//! environment for the tokens (systemd `EnvironmentFile=`, mode 0600).

use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use chrono_tz::Tz;
use croner::Cron;
use serde::Deserialize;

/// Bearer token every `/v1/*` request must carry.
pub const SERVICE_TOKEN_ENV: &str = "VPS_SERVICE_TOKEN";

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// Time zone the schedules are written in.
    #[serde(default = "default_timezone")]
    pub timezone: String,
    pub server: ServerConfig,
    pub indexer: IndexerConfig,
    #[serde(default)]
    pub jobs: Vec<HttpJobConfig>,
    /// Resolved from `SERVICE_TOKEN_ENV` at load time, never from the file.
    #[serde(skip)]
    pub service_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerConfig {
    /// Loopback only: Cloudflare Tunnel (cloudflared) is the way in.
    #[serde(default = "default_listen")]
    pub listen: String,
    pub data_dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndexerConfig {
    /// Cron expression (5 fields, `timezone`) for the OSM refresh.
    #[serde(default = "default_index_schedule")]
    pub schedule: String,
    #[serde(default = "default_pbf_url")]
    pub pbf_url: String,
    /// Extractor profile: travel | landmarks | full | all.
    #[serde(default = "default_profile")]
    pub profile: String,
    /// A download smaller than this is an error page, not the extract.
    #[serde(default = "default_min_pbf_bytes")]
    pub min_pbf_bytes: u64,
    /// A new index with fewer places than this is broken and is not published.
    #[serde(default = "default_min_places")]
    pub min_places: usize,
    /// Nor is one that lost more than this share of the current index's places.
    #[serde(default = "default_max_shrink")]
    pub max_shrink: f64,
    /// Index generations kept on disk (the current one plus rollbacks).
    #[serde(default = "default_keep_generations")]
    pub keep_generations: usize,
    /// Geofabrik asks bulk consumers to identify themselves.
    #[serde(default = "default_user_agent")]
    pub user_agent: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HttpJobConfig {
    pub name: String,
    /// Cron expression (5 fields, `timezone`).
    pub schedule: String,
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    /// Environment variable holding the token sent in `token_header`.
    pub token_env: Option<String>,
    #[serde(default = "default_token_header")]
    pub token_header: String,
    #[serde(default = "default_job_timeout")]
    pub timeout_secs: u64,
    /// Extra attempts after a network error or a 5xx answer (never after a 4xx).
    #[serde(default = "default_retries")]
    pub retries: u32,
    /// Resolved from `token_env` at load time.
    #[serde(skip)]
    pub token: Option<String>,
}

impl HttpJobConfig {
    pub fn timeout(&self) -> Duration {
        Duration::from_secs(self.timeout_secs)
    }
}

fn default_timezone() -> String {
    "Asia/Ho_Chi_Minh".into()
}
fn default_listen() -> String {
    "127.0.0.1:8787".into()
}
fn default_index_schedule() -> String {
    // Mondays 03:30 Vietnam time: quiet hours, after Geofabrik's daily build.
    "30 3 * * 1".into()
}
fn default_pbf_url() -> String {
    "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf".into()
}
fn default_profile() -> String {
    "all".into()
}
fn default_min_pbf_bytes() -> u64 {
    150_000_000
}
fn default_min_places() -> usize {
    15_000
}
fn default_max_shrink() -> f64 {
    0.2
}
fn default_keep_generations() -> usize {
    2
}
fn default_user_agent() -> String {
    "datxevui-vps-service (+https://github.com/iamleson98/rust-be-template)".into()
}
fn default_method() -> String {
    "POST".into()
}
fn default_token_header() -> String {
    "x-cron-token".into()
}
fn default_job_timeout() -> u64 {
    50
}
fn default_retries() -> u32 {
    2
}

pub fn parse_cron(pattern: &str) -> Result<Cron> {
    Cron::from_str(pattern).with_context(|| format!("invalid cron expression {pattern:?}"))
}

impl Config {
    /// Reads, validates and resolves secrets. Every mistake is reported at
    /// start-up, never at 03:30 on a Monday.
    pub fn load(path: &Path) -> Result<Config> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("read config {}", path.display()))?;
        let mut cfg: Config =
            toml::from_str(&text).with_context(|| format!("parse config {}", path.display()))?;
        cfg.service_token = std::env::var(SERVICE_TOKEN_ENV).unwrap_or_default();
        if cfg.service_token.len() < 24 {
            bail!("{SERVICE_TOKEN_ENV} must be set to a random token of at least 24 characters");
        }
        for job in &mut cfg.jobs {
            if let Some(var) = &job.token_env {
                let token = std::env::var(var)
                    .with_context(|| format!("job {:?}: {var} is not set", job.name))?;
                job.token = Some(token);
            }
        }
        cfg.validate()?;
        Ok(cfg)
    }

    pub fn tz(&self) -> Tz {
        self.timezone
            .parse()
            .expect("validated in Config::validate")
    }

    fn validate(&self) -> Result<()> {
        self.timezone
            .parse::<Tz>()
            .map_err(|e| anyhow::anyhow!("timezone {:?}: {e}", self.timezone))?;
        parse_cron(&self.indexer.schedule).context("indexer.schedule")?;
        self.indexer.profile()?;
        if !(0.0..1.0).contains(&self.indexer.max_shrink) {
            bail!("indexer.max_shrink must be in [0, 1)");
        }
        if self.indexer.keep_generations == 0 {
            bail!("indexer.keep_generations must be at least 1");
        }
        let mut names = std::collections::HashSet::new();
        for job in &self.jobs {
            if !names.insert(&job.name) {
                bail!("duplicate job name {:?}", job.name);
            }
            parse_cron(&job.schedule).with_context(|| format!("job {:?}", job.name))?;
            reqwest::Method::from_bytes(job.method.as_bytes())
                .with_context(|| format!("job {:?}: method {:?}", job.name, job.method))?;
            let url = reqwest::Url::parse(&job.url)
                .with_context(|| format!("job {:?}: url {:?}", job.name, job.url))?;
            if url.scheme() != "https" && url.host_str() != Some("127.0.0.1") {
                bail!("job {:?}: only https URLs carry a token safely", job.name);
            }
        }
        Ok(())
    }
}

impl IndexerConfig {
    pub fn profile(&self) -> Result<place_extract::travel::Profile> {
        use clap::ValueEnum;
        place_extract::travel::Profile::from_str(&self.profile, true).map_err(|_| {
            anyhow::anyhow!(
                "indexer.profile {:?}: travel | landmarks | full | all",
                self.profile
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = include_str!("../config.example.toml");

    #[test]
    fn the_example_config_is_valid() {
        let mut cfg: Config = toml::from_str(EXAMPLE).unwrap();
        cfg.service_token = "x".repeat(32);
        cfg.validate().unwrap();
        assert_eq!(cfg.jobs[0].name, "worker-tick");
        assert_eq!(cfg.indexer.keep_generations, 2);
    }

    #[test]
    fn rejects_bad_schedules_and_plain_http() {
        let mut cfg: Config = toml::from_str(EXAMPLE).unwrap();
        cfg.jobs[0].schedule = "every minute".into();
        assert!(cfg.validate().is_err());
        let mut cfg: Config = toml::from_str(EXAMPLE).unwrap();
        cfg.jobs[0].url = "http://datxevui.com/api/jobs/tick".into();
        assert!(cfg.validate().is_err());
    }
}

//! State shared by the HTTP handlers, the scheduler and the indexer.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use arc_swap::ArcSwapOption;
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::config::Config;
use crate::metrics::{Latency, Sampler};
use crate::places::Engine;
use crate::store::{Manifest, Store};

/// How the last index run went (`/v1/status`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRun {
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    /// "updated" | "unchanged" | "failed"
    pub outcome: &'static str,
    pub detail: String,
    /// Wall time of each phase, milliseconds (only the phases that ran).
    pub phases_ms: BTreeMap<&'static str, u64>,
    pub places: Option<usize>,
    pub dropped: Option<usize>,
    pub download_bytes: Option<u64>,
    /// CPU seconds and peak memory of the extractor process.
    pub extractor_cpu_secs: Option<f64>,
    pub extractor_peak_rss_bytes: Option<u64>,
}

#[derive(Debug, Default)]
pub struct IndexState {
    pub running: bool,
    pub current: Option<Manifest>,
    pub last_run: Option<IndexRun>,
}

/// One scheduled HTTP job's record (`/v1/status`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    pub name: String,
    pub schedule: String,
    pub url: String,
    pub next_run_at: Option<DateTime<Utc>>,
    pub runs: u64,
    pub failures: u64,
    pub consecutive_failures: u64,
    pub last_run: Option<JobRun>,
    pub last_success_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRun {
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub ok: bool,
    pub http_status: Option<u16>,
    pub attempts: u32,
    /// What the endpoint said it did ("holds.sweep=succeeded"), or the error.
    pub summary: String,
}

pub struct AppState {
    pub config: Config,
    pub store: Store,
    pub engine: ArcSwapOption<Engine>,
    pub index: Mutex<IndexState>,
    pub jobs: Mutex<BTreeMap<String, JobStatus>>,
    pub search_latency: Latency,
    pub reverse_latency: Latency,
    pub sampler: Sampler,
    pub http: reqwest::Client,
    pub started_at: DateTime<Utc>,
    pub started: Instant,
}

pub type Shared = Arc<AppState>;

impl AppState {
    pub fn new(config: Config, store: Store) -> anyhow::Result<AppState> {
        let http = reqwest::Client::builder()
            .user_agent(config.indexer.user_agent.clone())
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()?;
        Ok(AppState {
            sampler: Sampler::new(&config.server.data_dir),
            config,
            store,
            engine: ArcSwapOption::empty(),
            index: Mutex::new(IndexState::default()),
            jobs: Mutex::new(BTreeMap::new()),
            search_latency: Latency::default(),
            reverse_latency: Latency::default(),
            http,
            started_at: Utc::now(),
            started: Instant::now(),
        })
    }
}

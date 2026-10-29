//! Cron: calls the Worker's job endpoints on their schedules and runs the
//! OSM refresh on its own.
//!
//! Each job is one task that sleeps until its next slot. A slow run never
//! overlaps itself: the next slot is computed after the run, so missed slots
//! are skipped, not replayed (the Worker's executor catches up by itself).
//! Network errors and 5xx answers are retried with backoff, but never past the
//! next slot; a 4xx is a configuration problem and is not retried.

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use croner::Cron;
use tokio::sync::watch;
use tracing::{debug, info, warn};

use crate::config::{parse_cron, HttpJobConfig};
use crate::indexer::{self, Source};
use crate::state::{AppState, JobRun, JobStatus};

const BACKOFF: [Duration; 3] = [
    Duration::from_secs(2),
    Duration::from_secs(8),
    Duration::from_secs(20),
];
/// Bytes of a response body kept as the run summary.
const SUMMARY_CHARS: usize = 300;

/// The next slot of `cron` after `now`, in the configured time zone.
pub fn next_slot(cron: &Cron, tz: chrono_tz::Tz, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    cron.find_next_occurrence(&now.with_timezone(&tz), false)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// Sleeps until `at`, or returns `false` early when shutting down.
async fn sleep_until(at: DateTime<Utc>, shutdown: &mut watch::Receiver<bool>) -> bool {
    let wait = (at - Utc::now()).to_std().unwrap_or_default();
    tokio::select! {
        _ = tokio::time::sleep(wait) => true,
        _ = shutdown.changed() => false,
    }
}

pub fn spawn_all(state: Arc<AppState>, shutdown: watch::Receiver<bool>) {
    for job in state.config.jobs.clone() {
        let cron = parse_cron(&job.schedule).expect("validated at load");
        state.jobs.lock().unwrap().insert(
            job.name.clone(),
            JobStatus {
                name: job.name.clone(),
                schedule: job.schedule.clone(),
                url: job.url.clone(),
                next_run_at: None,
                runs: 0,
                failures: 0,
                consecutive_failures: 0,
                last_run: None,
                last_success_at: None,
            },
        );
        tokio::spawn(http_job_loop(state.clone(), job, cron, shutdown.clone()));
    }
    tokio::spawn(index_loop(state, shutdown));
}

async fn index_loop(state: Arc<AppState>, mut shutdown: watch::Receiver<bool>) {
    // No index yet (first start, or every generation lost): build one now
    // rather than serve nothing until Monday.
    if state.engine.load().is_none() {
        info!("no live index: running the indexer now");
        if let Err(e) = indexer::run(state.clone(), Source::Remote { force: true }).await {
            warn!("initial index run: {e:#}");
        }
    }
    let cron = parse_cron(&state.config.indexer.schedule).expect("validated at load");
    let tz = state.config.tz();
    loop {
        let Some(at) = next_slot(&cron, tz, Utc::now()) else {
            warn!("indexer schedule has no next slot; stopping it");
            return;
        };
        info!("next index run at {at}");
        if !sleep_until(at, &mut shutdown).await {
            return;
        }
        if let Err(e) = indexer::run(state.clone(), Source::Remote { force: false }).await {
            warn!("index run: {e:#}");
        }
    }
}

async fn http_job_loop(
    state: Arc<AppState>,
    job: HttpJobConfig,
    cron: Cron,
    mut shutdown: watch::Receiver<bool>,
) {
    let tz = state.config.tz();
    loop {
        let Some(at) = next_slot(&cron, tz, Utc::now()) else {
            warn!("job {}: schedule has no next slot; stopping it", job.name);
            return;
        };
        if let Some(status) = state.jobs.lock().unwrap().get_mut(&job.name) {
            status.next_run_at = Some(at);
        }
        if !sleep_until(at, &mut shutdown).await {
            return;
        }
        // Retries stop short of the following slot.
        let deadline = next_slot(&cron, tz, at).map(|n| n - chrono::Duration::seconds(1));
        let run = call(&state.http, &job, deadline).await;
        record(&state, &job.name, run);
    }
}

/// One scheduled call, with retries.
pub async fn call(
    http: &reqwest::Client,
    job: &HttpJobConfig,
    deadline: Option<DateTime<Utc>>,
) -> JobRun {
    let started_at = Utc::now();
    let started = Instant::now();
    let method = reqwest::Method::from_bytes(job.method.as_bytes()).expect("validated at load");
    let mut attempts = 0;
    loop {
        attempts += 1;
        let mut req = http
            .request(method.clone(), &job.url)
            .timeout(job.timeout())
            .header("user-agent", "datxevui-vps-cron");
        if let Some(token) = &job.token {
            req = req.header(job.token_header.as_str(), token);
        }
        let (retry, http_status, summary) = match req.send().await {
            Ok(res) => {
                let status = res.status();
                let body = res.text().await.unwrap_or_default();
                let summary = summarize(&body);
                (status.is_server_error(), Some(status.as_u16()), summary)
            }
            Err(e) => (true, None, format!("{e}")),
        };
        let ok = http_status.is_some_and(|s| (200..300).contains(&s));
        let backoff = BACKOFF[(attempts as usize - 1).min(BACKOFF.len() - 1)];
        let in_time = deadline.is_none_or(|d| Utc::now() + backoff < d);
        if ok || !retry || attempts > job.retries || !in_time {
            return JobRun {
                started_at,
                duration_ms: started.elapsed().as_millis() as u64,
                ok,
                http_status,
                attempts,
                summary,
            };
        }
        debug!(
            "job {}: attempt {attempts} failed ({summary}); retrying",
            job.name
        );
        tokio::time::sleep(backoff).await;
    }
}

/// The Worker's tick answers `{"ok":true,"ran":[{"jobType","status",…}]}`:
/// keep it as `holds.sweep=succeeded …`; anything else, a trimmed body.
fn summarize(body: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Tick {
        ran: Vec<Ran>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Ran {
        job_type: String,
        status: String,
    }
    if let Ok(tick) = serde_json::from_str::<Tick>(body) {
        if tick.ran.is_empty() {
            return "nothing due".into();
        }
        return tick
            .ran
            .iter()
            .map(|r| format!("{}={}", r.job_type, r.status))
            .collect::<Vec<_>>()
            .join(" ");
    }
    body.chars().take(SUMMARY_CHARS).collect()
}

fn record(state: &AppState, name: &str, run: JobRun) {
    if run.ok {
        debug!("job {name}: {}", run.summary);
    } else {
        warn!(
            "job {name} failed after {} attempt(s): status {:?}, {}",
            run.attempts, run.http_status, run.summary
        );
    }
    let mut jobs = state.jobs.lock().unwrap();
    let Some(status) = jobs.get_mut(name) else {
        return;
    };
    status.runs += 1;
    if run.ok {
        status.consecutive_failures = 0;
        status.last_success_at = Some(run.started_at);
    } else {
        status.failures += 1;
        status.consecutive_failures += 1;
    }
    status.last_run = Some(run);
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn slots_follow_the_configured_time_zone() {
        let cron = parse_cron("30 3 * * 1").unwrap();
        let tz: chrono_tz::Tz = "Asia/Ho_Chi_Minh".parse().unwrap();
        // Sunday 2026-11-01 12:00 UTC → Monday 03:30 +07 = Sunday 20:30 UTC.
        let now = Utc.with_ymd_and_hms(2026, 11, 1, 12, 0, 0).unwrap();
        let next = next_slot(&cron, tz, now).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 11, 1, 20, 30, 0).unwrap());
        let every_minute = parse_cron("* * * * *").unwrap();
        let next = next_slot(&every_minute, tz, now).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 11, 1, 12, 1, 0).unwrap());
    }

    #[test]
    fn summarizes_the_worker_tick() {
        let body = r#"{"ok":true,"ran":[{"jobType":"holds.sweep","status":"succeeded","detail":"{}"},{"jobType":"coupons.expire","status":"failed","error":"x"}]}"#;
        assert_eq!(
            summarize(body),
            "holds.sweep=succeeded coupons.expire=failed"
        );
        assert_eq!(summarize(r#"{"ok":true,"ran":[]}"#), "nothing due");
        assert_eq!(summarize("Service Unavailable"), "Service Unavailable");
    }
}

//! `places.build` — weekly: rebuild the place index from Geofabrik's Vietnam
//! extract and publish it as a new generation (see [`crate::places::build`]).
//!
//! The server never extracts anything itself: the extraction peaks at several
//! hundred MB, which would land in the API's heap and cgroup. The job runs
//! `places-build` as a **child process of this very executable** and only waits
//! for it:
//!
//! * niced to 19, idle I/O class, `oom_score_adj` 1000 (Linux): under memory
//!   pressure the kernel kills the child, not the server;
//! * a wall-clock timeout, and the child dies with the run (operator cancel,
//!   shutdown) — a killed build leaves no half-published generation, and the
//!   next run empties its scratch directory;
//! * one build at a time: an in-process guard here, and the build's own
//!   `PLACES_DIR/.lock` file (also taken by a manual `datxevui places-build`).
//!
//! The child's last stdout line is its machine-readable
//! [`BuildSummary`]; it becomes the run's `detail` (shown in the admin
//! "Cron jobs" tab). The server's own watcher ([`crate::places::live`]) swaps
//! a published generation in within a minute.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::task::JoinHandle;

use crate::places::build::{BuildResult, BuildSummary};
use crate::worker::{Backoff, Job, JobContext, JobPolicy};

/// The child's wall-clock budget: the download alone is minutes, the whole
/// build well under half an hour on the target box.
const BUILD_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// What the runner's own timeout adds on top, so the child is stopped (and
/// reported) here first.
const RUNNER_SLACK: Duration = Duration::from_secs(60);
/// `oom_score_adj` of the child: the OOM killer's first choice.
#[cfg(target_os = "linux")]
const CHILD_OOM_SCORE_ADJ: &[u8] = b"1000";
/// Last stderr lines kept to explain a child that died without a summary.
const STDERR_TAIL_LINES: usize = 8;
const STDOUT_LIMIT: u64 = 1 << 20;

pub struct PlacesBuild {
    /// The executable to run; `None` = this process's own.
    program: Option<PathBuf>,
    args: Vec<String>,
    timeout: Duration,
    /// Set while a build of this process is running.
    running: Arc<AtomicBool>,
}

/// The real job: this executable's `places-build`.
impl Default for PlacesBuild {
    fn default() -> Self {
        Self {
            program: None,
            args: vec!["places-build".into()],
            timeout: BUILD_TIMEOUT,
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl PlacesBuild {
    /// Runs `program args…` instead of `places-build` (tests).
    #[cfg(test)]
    fn with_command(program: &str, args: &[&str], timeout: Duration) -> Self {
        Self {
            program: Some(program.into()),
            args: args.iter().map(|a| a.to_string()).collect(),
            timeout,
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    fn command(&self) -> anyhow::Result<Command> {
        let program = match &self.program {
            Some(program) => program.clone(),
            None => std::env::current_exe().context("locating this executable")?,
        };
        let mut command = Command::new(program);
        command
            .args(&self.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Its log lines are read by people and by the failure message.
            .env("NO_COLOR", "1")
            .kill_on_drop(true);
        #[cfg(unix)]
        // SAFETY: the closure only makes async-signal-safe syscalls and
        // allocates nothing: it runs between `fork` and `exec`.
        unsafe {
            command.pre_exec(deprioritize);
        }
        Ok(command)
    }

    /// Runs the child to the end, a timeout or a cancel.
    async fn run_child(&self, ctx: &JobContext) -> anyhow::Result<Ended> {
        let mut child = self
            .command()?
            .spawn()
            .context("starting the places-build child")?;
        let stdout = read_stdout(child.stdout.take());
        let stderr = forward_stderr(child.stderr.take());
        ctx.progress(json!({
            "phase": "running",
            "message": "building the place index",
        }))
        .await;

        let ended = tokio::select! {
            status = child.wait() => Some(status.context("waiting for the child")?),
            _ = tokio::time::sleep(self.timeout) => None,
            _ = ctx.cancel.cancelled() => return stop(child, Ended::Cancelled).await,
        };
        match ended {
            Some(status) => Ok(Ended::Exited {
                status: status.to_string(),
                success: status.success(),
                stdout: stdout.await.unwrap_or_default(),
                stderr_tail: stderr.await.unwrap_or_default(),
            }),
            None => stop(child, Ended::TimedOut).await,
        }
    }
}

/// Kills a child that is still running and waits for it.
async fn stop(mut child: Child, ended: Ended) -> anyhow::Result<Ended> {
    child.kill().await.context("stopping the child")?;
    Ok(ended)
}

/// How the child's run ended.
enum Ended {
    Exited {
        /// "exit status: 1", "signal: 9 (SIGKILL)"…
        status: String,
        success: bool,
        stdout: String,
        stderr_tail: String,
    },
    TimedOut,
    Cancelled,
}

#[async_trait]
impl Job for PlacesBuild {
    const KIND: &'static str = "places.build";
    type Args = ();

    fn policy(&self) -> JobPolicy {
        JobPolicy {
            timeout: self.timeout + RUNNER_SLACK,
            // One retry, long after: a network failure is the likely cause.
            max_attempts: 2,
            backoff: Backoff {
                base: Duration::from_secs(20 * 60),
                cap: Duration::from_secs(60 * 60),
            },
        }
    }

    async fn perform(&self, ctx: &JobContext, _: ()) -> anyhow::Result<()> {
        let Some(_guard) = RunGuard::acquire(&self.running) else {
            anyhow::bail!("a place-index build is already running in this process");
        };
        let started = Instant::now();
        let ended = self.run_child(ctx).await?;
        let took = started.elapsed();
        let summary = match ended {
            Ended::Cancelled => anyhow::bail!("stopped"),
            Ended::TimedOut => BuildSummary::failed(
                None,
                took,
                format!(
                    "the build did not finish within {} minutes and was stopped",
                    self.timeout.as_secs() / 60
                ),
            ),
            Ended::Exited {
                status,
                success,
                stdout,
                stderr_tail,
            } => interpret(&status, success, &stdout, &stderr_tail, took),
        };
        ctx.progress(detail(&summary)).await;
        match summary.outcome {
            BuildResult::Failed => Err(anyhow!(summary
                .reason
                .unwrap_or_else(|| "the build failed".into()))),
            BuildResult::Published | BuildResult::Unchanged => Ok(()),
        }
    }
}

/// What a finished child means: its own summary when exit status and summary
/// agree, otherwise a failure that says what was seen.
fn interpret(
    status: &str,
    success: bool,
    stdout: &str,
    stderr_tail: &str,
    took: Duration,
) -> BuildSummary {
    let failed = |profile: Option<String>, reason: String| {
        BuildSummary::failed(profile.as_deref(), took, reason)
    };
    match BuildSummary::from_stdout(stdout) {
        Some(summary) if success == (summary.outcome != BuildResult::Failed) => summary,
        Some(summary) => failed(
            summary.profile,
            format!(
                "the build ended with {status} but reported {}",
                match summary.outcome {
                    BuildResult::Published => "published",
                    BuildResult::Unchanged => "unchanged",
                    BuildResult::Failed => "failed",
                }
            ),
        ),
        None if success => failed(
            None,
            "the build ended without a summary line on stdout".into(),
        ),
        None if stderr_tail.is_empty() => failed(None, format!("the build ended with {status}")),
        None => failed(
            None,
            format!("the build ended with {status}: {stderr_tail}"),
        ),
    }
}

/// The run's `detail`: the summary plus a plain-English `message` for
/// clients that do not know its fields.
fn detail(summary: &BuildSummary) -> Value {
    let mut detail = serde_json::to_value(summary).expect("a summary always serializes");
    detail["phase"] = json!("done");
    detail["message"] = json!(summary.describe());
    detail
}

/// The child's stdout (one summary line, the rest is capped).
fn read_stdout(stdout: Option<ChildStdout>) -> JoinHandle<String> {
    tokio::spawn(async move {
        let mut bytes = Vec::new();
        if let Some(stdout) = stdout {
            let _ = stdout.take(STDOUT_LIMIT).read_to_end(&mut bytes).await;
        }
        String::from_utf8_lossy(&bytes).into_owned()
    })
}

/// Passes the child's log lines on to ours and keeps the last few.
fn forward_stderr(stderr: Option<ChildStderr>) -> JoinHandle<String> {
    tokio::spawn(async move {
        let mut tail = VecDeque::with_capacity(STDERR_TAIL_LINES);
        if let Some(stderr) = stderr {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::info!(target: "places_build", "{line}");
                if tail.len() == STDERR_TAIL_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
        }
        tail.into_iter().collect::<Vec<_>>().join(" | ")
    })
}

/// Marks a build running for as long as it lives.
struct RunGuard(Arc<AtomicBool>);

impl RunGuard {
    fn acquire(flag: &Arc<AtomicBool>) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(flag.clone()))
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Runs in the child between `fork` and `exec`: lowest CPU priority, idle I/O
/// class and the OOM killer's first pick. Each step is best effort (a
/// sandbox may refuse one): the build is only slower or less protected
/// without it, never wrong.
#[cfg(unix)]
fn deprioritize() -> std::io::Result<()> {
    // SAFETY: plain syscalls on constant arguments, no allocation.
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS as _, 0, 19);
        #[cfg(target_os = "linux")]
        {
            // IOPRIO_WHO_PROCESS = 1; class idle = 3, shifted by 13 bits.
            libc::syscall(libc::SYS_ioprio_set, 1, 0, 3 << 13);
            let fd = libc::open(c"/proc/self/oom_score_adj".as_ptr(), libc::O_WRONLY);
            if fd >= 0 {
                libc::write(
                    fd,
                    CHILD_OOM_SCORE_ADJ.as_ptr().cast(),
                    CHILD_OOM_SCORE_ADJ.len(),
                );
                libc::close(fd);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use uuid::Uuid;

    use super::*;
    use crate::config::Config;
    use crate::dto::admin::CronJobRunOut;
    use crate::error::AppError;
    use crate::service::job_service::JobService;
    use crate::worker::{JobQueue, JobRegistry, RunObserver, WorkerRunner};

    const PUBLISHED: &str = r#"{"outcome":"published","generation":"20261116T033000Z","places":326729,"dropped":12,"extractMd5":"abc","durationSecs":754,"profile":"all"}"#;
    const UNCHANGED: &str = r#"{"outcome":"unchanged","generation":"20261109T033000Z","places":326000,"extractMd5":"abc","durationSecs":2,"profile":"all"}"#;
    const FAILED: &str =
        r#"{"outcome":"failed","durationSecs":5,"profile":"all","reason":"MD5 mismatch"}"#;

    /// Remembers every progress detail a job reports.
    #[derive(Default)]
    struct Details(Mutex<Vec<Value>>);

    #[async_trait]
    impl RunObserver for Details {
        async fn started(&self, _: Uuid, _: &str, _: u32) {}
        async fn progressed(&self, _: Uuid, detail: &Value) {
            self.0.lock().unwrap().push(detail.clone());
        }
        async fn finished(&self, _: Uuid, _: &str, _: &crate::worker::RunOutcome) {}
    }

    fn sh(script: &str, timeout: Duration) -> PlacesBuild {
        PlacesBuild::with_command("sh", &["-c", script], timeout)
    }

    /// Runs `job`, returning its result and the last detail it reported.
    async fn run(job: &PlacesBuild) -> (anyhow::Result<()>, Option<Value>) {
        let details = Arc::new(Details::default());
        let ctx = JobContext::for_test(details.clone());
        let result = job.perform(&ctx, ()).await;
        let last = details.0.lock().unwrap().last().cloned();
        (result, last)
    }

    #[tokio::test]
    async fn a_published_build_reports_its_summary_as_the_run_detail() {
        let job = sh(
            &format!("echo starting >&2; echo '{PUBLISHED}'"),
            Duration::from_secs(30),
        );
        let (result, detail) = run(&job).await;
        result.unwrap();
        let detail = detail.unwrap();
        assert_eq!(detail["phase"], "done");
        assert_eq!(detail["outcome"], "published");
        assert_eq!(detail["generation"], "20261116T033000Z");
        assert_eq!(detail["places"], 326_729);
        assert_eq!(detail["dropped"], 12);
        assert_eq!(detail["extractMd5"], "abc");
        assert_eq!(detail["durationSecs"], 754);
        assert_eq!(detail["profile"], "all");
        assert_eq!(
            detail["message"],
            "published generation 20261116T033000Z (326729 places)"
        );
        assert!(detail.get("reason").is_none(), "nothing invented");
    }

    #[tokio::test]
    async fn an_unchanged_extract_is_a_success_without_a_dropped_count() {
        let job = sh(&format!("echo '{UNCHANGED}'"), Duration::from_secs(30));
        let (result, detail) = run(&job).await;
        result.unwrap();
        let detail = detail.unwrap();
        assert_eq!(detail["outcome"], "unchanged");
        assert_eq!(detail["extractMd5"], "abc");
        assert!(detail.get("dropped").is_none());
    }

    #[tokio::test]
    async fn a_failed_build_fails_the_run_with_the_childs_reason() {
        let job = sh(&format!("echo '{FAILED}'; exit 1"), Duration::from_secs(30));
        let (result, detail) = run(&job).await;
        assert_eq!(result.unwrap_err().to_string(), "MD5 mismatch");
        let detail = detail.unwrap();
        assert_eq!(detail["outcome"], "failed");
        assert_eq!(detail["reason"], "MD5 mismatch");
    }

    #[tokio::test]
    async fn a_child_that_dies_without_a_summary_is_a_failure_with_its_log_tail() {
        let job = sh("echo 'disk full' >&2; exit 3", Duration::from_secs(30));
        let (result, detail) = run(&job).await;
        let error = result.unwrap_err().to_string();
        assert!(error.contains("exit status: 3"), "{error}");
        assert!(error.contains("disk full"), "{error}");
        assert_eq!(detail.unwrap()["outcome"], "failed");
    }

    #[tokio::test]
    async fn exit_zero_without_a_valid_summary_is_a_failure() {
        for script in ["true", "echo not json", "echo '{\"outcome\":\"exploded\"}'"] {
            let (result, detail) = run(&sh(script, Duration::from_secs(30))).await;
            let error = result.unwrap_err().to_string();
            assert!(
                error.contains("without a summary line"),
                "{script}: {error}"
            );
            assert_eq!(detail.unwrap()["outcome"], "failed");
        }
    }

    #[tokio::test]
    async fn a_summary_that_contradicts_the_exit_status_is_a_failure() {
        let job = sh(
            &format!("echo '{PUBLISHED}'; exit 1"),
            Duration::from_secs(30),
        );
        let (result, _) = run(&job).await;
        let error = result.unwrap_err().to_string();
        assert!(error.contains("reported published"), "{error}");
    }

    #[tokio::test]
    async fn a_build_over_its_time_is_stopped_and_fails() {
        let job = sh("sleep 60", Duration::from_millis(200));
        let started = Instant::now();
        let (result, detail) = run(&job).await;
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "the child was killed"
        );
        assert!(result.unwrap_err().to_string().contains("was stopped"));
        assert_eq!(detail.unwrap()["outcome"], "failed");
        assert!(
            !job.running.load(Ordering::Acquire),
            "the guard is released after a timeout"
        );
    }

    #[tokio::test]
    async fn cancelling_the_run_kills_the_child() {
        let job = sh("sleep 60", Duration::from_secs(300));
        let ctx = JobContext::for_test(Arc::new(Details::default()));
        let cancel = ctx.cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            cancel.cancel();
        });
        let started = Instant::now();
        let error = job.perform(&ctx, ()).await.unwrap_err();
        assert_eq!(error.to_string(), "stopped");
        assert!(started.elapsed() < Duration::from_secs(20));
    }

    #[tokio::test]
    async fn a_second_build_is_refused_while_one_runs_and_allowed_after() {
        let job = Arc::new(sh(
            &format!("sleep 1; echo '{UNCHANGED}'"),
            Duration::from_secs(30),
        ));
        let first = {
            let job = job.clone();
            tokio::spawn(async move { run(&job).await.0 })
        };
        while !job.running.load(Ordering::Acquire) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let refused = run(&job).await.0.unwrap_err().to_string();
        assert!(refused.contains("already running"), "{refused}");
        first.await.unwrap().unwrap();
        run(&job).await.0.unwrap();
    }

    #[tokio::test]
    async fn a_missing_program_fails_cleanly() {
        let job = PlacesBuild::with_command("/nonexistent/datxevui", &[], Duration::from_secs(5));
        let error = run(&job).await.0.unwrap_err();
        assert!(format!("{error:#}").contains("starting the places-build child"));
        assert!(!job.running.load(Ordering::Acquire));
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn the_child_is_niced_and_the_oom_killers_first_pick() {
        let job = sh(
            r#"nice=$(cut -d' ' -f19 /proc/self/stat); oom=$(cat /proc/self/oom_score_adj); printf '{"outcome":"unchanged","durationSecs":0,"reason":"nice %s oom %s"}\n' "$nice" "$oom""#,
            Duration::from_secs(30),
        );
        let (_, detail) = run(&job).await;
        let reason = detail.unwrap()["reason"].as_str().unwrap().to_string();
        assert_eq!(reason, "nice 19 oom 1000");
    }

    /// The admin "run now" path end to end: the service queues the run, a
    /// worker runs the (fake) child, the run history shows its summary.
    async fn admin_service(script: &str) -> (Arc<JobService>, tokio_util::sync::CancellationToken) {
        let db = crate::store::migrated_test_db().await;
        let mut svc = JobService::new(
            Arc::new(crate::store::DbJobStore::new(db.clone())),
            Arc::new(Config::default()),
        );
        let queue = Arc::new(JobQueue::new(Arc::new(crate::store::DbJobQueueStore::new(
            db,
        ))));
        svc.attach_queue(queue.clone());
        let svc = Arc::new(svc);
        let mut registry = JobRegistry::new();
        registry.add(sh(script, Duration::from_secs(30)));
        let runner = WorkerRunner::new(queue, Arc::new(registry), svc.clone(), svc.run_cancels())
            .concurrency(2)
            .polling(Duration::from_millis(20), Duration::ZERO);
        let shutdown = runner.shutdown_handle();
        runner.spawn();
        (svc, shutdown)
    }

    /// The latest run of the job once it is no longer running.
    async fn settled_run(svc: &JobService, want: &str) -> CronJobRunOut {
        for _ in 0..500 {
            let runs = svc.list_runs(Some(PlacesBuild::KIND), None).await.unwrap();
            if let Some(run) = runs.items.into_iter().find(|r| r.status == want) {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("no run became {want}");
    }

    #[tokio::test]
    async fn run_now_queues_the_build_once_and_shows_its_summary() {
        let (svc, shutdown) = admin_service(&format!("sleep 1; echo '{PUBLISHED}'")).await;
        let queued = svc.trigger(PlacesBuild::KIND).await.unwrap();
        assert_eq!(queued.status, "queued");
        // A second click while it is queued or running is refused cleanly.
        assert!(matches!(
            svc.trigger(PlacesBuild::KIND).await.unwrap_err(),
            AppError::Conflict(_)
        ));

        let run = settled_run(&svc, "succeeded").await;
        assert_eq!(run.id, queued.id);
        assert!(run.error.is_none());
        let (started, finished) = (run.started_at.unwrap(), run.finished_at.unwrap());
        assert!(finished >= started);
        let detail = run.detail.unwrap();
        assert_eq!(detail["outcome"], "published");
        assert_eq!(detail["places"], 326_729);
        assert_eq!(detail["extractMd5"], "abc");

        // Finished: it can be run again.
        svc.trigger(PlacesBuild::KIND).await.unwrap();
        shutdown.cancel();
    }

    #[tokio::test]
    async fn a_failing_child_marks_the_run_failed_for_retry_with_the_reason() {
        let (svc, shutdown) = admin_service(&format!("echo '{FAILED}'; exit 1")).await;
        svc.trigger(PlacesBuild::KIND).await.unwrap();
        // The first attempt failed; the run waits for its retry, saying why.
        let run = loop {
            let runs = svc.list_runs(Some(PlacesBuild::KIND), None).await.unwrap();
            match runs.items.into_iter().next() {
                Some(run) if run.error.is_some() => break run,
                _ => tokio::time::sleep(Duration::from_millis(20)).await,
            }
        };
        assert!(run.error.unwrap().contains("MD5 mismatch"));
        assert_eq!(run.detail.unwrap()["outcome"], "failed");
        shutdown.cancel();
    }

    #[test]
    fn the_policy_leaves_the_child_time_to_be_stopped_first() {
        let job = PlacesBuild::default();
        let policy = job.policy();
        assert!(policy.timeout > job.timeout);
        assert_eq!(policy.max_attempts, 2);
        assert_eq!(job.args, ["places-build"]);
        assert!(
            job.program.is_none(),
            "the real job re-runs this executable"
        );
    }
}

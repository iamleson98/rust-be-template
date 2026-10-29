//! vps-service — datxevui's companion on a small VPS:
//!
//! - **place search**: an in-memory index of every named place in Vietnam
//!   (OpenStreetMap), answering the Worker's `/api/places/*` routes;
//! - **OSM indexer**: refreshes that index weekly from Geofabrik;
//! - **cron driver**: calls the Worker's job executor (`/api/jobs/tick`) on
//!   schedule — seat-hold sweep, campaign coupon expiry, trip warming.
//!
//! See `vps/README.md` for the deployment (systemd + Cloudflare Tunnel).

mod config;
mod http;
mod indexer;
mod metrics;
mod places;
mod scheduler;
mod state;
mod store;

use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use tokio::sync::watch;
use tracing::info;

use crate::config::Config;
use crate::indexer::Source;
use crate::places::{Engine, SearchOptions};
use crate::state::AppState;
use crate::store::Store;

#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the service: HTTP API, scheduled jobs, weekly index refresh.
    Serve {
        #[arg(long, default_value = "/etc/vps-service/config.toml")]
        config: PathBuf,
    },
    /// Build and publish a new index now, then exit.
    Index {
        #[arg(long, default_value = "/etc/vps-service/config.toml")]
        config: PathBuf,
        /// Rebuild even when the extract has not changed.
        #[arg(long)]
        force: bool,
        /// Use this `.osm.pbf` instead of downloading one.
        #[arg(long)]
        pbf: Option<PathBuf>,
    },
    /// Extract and prepare places from a PBF (what `index` runs in a child process).
    Extract {
        pbf: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        tmp_dir: PathBuf,
        #[arg(long, default_value = "all")]
        profile: String,
    },
    /// Search the published index from the terminal: one query per line on stdin.
    Query {
        #[arg(long, default_value = "/etc/vps-service/config.toml")]
        config: PathBuf,
        /// Search this records file instead of the published index.
        #[arg(long)]
        records: Option<PathBuf>,
    },
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=warn".into()),
        )
        .init();
    match Cli::parse().command {
        Command::Extract {
            pbf,
            out,
            tmp_dir,
            profile,
        } => extract(pbf, out, tmp_dir, &profile),
        Command::Query { config, records } => query(config, records),
        Command::Serve { config } => runtime()?.block_on(serve(config)),
        Command::Index { config, force, pbf } => {
            runtime()?.block_on(index_once(config, force, pbf))
        }
    }
}

fn runtime() -> Result<tokio::runtime::Runtime> {
    Ok(tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        // Searches run on blocking threads; a handful covers two cores.
        .max_blocking_threads(8)
        .build()?)
}

fn open(config: &Path) -> Result<Arc<AppState>> {
    let cfg = Config::load(config)?;
    let store = Store::open(&cfg.server.data_dir)?;
    Ok(Arc::new(AppState::new(cfg, store)?))
}

async fn serve(config: PathBuf) -> Result<()> {
    let state = open(&config)?;
    indexer::load_current(&state)?;

    let (stop, shutdown) = watch::channel(false);
    scheduler::spawn_all(state.clone(), shutdown.clone());
    {
        let state = state.clone();
        let mut shutdown = shutdown.clone();
        tokio::spawn(async move {
            loop {
                state.sampler.tick();
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(10)) => {}
                    _ = shutdown.changed() => return,
                }
            }
        });
    }

    let listener = tokio::net::TcpListener::bind(&state.config.server.listen)
        .await
        .with_context(|| format!("listen on {}", state.config.server.listen))?;
    info!("listening on {}", state.config.server.listen);
    axum::serve(listener, http::router(state))
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            info!("shutting down");
            let _ = stop.send(true);
        })
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("install SIGTERM handler");
    tokio::select! {
        _ = ctrl_c => {}
        _ = term.recv() => {}
    }
}

async fn index_once(config: PathBuf, force: bool, pbf: Option<PathBuf>) -> Result<()> {
    let state = open(&config)?;
    indexer::load_current(&state)?;
    let source = match pbf {
        Some(path) => Source::Local(path),
        None => Source::Remote { force },
    };
    indexer::run(state.clone(), source).await?;
    let report = state.index.lock().unwrap().last_run.clone();
    println!("{}", serde_json::to_string_pretty(&report)?);
    match report {
        Some(run) if run.outcome == "failed" => anyhow::bail!("index run failed: {}", run.detail),
        _ => Ok(()),
    }
}

fn extract(pbf: PathBuf, out: PathBuf, tmp_dir: PathBuf, profile: &str) -> Result<()> {
    indexer::extract_and_prepare(&pbf, &out, &tmp_dir, profile)
}

fn query(config: PathBuf, records: Option<PathBuf>) -> Result<()> {
    let started = Instant::now();
    let records = match records {
        Some(path) => store::read_records(&path)?,
        None => {
            let cfg: Config = toml::from_str(&std::fs::read_to_string(&config)?)?;
            let store = Store::open(&cfg.server.data_dir)?;
            let manifest = store.current()?.context("no published index")?;
            store.load_records(&manifest)?
        }
    };
    let engine = Engine::build(records, "query");
    eprintln!(
        "{} places indexed in {:.1}s; type a query per line",
        engine.len(),
        started.elapsed().as_secs_f64()
    );
    for line in std::io::stdin().lock().lines() {
        let q = line?;
        let t = Instant::now();
        let hits = engine.search(
            &q,
            &SearchOptions {
                limit: 8,
                near: None,
            },
        );
        println!("== {q}  ({:.2} ms)", t.elapsed().as_secs_f64() * 1000.0);
        for h in hits {
            println!(
                "  {:6.2}  {}  [{}]  {}",
                h.score,
                h.name,
                h.kind,
                [h.ward, h.district, h.province]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }
    Ok(())
}

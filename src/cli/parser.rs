//! CLI argument parsing — declarative via `clap` derive macros.

use clap::{Parser, Subcommand};
use std::path::PathBuf;

/// 12-factor Rust backend.
///
/// A layered store + RBAC + JWT + WebSocket backend with pluggable cache,
/// storage, worker, and database backends. Run with no args to start
/// the server; see `--help` for the full command list.
///
/// Database migration commands have been moved to the standalone `migrator`
/// binary. Build it with: `cargo build -p migrator --release`
#[derive(Debug, Parser)]
#[command(name = "backend", version, about, long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,

    /// Override the config file path (default: reads `.env`).
    #[arg(long, global = true, env = "CONFIG_FILE")]
    pub config: Option<PathBuf>,

    /// Increase verbosity (-v = warn, -vv = info, -vvv = debug).
    #[arg(short, long, global = true, action = clap::ArgAction::Count)]
    pub verbose: u8,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Start the HTTP server. Applies pending migrations on startup
    /// unless `--no-migrate` is passed.
    #[command(alias = "s", alias = "run")]
    Serve {
        /// Skip the auto-migration step.
        #[arg(long)]
        no_migrate: bool,

        /// Override the bind address (e.g. `127.0.0.1:9000`).
        #[arg(long, env = "BIND_ADDR")]
        bind: Option<String>,
    },

    /// Print all registered routes. Useful for verifying router wiring
    /// without running the server.
    RoutesList,

    /// Print the resolved configuration (secrets masked).
    ConfigShow,

    /// Generate secrets and hashes.
    Key {
        #[command(subcommand)]
        action: KeyAction,
    },

    /// Print the database backend/engine this build links (always the
    /// vendored SQLite from the `begin-concurrent` branch).
    DbBackend,

    /// Backfill-upload stored ad conversions to the Google Ads API
    /// (rows recorded while credentials were off, plus failed rows).
    /// Usage: `ads-sweep [--limit <n>]`
    AdsSweep {
        /// Max rows to process in this batch (default: 200).
        #[arg(long, default_value_t = 200)]
        limit: u64,
    },

    /// Give legacy bus layouts a real seat plan by laying a matching
    /// catalog template over their existing seats (ids and labels are
    /// kept). Dry run unless `--apply` is passed.
    /// Usage: `layouts-normalize [--apply]`
    LayoutsNormalize {
        /// Write the changes (default: only print what would change).
        #[arg(long)]
        apply: bool,
    },

    /// Collapse per-brand bus-layout copies onto the global canonical
    /// catalog: re-points schedules (layout + vehicle class) and deletes
    /// the redundant per-brand rows. Run while the backend is quiet.
    /// Usage: `layouts-canonicalize [--apply] [--reset-trips]`
    LayoutsCanonicalize {
        /// Write the changes (default: only print what would change).
        #[arg(long)]
        apply: bool,
        /// Also drop the trip sessions of re-pointed schedules so seat
        /// maps regenerate from the canonical layout. Safe only while
        /// those trips carry no bookings.
        #[arg(long)]
        reset_trips: bool,
    },

    /// Build a fresh place-index generation from the Geofabrik Vietnam
    /// extract and publish it under `PLACES_DIR` (skips the work when the
    /// extract is unchanged, unless `--force`). The server runs this weekly
    /// as its `places.build` job; by hand it is a diagnostic. Log lines go
    /// to stderr, the last stdout line is a JSON summary, a failure exits 1.
    PlacesBuild {
        /// Rebuild even when the extract's MD5 matches the live generation.
        #[arg(long)]
        force: bool,
    },

    /// Import a Cloudflare D1 export (a staging SQLite file made from
    /// `wrangler d1 export`) into a freshly migrated app database.
    /// Usage: `import-d1 --stage <stage.db> --out <app.db> --report <report.json>`
    ImportD1 {
        /// The staging database built from the D1 export.
        #[arg(long)]
        stage: PathBuf,
        /// The app database to create (migrated first, then filled).
        #[arg(long)]
        out: PathBuf,
        /// Where to write the JSON import report.
        #[arg(long)]
        report: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
pub enum KeyAction {
    /// Generate a fresh 32-byte JWT secret (hex-encoded).
    Generate {
        /// Number of bytes (default: 32 = 256 bits for HS256).
        #[arg(long, default_value_t = 32)]
        bytes: u32,
    },
    /// Hash a password with argon2 (prints the hash to stdout).
    Hash { password: String },
}

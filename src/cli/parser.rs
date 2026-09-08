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
    /// rust-sql engine — rustqlite via the sqlx-sqlite C-ABI compat).
    DbBackend,

    /// Build the Tantivy place-search index from an OSM PBF file.
    /// Usage: `import-osm <path-to-vietnam.osm.pbf> [--index-dir <dir>]`
    ImportOsm {
        /// Path to the `.osm.pbf` file (e.g. `vietnam-latest.osm.pbf`).
        pbf_path: PathBuf,
        /// Output index directory (default: `SEARCH__INDEX_DIR` or `./place-index`).
        #[arg(long, env = "SEARCH__INDEX_DIR")]
        index_dir: Option<PathBuf>,
        /// Max heap bytes for the indexer (default: 1 GiB).
        #[arg(long, default_value_t = 1_073_741_824u64)]
        heap_bytes: u64,
        /// Number of indexer threads (default: all CPUs).
        #[arg(long)]
        threads: Option<usize>,
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

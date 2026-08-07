//! CLI argument parsing — declarative via `clap` derive macros.

use clap::{Parser, Subcommand};
use std::path::PathBuf;

/// 12-factor Rust backend.
///
/// A layered store + RBAC + JWT + WebSocket backend with pluggable cache,
/// storage, worker, and database backends. Run with no args to start
/// the server; see `--help` for the full command list.
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

    /// Manage database migrations.
    Migrate {
        #[command(subcommand)]
        action: MigrateAction,
    },

    /// Scaffold a new migration file under `src/migration/`.
    MigrationNew {
        /// Snake_case name for the migration (e.g. `add_users_table`).
        name: String,
    },

    /// Generate SeaORM entities from the live database schema.
    ///
    /// Requires `sea-orm-cli` installed (`cargo install sea-orm-cli`).
    /// Reads `DATABASE_URL` from the environment.
    EntityGenerate {
        /// Output directory (default: `src/entity`).
        #[arg(long, default_value = "src/entity")]
        output: PathBuf,

        /// Also generate relation code (default: true).
        #[arg(long, default_value_t = true)]
        with_relations: bool,
    },

    /// Database utilities.
    Db {
        #[command(subcommand)]
        action: DbAction,
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

    /// Print the database backend that the build supports
    /// (`sqlite` or `postgres`), based on which cargo feature is enabled.
    DbBackend,
}

#[derive(Debug, Subcommand)]
pub enum MigrateAction {
    /// Apply all pending migrations.
    Up,
    /// Revert the last N migrations (default 1).
    Down {
        #[arg(default_value_t = 1)]
        steps: u32,
    },
    /// List applied + pending migrations.
    List,
    /// Drop all tables and re-apply all migrations from scratch.
    /// Destructive — confirm with `--yes`.
    Fresh {
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum DbAction {
    /// Open an interactive database shell (`psql` for Postgres, `sqlite3`
    /// for SQLite). Requires the corresponding CLI on your PATH.
    Shell,
    /// Reset the database: drop all tables, re-apply migrations.
    /// Destructive — confirm with `--yes`.
    Reset {
        #[arg(long)]
        yes: bool,
    },
    /// Print the DATABASE_URL (useful for scripts).
    Url,
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

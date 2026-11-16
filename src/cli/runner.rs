//! Dispatches parsed CLI commands to handler functions.

use clap::Parser;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use super::commands;
use super::parser::{Cli, Command};

/// Entry point for the CLI. Parses args, sets up logging, dispatches.
pub async fn run() -> anyhow::Result<()> {
    // Load .env into process env BEFORE clap parses, so that `#[arg(env = ...)]`
    // attributes (e.g. BIND_ADDR) can pick up values from the file.
    let _ = dotenvy::dotenv();

    let cli = Cli::parse();

    let command = cli.command.unwrap_or(Command::Serve {
        no_migrate: false,
        bind: None,
    });
    // `places-build` keeps stdout for its one machine-readable summary line.
    init_tracing(cli.verbose, matches!(command, Command::PlacesBuild { .. }));

    match command {
        Command::Serve { no_migrate, bind } => commands::serve::run(no_migrate, bind).await,
        Command::RoutesList => commands::routes_list::run(),
        Command::ConfigShow => commands::config_show::run(),
        Command::Key { action } => commands::key::run(action),
        Command::DbBackend => {
            println!("{}", crate::cli::util::db_backend_name());
            Ok(())
        }
        Command::PlacesBuild { force } => crate::places::build::run(force).await,
        Command::ImportD1 { stage, out, report } => super::import_d1::run(stage, out, report).await,
        Command::AdsSweep { limit } => commands::ads_sweep::run(limit).await,
        Command::LayoutsNormalize { apply } => commands::layouts_normalize::run(apply).await,
        Command::LayoutsCanonicalize { apply, reset_trips } => {
            commands::layouts_canonicalize::run(apply, reset_trips).await
        }
    }
}

fn init_tracing(verbose: u8, to_stderr: bool) {
    let default_directive = match verbose {
        0 => "info,backend=info,tower_http=warn,sea_orm_migration=warn",
        1 => "info,backend=debug,tower_http=info,sea_orm_migration=info",
        2 => "debug,backend=trace,tower_http=debug,sea_orm_migration=debug",
        _ => "trace",
    };
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_directive));
    // `try_init` returns Err if a subscriber is already installed; that's
    // fine, we just keep using the existing one.
    let layer = fmt::layer().with_target(true);
    let _ = if to_stderr {
        tracing_subscriber::registry()
            .with(layer.with_writer(std::io::stderr))
            .with(filter)
            .try_init()
    } else {
        tracing_subscriber::registry()
            .with(layer)
            .with(filter)
            .try_init()
    };
}

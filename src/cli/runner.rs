//! Dispatches parsed CLI commands to handler functions.

use clap::Parser;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use super::commands;
use super::parser::{Cli, Command};

/// Entry point for the CLI. Parses args, sets up logging, dispatches.
pub async fn run() -> anyhow::Result<()> {
    let cli = Cli::parse();

    init_tracing(cli.verbose);

    let command = cli.command.unwrap_or(Command::Serve {
        no_migrate: false,
        bind: None,
    });

    match command {
        Command::Serve { no_migrate, bind } => commands::serve::run(no_migrate, bind).await,
        Command::RoutesList => commands::routes_list::run(),
        Command::ConfigShow => commands::config_show::run(),
        Command::Key { action } => commands::key::run(action),
        Command::DbBackend => {
            println!("{}", crate::cli::util::db_backend_name());
            Ok(())
        }
        Command::ImportOsm {
            pbf_path,
            index_dir,
            heap_bytes,
            threads,
        } => commands::import_osm::run(pbf_path, index_dir, heap_bytes, threads).await,
    }
}

fn init_tracing(verbose: u8) {
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
    let _ = tracing_subscriber::registry()
        .with(fmt::layer().with_target(true))
        .with(filter)
        .try_init();
}

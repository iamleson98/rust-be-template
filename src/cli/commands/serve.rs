//! `backend serve` — start the HTTP server.

use anyhow::Context;

use crate::cli::util::db_connect;
use crate::config::Config;
use crate::server;

pub async fn run(no_migrate: bool, bind: Option<String>) -> anyhow::Result<()> {
    if !no_migrate {
        let cfg = Config::load().context("loading config")?;
        let db = db_connect(&cfg).await?;
        run_migrations(&db).await?;
    }

    let state = server::bootstrap().await?;

    if let Some(addr) = bind {
        // Override the bind address at runtime. We have to rebuild state
        // because config is loaded once at bootstrap; for now, just print
        // a warning if the override differs from the configured one.
        tracing::warn!(
            "ignoring --bind {addr} — restart with BIND_ADDR env var or update .env"
        );
    }

    server::run(state).await
}

async fn run_migrations(db: &sea_orm::DatabaseConnection) -> anyhow::Result<()> {
    use sea_orm_migration::MigratorTrait;
    crate::Migrator::up(db, None).await?;
    Ok(())
}

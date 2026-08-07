//! `backend serve` — start the HTTP server.

use crate::server;

pub async fn run(no_migrate: bool, bind: Option<String>) -> anyhow::Result<()> {
    let state = server::bootstrap().await?;

    if !no_migrate {
        run_migrations(state.db.as_ref()).await?;
    }

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
    crate::migration::Migrator::up(db, None).await?;
    Ok(())
}

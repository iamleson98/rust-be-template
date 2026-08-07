//! `backend migrate up|down|list|fresh` — manage migrations.

use anyhow::Context;
use sea_orm_migration::MigratorTrait;

use crate::cli::util::db_connect;
use crate::config::Config;
use crate::migration::Migrator;

use crate::cli::parser::MigrateAction;

pub async fn run(action: MigrateAction) -> anyhow::Result<()> {
    let cfg = Config::load().context("loading config")?;
    let db = db_connect(&cfg).await?;

    match action {
        MigrateAction::Up => {
            println!("applying pending migrations…");
            Migrator::up(&db, None).await?;
            println!("✓ migrations up to date");
        }
        MigrateAction::Down { steps } => {
            println!("reverting last {steps} migration(s)…");
            Migrator::down(&db, Some(steps)).await?;
            println!("✓ reverted {steps} migration(s)");
        }
        MigrateAction::List => {
            list_migrations(&db).await?;
        }
        MigrateAction::Fresh { yes } => {
            if !yes {
                print!("This will DROP all tables and re-apply migrations. Continue? [y/N] ");
                use std::io::{self, Write};
                std::io::stdout().flush()?;
                let mut input = String::new();
                io::stdin().read_line(&mut input)?;
                if !input.trim().eq_ignore_ascii_case("y") {
                    println!("aborted");
                    return Ok(());
                }
            }
            println!("reverting all migrations…");
            // Revert all migrations in reverse order (passes `None` to
            // revert every applied migration). Then re-apply from scratch.
            // We use `down(None)` + `up(None)` instead of `fresh()` because
            // `fresh()` uses `DROP TABLE ... CASCADE` which SQLite doesn't
            // support cleanly and produces misleading errors.
            Migrator::down(&db, None).await?;
            println!("reapplying all migrations…");
            Migrator::up(&db, None).await?;
            println!("✓ database refreshed");
        }
    }

    Ok(())
}

async fn list_migrations(db: &sea_orm::DatabaseConnection) -> anyhow::Result<()> {
    use sea_orm_migration::MigrationStatus;

    let migrations = Migrator::get_migration_with_status(db).await?;
    if migrations.is_empty() {
        println!("(no migrations recorded)");
        return Ok(());
    }

    println!("{:<50} {:<10}", "Name", "Status");
    println!("{}", "-".repeat(70));
    for m in migrations {
        let version = m.name().to_string();
        let status = match m.status() {
            MigrationStatus::Applied => "applied",
            MigrationStatus::Pending => "pending",
        };
        println!("{:<50} {:<10}", version, status);
    }
    Ok(())
}

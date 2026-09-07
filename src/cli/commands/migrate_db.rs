//! `backend migrate-db` — one-shot legacy C-SQLite → rustqlite migration.
//!
//! Normally automatic at startup; exposed as a command for deploy scripts
//! and verification (`backend migrate-db --url sqlite:app.db?mode=rwc`).

use crate::config::Config;

pub async fn run(url: Option<String>) -> anyhow::Result<()> {
    let url = match url {
        Some(u) => u,
        None => Config::load()?.database.url,
    };

    #[cfg(feature = "sqlite")]
    let result = {
        use crate::db::sqlite_migrate::{maybe_migrate_sqlite_database, Outcome};
        match maybe_migrate_sqlite_database(&url).await? {
            Outcome::NotNeeded => {
                println!("nothing to migrate — {url:?} is not a legacy C-SQLite file");
            }
            Outcome::Migrated {
                tables,
                rows,
                backup,
            } => {
                println!(
                    "migrated {tables} tables / {rows} rows to the rustqlite engine\n\
                     original kept as {}",
                    backup.display()
                );
            }
        }
        Ok(())
    };

    #[cfg(not(feature = "sqlite"))]
    let result = {
        let _ = url;
        println!("the sqlite backend is not compiled into this build; nothing to migrate");
        Ok(())
    };

    result
}

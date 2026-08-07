//! `backend db shell|reset|url` — database utilities.

use anyhow::Context;
use std::process::Command;

use sea_orm_migration::MigratorTrait;

use crate::cli::util::db_connect;
use crate::config::Config;

use crate::cli::parser::DbAction;

pub async fn run(action: DbAction) -> anyhow::Result<()> {
    let cfg = Config::load().context("loading config")?;

    match action {
        DbAction::Shell => open_shell(&cfg.database.url),
        DbAction::Reset { yes } => reset_db(&cfg, yes).await,
        DbAction::Url => {
            println!("{}", cfg.database.url);
            Ok(())
        }
    }
}

fn open_shell(db_url: &str) -> anyhow::Result<()> {
    if db_url.starts_with("postgres://") || db_url.starts_with("postgresql://") {
        // Extract host/port/db from the URL using url::Url.
        let parsed = url::Url::parse(db_url).context("parsing DATABASE_URL")?;
        let host = parsed.host_str().unwrap_or("localhost");
        let port = parsed.port().unwrap_or(5432);
        let db = parsed.path().trim_start_matches('/');
        let user = parsed.username();
        let password = parsed.password().unwrap_or("");

        let mut cmd = Command::new("psql");
        cmd.arg("-h").arg(host);
        cmd.arg("-p").arg(port.to_string());
        cmd.arg("-U").arg(user);
        cmd.arg("-d").arg(db);

        // Pass password via PGPASSWORD env (avoid ~/.pgpass dance).
        if !password.is_empty() {
            cmd.env("PGPASSWORD", password);
        }

        println!("→ opening psql shell at {host}:{port}/{db} as {user}");
        let status = cmd.status().context("running psql — is it installed?")?;
        if !status.success() {
            anyhow::bail!("psql exited with status {status}");
        }
        Ok(())
    } else if let Some(path) = db_url.strip_prefix("sqlite://") {
        // Strip the `?mode=rwc` query string.
        let path = path.split('?').next().unwrap_or(path);
        let path = path.trim_start_matches("./");
        println!("→ opening sqlite3 shell at {path}");
        let status = Command::new("sqlite3")
            .arg(path)
            .status()
            .context("running sqlite3 — is it installed?")?;
        if !status.success() {
            anyhow::bail!("sqlite3 exited with status {status}");
        }
        Ok(())
    } else {
        anyhow::bail!("unsupported DATABASE_URL scheme: {db_url}")
    }
}

async fn reset_db(cfg: &Config, yes: bool) -> anyhow::Result<()> {
    if !yes {
        print!(
            "This will DROP all tables in {} and re-apply migrations. Continue? [y/N] ",
            cfg.database.url
        );
        use std::io::{self, Write};
        std::io::stdout().flush()?;
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        if !input.trim().eq_ignore_ascii_case("y") {
            println!("aborted");
            return Ok(());
        }
    }

    let db = db_connect(cfg).await?;
    println!("reverting all migrations…");
    // Use `down(None)` + `up(None)` instead of `fresh()` because
    // `fresh()` uses `DROP TABLE ... CASCADE` which SQLite doesn't
    // support cleanly and produces misleading errors.
    crate::migration::Migrator::down(&db, None).await?;
    println!("reapplying all migrations…");
    crate::migration::Migrator::up(&db, None).await?;
    println!("✓ database reset");
    Ok(())
}

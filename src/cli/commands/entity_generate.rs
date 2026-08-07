//! `backend entity generate` — generate SeaORM entities from the live DB.
//!
//! Shells out to `sea-orm-cli generate entity` (must be installed).
//! Reads `DATABASE_URL` from the environment and forwards it.

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context};

pub async fn run(output: &Path, with_relations: bool) -> anyhow::Result<()> {
    // Check that sea-orm-cli is installed.
    let which = which::which("sea-orm-cli");
    if which.is_err() {
        bail!(
            "`sea-orm-cli` not found on PATH.\n\
             Install it with:  cargo install sea-orm-cli\n\
             Then re-run:     backend entity generate"
        );
    }

    // Read DATABASE_URL from env (already loaded by Config::load if you
    // want — here we just read it directly to keep this command standalone).
    let _ = dotenvy::dotenv();
    let db_url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL not set — put it in .env or export it")?;

    // Detect backend from the URL scheme.
    let backend = if db_url.starts_with("postgres://") || db_url.starts_with("postgresql://") {
        "postgres"
    } else if db_url.starts_with("sqlite://") {
        "sqlite"
    } else {
        bail!(
            "unsupported DATABASE_URL scheme: {db_url}\n\
             must start with `postgres://`, `postgresql://`, or `sqlite://`"
        )
    };

    println!("→ sea-orm-cli generate entity (backend: {backend})");
    println!("  output: {}", output.display());
    println!("  database: {db_url}");

    let mut cmd = Command::new("sea-orm-cli");
    cmd.arg("generate").arg("entity");
    cmd.arg("--output-dir").arg(output);
    cmd.arg("--database-url").arg(&db_url);
    if with_relations {
        cmd.arg("--with-relations");
    }
    cmd.arg("--date-time-utc"); // Use DateTime<Utc> for timestamps

    let status = cmd
        .status()
        .context("spawning sea-orm-cli — is it installed and on PATH?")?;
    if !status.success() {
        bail!("sea-orm-cli exited with status {status}");
    }

    println!("✓ entities generated to {}", output.display());
    println!();
    println!("next steps:");
    println!("  1. Review the generated files under {}", output.display());
    println!("  2. If a migration was also added, run:  backend migrate up");
    Ok(())
}

// Lightweight `which` implementation to avoid pulling in another crate.
mod which {
    use std::path::PathBuf;

    pub fn which(name: &str) -> Result<PathBuf, ()> {
        let path = std::env::var_os("PATH").ok_or(())?;
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        Err(())
    }
}

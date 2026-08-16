//! Standalone database migration CLI.
//!
//! Independent of the main backend crate so it always compiles and runs,
//! even when the backend has errors. Build once and keep the binary in
//! `bin/` (gitignored):
//!
//! ```sh
//! cargo build -p migrator --release
//! cp target/release/migrator bin/
//! bin/migrator up
//! ```

use anyhow::Context;
use clap::{Parser, Subcommand};
use migrator::Migrator;
use sea_orm_migration::MigratorTrait;
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "migrator", version, about = "Database migration tool")]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// Override the config file path (default: reads `.env`).
    #[arg(long, global = true, env = "CONFIG_FILE")]
    config: Option<PathBuf>,

    /// Increase verbosity (-v = info, -vv = debug, -vvv = trace).
    #[arg(short, long, global = true, action = clap::ArgAction::Count)]
    verbose: u8,
}

#[derive(Debug, Subcommand)]
enum Command {
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

    /// Scaffold a new migration file under `migrator/src/`.
    New {
        /// Snake_case name for the migration (e.g. `add_users_table`).
        name: String,
    },

    /// Generate SeaORM entities from the live database schema.
    ///
    /// Requires `sea-orm-cli` installed (`cargo install sea-orm-cli`).
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
}

#[derive(Debug, Subcommand)]
enum DbAction {
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    init_tracing(cli.verbose);

    match cli.command {
        Command::Up => run_up().await,
        Command::Down { steps } => run_down(steps).await,
        Command::List => run_list().await,
        Command::Fresh { yes } => run_fresh(yes).await,
        Command::New { name } => run_new(&name),
        Command::EntityGenerate {
            output,
            with_relations,
        } => run_entity_generate(&output, with_relations).await,
        Command::Db { action } => match action {
            DbAction::Shell => run_db_shell().await,
            DbAction::Reset { yes } => run_db_reset(yes).await,
            DbAction::Url => run_db_url().await,
        },
    }
}

// ---------------------------------------------------------------------------
// Config helpers — minimal subset of the main crate's Config, just enough
// to read DATABASE_URL. This avoids depending on the full config module.
// ---------------------------------------------------------------------------

fn load_db_url() -> anyhow::Result<String> {
    // Load .env if present (same as the main crate).
    let _ = dotenvy::dotenv();

    // Try DATABASE_URL env var first.
    if let Ok(url) = std::env::var("DATABASE_URL") {
        return Ok(url);
    }

    // Default for SQLite.
    Ok("sqlite://./app.db?mode=rwc".into())
}

async fn db_connect(db_url: &str) -> anyhow::Result<sea_orm::DatabaseConnection> {
    let mut opts = sea_orm::ConnectOptions::new(db_url);
    opts.max_connections(5)
        .min_connections(1)
        .connect_timeout(std::time::Duration::from_secs(10))
        .sqlx_logging(false);
    let db = sea_orm::Database::connect(opts)
        .await
        .context("connecting to database")?;
    Ok(db)
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

async fn run_up() -> anyhow::Result<()> {
    let db_url = load_db_url()?;
    let db = db_connect(&db_url).await?;
    println!("applying pending migrations…");
    Migrator::up(&db, None).await?;
    println!("✓ migrations up to date");
    Ok(())
}

async fn run_down(steps: u32) -> anyhow::Result<()> {
    let db_url = load_db_url()?;
    let db = db_connect(&db_url).await?;
    println!("reverting last {steps} migration(s)…");
    Migrator::down(&db, Some(steps)).await?;
    println!("✓ reverted {steps} migration(s)");
    Ok(())
}

async fn run_list() -> anyhow::Result<()> {
    let db_url = load_db_url()?;
    let db = db_connect(&db_url).await?;
    list_migrations(&db).await
}

async fn run_fresh(yes: bool) -> anyhow::Result<()> {
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

    let db_url = load_db_url()?;

    // For SQLite: delete the database file and re-apply from scratch.
    if db_url.starts_with("sqlite://") {
        let path = db_url
            .strip_prefix("sqlite://")
            .unwrap_or("")
            .split('?')
            .next()
            .unwrap_or("")
            .trim_start_matches("./");

        if !path.is_empty() && std::path::Path::new(path).exists() {
            std::fs::remove_file(path)
                .context(format!("deleting database file {path}"))?;
            println!("removed {path}");
        }
    } else {
        // For non-SQLite backends, fall back to down() + up().
        let db = db_connect(&db_url).await?;
        println!("reverting all migrations…");
        Migrator::down(&db, None).await?;
    }

    println!("reapplying all migrations…");
    let db = db_connect(&db_url).await?;
    Migrator::up(&db, None).await?;
    println!("✓ database refreshed");
    Ok(())
}

fn run_new(name: &str) -> anyhow::Result<()> {
    use chrono::Utc;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let module_name = format!("m{timestamp}_{name}");
    let pascal_name = to_pascal(name);

    let file_path = format!("migrator/src/{module_name}.rs");
    let content = format!(
        r#"use sea_orm_migration::{{prelude::*, schema::*}};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {{
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {{
        // TODO: create_table / alter_table here.
        Ok(())
    }}

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {{
        // TODO: reverse of `up`.
        Ok(())
    }}
}}

#[derive(DeriveIden)]
enum {pascal_name} {{
    Table,
    Id,
}}
"#
    );

    std::fs::write(&file_path, content)
        .context(format!("writing {file_path}"))?;
    println!("created {file_path}");

    // Remind the user to register the migration.
    println!();
    println!("⚠  Don't forget to register the migration in migrator/src/migration.rs:");
    println!("   1. Add: mod {module_name};");
    println!("   2. Add: Box::new({module_name}::Migration),");

    Ok(())
}

async fn run_entity_generate(output: &std::path::Path, with_relations: bool) -> anyhow::Result<()> {
    use std::process::Command;

    ensure_sea_orm_cli_available()?;

    let db_url = load_db_url()?;

    let backend = if db_url.starts_with("postgres://") || db_url.starts_with("postgresql://") {
        "postgres"
    } else if db_url.starts_with("sqlite://") {
        "sqlite"
    } else {
        anyhow::bail!("unsupported DATABASE_URL scheme: {db_url}")
    };

    println!("→ sea-orm-cli generate entity (backend: {backend})");
    println!("  output: {}", output.display());
    println!("  database: {db_url}");

    let mut cmd = Command::new("sea-orm-cli");
    cmd.arg("generate")
        .arg("entity")
        .arg("--output-dir")
        .arg(output)
        .arg("--database-url")
        .arg(&db_url)
        .arg("--with-serde")
        .arg("both");
        // .arg("--model-extra-derives")
        // .arg("utoipa::ToSchema")
        // .arg("--column-extra-derives")
        // .arg("utoipa::ToSchema");

    if !with_relations {
        println!(
            "note: `--with-relations=false` is ignored with sea-orm-cli v2; relations are generated by default"
        );
    }

    let status = cmd
        .status()
        .context("spawning sea-orm-cli — is it installed and on PATH?")?;
    if !status.success() {
        anyhow::bail!("sea-orm-cli exited with status {status}");
    }

    println!("✓ entities generated to {}", output.display());
    Ok(())
}

async fn run_db_shell() -> anyhow::Result<()> {
    let db_url = load_db_url()?;
    open_shell(&db_url)
}

async fn run_db_reset(yes: bool) -> anyhow::Result<()> {
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

    let db_url = load_db_url()?;

    // For SQLite: delete the database file and re-apply from scratch.
    if db_url.starts_with("sqlite://") {
        let path = db_url
            .strip_prefix("sqlite://")
            .unwrap_or("")
            .split('?')
            .next()
            .unwrap_or("")
            .trim_start_matches("./");

        if !path.is_empty() && std::path::Path::new(path).exists() {
            std::fs::remove_file(path)
                .context(format!("deleting database file {path}"))?;
            println!("removed {path}");
        }
    } else {
        let db = db_connect(&db_url).await?;
        println!("reverting all migrations…");
        Migrator::down(&db, None).await?;
    }

    println!("reapplying all migrations…");
    let db = db_connect(&db_url).await?;
    Migrator::up(&db, None).await?;
    println!("✓ database reset");
    Ok(())
}

async fn run_db_url() -> anyhow::Result<()> {
    let db_url = load_db_url()?;
    println!("{db_url}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn open_shell(db_url: &str) -> anyhow::Result<()> {
    use std::process::Command;

    if db_url.starts_with("postgres://") || db_url.starts_with("postgresql://") {
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

fn ensure_sea_orm_cli_available() -> anyhow::Result<()> {
    use std::process::Command;

    let status = Command::new("sea-orm-cli")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .context("sea-orm-cli not found on PATH")?;

    if !status.success() {
        anyhow::bail!("sea-orm-cli --version failed; install with: cargo install sea-orm-cli");
    }
    Ok(())
}

/// Convert `snake_case` -> `PascalCase` (e.g. `add_users` -> `AddUsers`).
fn to_pascal(input: &str) -> String {
    input
        .split('_')
        .filter(|s| !s.is_empty())
        .map(|s| {
            let mut chars = s.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str().to_lowercase().as_str(),
                None => String::new(),
            }
        })
        .collect()
}

fn init_tracing(verbose: u8) {
    let default_directive = match verbose {
        0 => "warn,migrator=info,sea_orm_migration=warn",
        1 => "info,migrator=debug,sea_orm_migration=info",
        2 => "debug,migrator=trace,sea_orm_migration=debug",
        _ => "trace",
    };
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(default_directive));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .try_init();
}

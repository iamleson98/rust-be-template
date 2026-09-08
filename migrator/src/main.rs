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
//!
//! `sea-orm-cli` compatibility notes: when the Makefile fronts this binary
//! with `sea-orm-cli migrate …`, the CLI spawns `cargo run -- <sub>` and
//! forwards `-n <num>` for `up --num` / `down`, plus a `DATABASE_URL` env
//! var when `--database-url` was given. The subcommand flags below accept
//! exactly that forwarding shape.
//!
//! Entity generation is IN-PROCESS (sea-schema discovery + sea-orm-codegen
//! linked against the workspace-patched rust-sql engine). The standalone
//! `sea-orm-cli generate entity` binary links REAL SQLite and cannot read
//! the rust-sql on-disk format.

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
    /// Apply all pending migrations (or at most `-n`).
    Up {
        /// Apply at most N pending migrations. sea-orm-cli's
        /// `migrate up --num N` forwards this flag as `-n N`.
        #[arg(short = 'n', long = "num")]
        num: Option<u32>,
    },

    /// Revert the last N migrations (default 1). sea-orm-cli's
    /// `migrate down` always forwards `-n N`.
    Down {
        #[arg(short = 'n', long = "num", default_value_t = 1)]
        steps: u32,
    },

    /// List applied + pending migrations.
    List,

    /// Same as `list` — sea-orm-cli's `migrate status -d migrator`
    /// forwards this subcommand name, so the migrator must accept it.
    Status,

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
    /// Runs sea-schema discovery + sea-orm-codegen IN-PROCESS through the
    /// rust-sql engine (the standalone sea-orm-cli links real SQLite and
    /// cannot read rust-sql database files).
    EntityGenerate {
        /// Output directory (default: `src/entity`).
        #[arg(short = 'o', long = "output", default_value = "src/entity")]
        output: PathBuf,

        /// Override DATABASE_URL for this run.
        #[arg(short = 'u', long = "database-url")]
        database_url: Option<String>,
    },

    /// Database utilities.
    Db {
        #[command(subcommand)]
        action: DbAction,
    },
}

#[derive(Debug, Subcommand)]
enum DbAction {
    /// Reset the database: drop all tables, re-apply migrations.
    /// Destructive — confirm with `--yes`.
    Reset {
        #[arg(long)]
        yes: bool,
    },

    /// Print the DATABASE_URL (useful for scripts).
    Url,

    /// Run an ad-hoc SQL statement through the rust-sql engine and print
    /// the rows (schema-discovery debugging: PRAGMA table_info, …).
    Probe {
        /// SQL to execute, e.g. "PRAGMA table_info('user')".
        sql: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    init_tracing(cli.verbose);

    match cli.command {
        Command::Up { num } => run_up(num).await,
        Command::Down { steps } => run_down(steps).await,
        Command::List | Command::Status => run_list().await,
        Command::Fresh { yes } => run_fresh(yes).await,
        Command::New { name } => run_new(&name),
        Command::EntityGenerate {
            output,
            database_url,
        } => run_entity_generate(&output, database_url).await,
        Command::Db { action } => match action {
            DbAction::Reset { yes } => run_db_reset(yes).await,
            DbAction::Url => run_db_url().await,
            DbAction::Probe { sql } => run_db_probe(&sql).await,
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
    let url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => "sqlite://./app.db?mode=rwc".to_string(),
    };

    // Everything here registers as sea-orm's `sqlite://` driver (the
    // rust-sql engine). A stale or foreign DATABASE_URL (e.g. `file:…`)
    // would otherwise die deep inside sea-orm with "has no supporting
    // driver" — fail early with something actionable instead.
    if !url.starts_with("sqlite:") {
        anyhow::bail!(
            "unsupported DATABASE_URL '{url}': this project runs on the rust-sql \
             engine, which registers as the sqlite:// driver. Unset DATABASE_URL \
             (or point it at sqlite://./app.db?mode=rwc) and try again"
        );
    }

    Ok(url)
}

/// Extract the on-disk file path from a `sqlite:…` URL, if any
/// (memory databases have none). Accepts both `sqlite:app.db` and
/// `sqlite://./app.db` forms.
fn sqlite_file_path(db_url: &str) -> Option<String> {
    let rest = db_url
        .strip_prefix("sqlite://")
        .or_else(|| db_url.strip_prefix("sqlite:"))?;
    if rest.starts_with(":memory:") {
        return None;
    }
    let path = rest.split('?').next().unwrap_or("");
    let path = path.trim_start_matches("./");
    (!path.is_empty()).then(|| path.to_string())
}

/// Normalize any accepted sqlite URL form into one plain sqlx parses:
/// `sqlite:app.db?mode=rwc` / `sqlite://./app.db` →
/// `sqlite://./app.db?mode=rwc`. Defaults the mode to `rwc` for file
/// paths so a not-yet-created database is created rather than rejected.
fn normalize_sqlite_url(db_url: &str) -> anyhow::Result<String> {
    let rest = db_url
        .strip_prefix("sqlite://")
        .or_else(|| db_url.strip_prefix("sqlite:"))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "unsupported DATABASE_URL '{db_url}': only sqlite://… URLs are \
                 supported (the rust-sql engine registers as the sqlite driver)"
            )
        })?;

    // `sqlite::memory:` / `sqlite://:memory:` pass through untouched.
    if rest.starts_with(":memory:") {
        return Ok(format!("sqlite://{rest}"));
    }

    let (path, query) = match rest.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (rest.to_string(), String::new()),
    };

    let mut query = if query.is_empty() {
        "mode=rwc".to_string()
    } else {
        query
    };
    if !query.contains("mode=") {
        query.push_str("&mode=rwc");
    }

    Ok(format!("sqlite://{path}?{query}"))
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

async fn run_up(num: Option<u32>) -> anyhow::Result<()> {
    let db_url = load_db_url()?;
    let db = db_connect(&db_url).await?;
    match num {
        Some(n) => println!("applying at most {n} pending migration(s)…"),
        None => println!("applying pending migrations…"),
    }
    Migrator::up(&db, num).await?;
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
        // Non-interactive stdin (piped / no TTY — e.g. sea-orm-cli's
        // `migrate fresh` spawning `cargo run -- fresh`): asking would
        // BLOCK forever. Abort with the escape hatch instead.
        if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
            anyhow::bail!(
                "refusing to drop tables without confirmation: re-run with --yes (stdin is not a terminal)"
            );
        }
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

    // For SQLite (rust-sql): delete the database file and re-apply from
    // scratch. Handles both `sqlite://./app.db` and `sqlite:app.db` forms.
    if let Some(path) = sqlite_file_path(&db_url) {
        if std::path::Path::new(&path).exists() {
            std::fs::remove_file(&path).context(format!("deleting database file {path}"))?;
            println!("removed {path}");
        }
    } else {
        // For non-file backends, fall back to down() + up().
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

    std::fs::write(&file_path, content).context(format!("writing {file_path}"))?;
    println!("created {file_path}");

    // Remind the user to register the migration.
    println!();
    println!("⚠  Don't forget to register the migration in migrator/src/migration.rs:");
    println!("   1. Add: mod {module_name};");
    println!("   2. Add: Box::new({module_name}::Migration),");

    Ok(())
}

async fn run_entity_generate(
    output: &std::path::Path,
    database_url: Option<String>,
) -> anyhow::Result<()> {
    use sea_orm_codegen::{
        DateTimeCrate as CodegenDateTimeCrate, EntityTransformer, EntityWriterContext, OutputFile,
        WithPrelude, WithSerde,
    };
    use sea_schema::sqlite::discovery::SchemaDiscovery;

    let db_url = match database_url {
        Some(url) => url,
        None => load_db_url()?,
    };
    let sqlx_url = normalize_sqlite_url(&db_url)?;

    println!("→ discovering schema (rust-sql engine)");
    println!("  database: {db_url}");
    println!("  output:   {}", output.display());

    // Single connection: discovery walks tables with interleaved PRAGMA
    // queries; keeping it on one connection gives a single consistent
    // engine view (and sidesteps pool-split behavior in the engine).
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(30))
        .connect(&sqlx_url)
        .await
        .context("connecting to database (rust-sql engine)")?;
    println!("  connected");

    let schema = SchemaDiscovery::new(pool.clone())
        .discover()
        .await
        .context("discovering schema")?
        .merge_indexes_into_table();

    // Mirror sea-orm-cli's defaults: skip the migration bookkeeping table
    // and hidden (underscore-prefixed) tables.
    let table_stmts = schema
        .tables
        .into_iter()
        .filter(|t| t.name != "seaql_migrations")
        .filter(|t| !t.name.starts_with("sqlite_"))
        .filter(|t| !t.name.starts_with('_'))
        .map(|mut t| {
            // SQLite INTEGER is 64-bit; sea-orm-codegen 1.1 maps
            // ColumnType::Integer to i32 (sea-orm 2.0 fixed this to i64).
            // The existing entities and backend code use i64 for INTEGER
            // columns, so widen the discovered type before writing the
            // create-statement. (TinyInteger/SmallInteger keep their
            // width; only plain INTEGER widens.)
            for col in t.columns.iter_mut() {
                if matches!(col.r#type, sea_query::ColumnType::Integer) {
                    col.r#type = sea_query::ColumnType::BigInteger;
                }
            }
            t.write()
        })
        .collect::<Vec<_>>();

    println!("  discovered {} table(s)", table_stmts.len());

    // Compact format, serde both, no prelude module — matching the
    // checked-in entity layout (plain `pub mod` list in mod.rs).
    let writer_context = EntityWriterContext::new(
        false, // expanded_format
        false, // frontend_format
        WithPrelude::None,
        WithSerde::Both,
        false, // with_copy_enums
        CodegenDateTimeCrate::Chrono,
        None,  // schema_name
        false, // lib
        false, // serde_skip_deserializing_primary_key
        false, // serde_skip_hidden_column
        Vec::new(),
        Vec::new(),
        Vec::new(),
        Vec::new(),
        false, // seaography
        true,  // impl_active_model_behavior
    );
    let entity_writer = EntityTransformer::transform(table_stmts)
        .map_err(|e| anyhow::anyhow!("transforming discovered tables: {e}"))?;

    let dir = output.to_path_buf();
    std::fs::create_dir_all(&dir).context(format!("creating {}", dir.display()))?;

    let writer_output = entity_writer.generate(&writer_context);
    for OutputFile { name, content } in writer_output.files.iter() {
        let file_path = dir.join(name);
        println!("Writing {}", file_path.display());
        std::fs::write(&file_path, content)
            .context(format!("writing {}", file_path.display()))?;
    }

    // Format each generated file, same as sea-orm-cli.
    for OutputFile { name, .. } in writer_output.files.iter() {
        let status = std::process::Command::new("rustfmt")
            .arg(dir.join(name))
            .status()
            .context("spawning rustfmt — is it installed? (rustup component)")?;
        if !status.success() {
            anyhow::bail!("rustfmt failed on {name}");
        }
    }

    pool.close().await;
    println!("✓ entities generated to {}", dir.display());
    Ok(())
}

async fn run_db_reset(yes: bool) -> anyhow::Result<()> {
    if !yes {
        // Non-interactive stdin (piped / no TTY — e.g. sea-orm-cli's
        // `migrate fresh` spawning `cargo run -- fresh`): asking would
        // BLOCK forever. Abort with the escape hatch instead.
        if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
            anyhow::bail!(
                "refusing to drop tables without confirmation: re-run with --yes (stdin is not a terminal)"
            );
        }
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

    // For SQLite (rust-sql): delete the database file and re-apply from
    // scratch. Handles both `sqlite://./app.db` and `sqlite:app.db` forms.
    if let Some(path) = sqlite_file_path(&db_url) {
        if std::path::Path::new(&path).exists() {
            std::fs::remove_file(&path).context(format!("deleting database file {path}"))?;
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

async fn run_db_probe(sql: &str) -> anyhow::Result<()> {
    use sqlx::{Column, Row};

    let db_url = load_db_url()?;
    let sqlx_url = normalize_sqlite_url(&db_url)?;

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&sqlx_url)
        .await
        .context("connecting to database (rust-sql engine)")?;

    let rows = sqlx::query(sql)
        .fetch_all(&mut *pool.acquire().await?)
        .await
        .context("executing probe")?;

    println!("→ {sql}");
    println!("  {} row(s)", rows.len());
    for row in rows.iter() {
        let mut cols: Vec<String> = Vec::new();
        for (i, col) in row.columns().iter().enumerate() {
            let v: String = match row.try_get::<Option<String>, _>(i) {
                Ok(Some(s)) => s,
                Ok(None) => "NULL".to_string(),
                Err(_) => row
                    .try_get::<Option<i64>, _>(i)
                    .map(|v| v.map(|n| n.to_string()).unwrap_or_else(|| "NULL".into()))
                    .unwrap_or_else(|_| "<blob>".to_string()),
            };
            cols.push(format!("{}={}", col.name(), v));
        }
        println!("  | {}", cols.join(" "));
    }
    pool.close().await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/// Convert `snake_case` -> `PascalCase` (e.g. `add_users` -> `AddUsers`).
fn to_pascal(input: &str) -> String {
    input
        .split('_')
        .filter(|s| !s.is_empty())
        .map(|s| {
            let mut chars = s.chars();
            match chars.next() {
                Some(first) => {
                    first.to_uppercase().collect::<String>()
                        + chars.as_str().to_lowercase().as_str()
                }
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
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

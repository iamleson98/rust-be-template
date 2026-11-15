//! `backend import-d1` — Cloudflare D1 export → app database.
//!
//! ```text
//! backend import-d1 --stage stage.db --out app.db --report report.json
//! ```
//!
//! `stage.db` is a plain SQLite file assembled by `scripts/d1-export.sh`
//! from `wrangler d1 export` (D1's own schema and rows, nothing changed).
//! The import
//!
//! 1. creates `--out` fresh with the app's own migrator, so the schema is
//!    exactly the one the app runs on;
//! 2. copies the rows table by table, parents first, naming columns on
//!    both sides, with foreign keys off on the import connection only,
//!    converting every value to the shape the app's code reads and
//!    compares (see [`convert`]);
//! 3. swaps the migrator's randomly numbered seed rows (roles,
//!    permissions, grants, vehicle types) for D1's, so user and schedule
//!    references stay valid, and keeps any role or permission the app
//!    needs by name that D1 lacked;
//! 4. repairs dangling references the app schema forbids (a nullable
//!    reference is cleared, a row that cannot exist without its parent is
//!    left out), recomputes the derived counters, and proves the result:
//!    `integrity_check`, `foreign_key_check`, and every row of every
//!    entity decoded through sea-orm.
//!
//! Nothing is dropped silently. The report lists, per table, the source
//! rows, the rows imported, and every row left out with its reason, plus
//! a programmatic diff of the UNIQUE, NOT NULL and foreign-key rules of
//! the two schemas. The command exits non-zero when the accounting does
//! not add up, a value cannot be read by the app, a check fails, or the
//! stage holds rows with nowhere to go.

mod convert;
pub mod report;
mod schema;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context};
use chrono::{DateTime, SubsecRound, Utc};
use futures::TryStreamExt;
use sea_orm::sqlx::query::Query;
use sea_orm::sqlx::sqlite::{
    SqliteArguments, SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteRow,
    SqliteSynchronous,
};
use sea_orm::sqlx::{
    self, ConnectOptions, Connection, Row, Sqlite, SqliteConnection, TypeInfo, ValueRef,
};
use sea_orm::SqlxSqliteConnector;
use sea_orm_migration::MigratorTrait;

use convert::{reject, Cell, Change, Kind, Parsed, Reject};
pub use report::Report;
use report::{
    Checks, DerivedCounter, DroppedColumn, FkDiff, JsonWarning, NullabilityDiff, SeedReport,
    StageOnlyTable, TableReport, Tally, UniqueDiff,
};
use schema::{quote, ColumnInfo, ColumnSpec, EntitySpec, ForeignKey};

/// Tables the cutover plan leaves in D1: their rows are counted and
/// reported, not copied.
const LEFT_BEHIND: &[(&str, &str)] = &[(
    "job_run",
    "run history of the Worker's cron is not migrated (cutover plan B6)",
)];

/// Tables the migrator fills with randomly numbered seed rows, children
/// first (the order they are emptied in).
const SEEDED: &[&str] = &["role_permissions", "permissions", "roles", "vehicle_type"];

/// Text columns the app parses as JSON; unparseable values are reported.
const JSON_COLUMNS: &[(&str, &str)] = &[
    ("background_job", "args"),
    ("bus_layout", "layout_data"),
    ("chat_message", "attachments"),
    ("notification", "data"),
    ("review", "photos"),
];

/// Most `foreign_key_check` rounds before giving up: each round removes
/// one generation of orphans, and the schema is a few levels deep.
const MAX_REPAIR_ROUNDS: usize = 50;

/// D1 and Cloudflare bookkeeping, not application data.
fn is_bookkeeping(table: &str) -> bool {
    table == "d1_migrations"
        || table.starts_with("_cf_")
        || table.starts_with("place_fts")
        || table.starts_with("sqlite_")
}

/// The stage table a target table is copied from.
fn source_table(target: &str) -> &str {
    match target {
        "null_claw_exchange" => "nullclaw_exchange",
        other => other,
    }
}

/// How the stage rows of `table` are ordered, so that when the app's
/// UNIQUE rule keeps only one of several rows it is the right one.
fn order_by(table: &str) -> &'static str {
    match table {
        // One assignment row per channel in the app (history lived in
        // extra rows in D1): keep the active one, else the latest.
        "chat_assignment" => "(unassigned_at IS NULL) DESC, assigned_at DESC, rowid",
        _ => "rowid",
    }
}

// ── Entry point ──────────────────────────────────────────────────────

/// `import-d1`: import, write the report, fail unless it is clean.
pub async fn run(stage: PathBuf, out: PathBuf, report_path: PathBuf) -> anyhow::Result<()> {
    let report = import(&stage, &out).await?;
    if let Some(dir) = report_path.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).context("creating the report directory")?;
    }
    std::fs::write(&report_path, serde_json::to_vec_pretty(&report)?)
        .with_context(|| format!("writing {}", report_path.display()))?;
    println!("{}", report.summary());
    println!("report: {}", report_path.display());
    anyhow::ensure!(
        report.clean,
        "the import is not clean ({} problem(s)); see {}",
        report.problems.len(),
        report_path.display()
    );
    println!("clean: {}", out.display());
    Ok(())
}

fn remove_database_files(out: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let mut name = out.as_os_str().to_owned();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
}

/// Import `stage` into a new database at `out`. A run that fails halfway
/// leaves no database behind: a half-filled one must never be mistaken
/// for a result.
pub async fn import(stage: &Path, out: &Path) -> anyhow::Result<Report> {
    anyhow::ensure!(
        stage.is_file(),
        "stage database {} not found",
        stage.display()
    );
    anyhow::ensure!(
        !out.exists(),
        "{} already exists; the import creates the database itself and never overwrites one",
        out.display()
    );
    let result = build(stage, out).await;
    if result.is_err() {
        remove_database_files(out);
    }
    result
}

async fn build(stage: &Path, out: &Path) -> anyhow::Result<Report> {
    let import_instant = Utc::now().trunc_subsecs(3);

    let mut stage_conn = SqliteConnectOptions::new()
        .filename(stage)
        .read_only(true)
        .foreign_keys(false)
        .disable_statement_logging()
        .connect()
        .await
        .with_context(|| format!("opening {}", stage.display()))?;
    let stage_facts = read_stage(&mut stage_conn).await?;

    migrate_fresh(out).await?;
    let mut db = SqliteConnectOptions::new()
        .filename(out)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Off)
        .foreign_keys(false)
        .disable_statement_logging()
        .connect()
        .await
        .with_context(|| format!("opening {}", out.display()))?;

    let specs = schema::entity_specs()?;
    let plans = plan_tables(&mut stage_conn, &mut db, &specs, &stage_facts).await?;
    let mut run = Run::new(import_instant, &plans, &stage_facts);

    run.diff_schemas(&mut stage_conn, &mut db, &plans).await?;

    sqlx::query("BEGIN IMMEDIATE").execute(&mut db).await?;
    run.replace_seeds(&mut db).await?;
    for plan in &plans.ordered {
        run.copy_table(&mut stage_conn, &mut db, plan).await?;
    }
    run.restore_missing_seeds(&mut db).await?;
    run.repair_dangling_references(&mut db).await?;
    run.recompute_derived(&mut db).await?;
    sqlx::query("COMMIT").execute(&mut db).await?;

    let report = run
        .finish(&mut db, &mut stage_conn, stage, out, plans)
        .await
        .context("checking the imported database")?;
    db.close().await?;
    stage_conn.close().await?;
    Ok(report)
}

// ── Stage and plan ───────────────────────────────────────────────────

struct StageFacts {
    tables: Vec<String>,
    integrity: Vec<String>,
    foreign_key_violations: BTreeMap<String, BTreeMap<String, u64>>,
}

async fn read_stage(conn: &mut SqliteConnection) -> anyhow::Result<StageFacts> {
    let integrity: Vec<String> = sqlx::query("PRAGMA integrity_check")
        .fetch_all(&mut *conn)
        .await?
        .iter()
        .map(|r| r.try_get(0))
        .collect::<Result<_, _>>()?;
    anyhow::ensure!(
        integrity == ["ok"],
        "the stage database fails integrity_check: {integrity:?}"
    );
    let mut foreign_key_violations: BTreeMap<String, BTreeMap<String, u64>> = BTreeMap::new();
    for row in sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *conn)
        .await?
    {
        let (table, parent): (String, String) = (row.try_get("table")?, row.try_get("parent")?);
        *foreign_key_violations
            .entry(table)
            .or_default()
            .entry(parent)
            .or_default() += 1;
    }
    Ok(StageFacts {
        tables: schema::table_names(conn).await?,
        integrity,
        foreign_key_violations,
    })
}

async fn count_rows(conn: &mut SqliteConnection, table: &str) -> anyhow::Result<u64> {
    let n: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", quote(table)))
        .fetch_one(conn)
        .await?;
    Ok(u64::try_from(n)?)
}

/// Create `out` with the app's migrator.
async fn migrate_fresh(out: &Path) -> anyhow::Result<()> {
    if let Some(dir) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).context("creating the output directory")?;
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(out)
                .create_if_missing(true)
                .foreign_keys(true)
                .disable_statement_logging(),
        )
        .await
        .with_context(|| format!("creating {}", out.display()))?;
    let db = SqlxSqliteConnector::from_sqlx_sqlite_pool(pool);
    migrator::Migrator::up(&db, None)
        .await
        .context("running the app migrations")?;
    db.close().await?;
    Ok(())
}

/// One column the copy moves.
struct PlannedColumn {
    spec: ColumnSpec,
    /// Part of the target primary key (for naming rows in the report).
    primary_key: bool,
}

/// How one table is copied.
struct Plan {
    table: String,
    source: String,
    /// Target columns that exist in the stage, in the entity's order.
    columns: Vec<PlannedColumn>,
    select_sql: String,
    insert_sql: String,
    /// Skip the rows instead of copying them (and why).
    left_behind: Option<&'static str>,
    foreign_keys: Vec<ForeignKey>,
}

impl Plan {
    fn index_of(&self, column: &str) -> Option<usize> {
        self.columns.iter().position(|c| c.spec.name == column)
    }
}

struct Plans {
    /// Parents first.
    ordered: Vec<Plan>,
    /// Stage columns with no counterpart in the app schema.
    dropped_columns: Vec<DroppedColumn>,
    nullability: Vec<NullabilityDiff>,
}

async fn plan_tables(
    stage: &mut SqliteConnection,
    db: &mut SqliteConnection,
    specs: &[EntitySpec],
    facts: &StageFacts,
) -> anyhow::Result<Plans> {
    // The entity list and the migrated schema must agree, or the copy
    // would leave a table out without anyone being told.
    let tables: HashSet<String> = schema::table_names(db).await?.into_iter().collect();
    let entity_tables: HashSet<String> = specs.iter().map(|s| s.table.clone()).collect();
    let mut stray: Vec<_> = tables
        .iter()
        .filter(|t| !entity_tables.contains(*t) && *t != "seaql_migrations")
        .collect();
    stray.sort();
    anyhow::ensure!(
        stray.is_empty(),
        "the migrated schema has tables no entity declares: {stray:?}"
    );
    let missing: Vec<_> = entity_tables
        .iter()
        .filter(|t| !tables.contains(*t))
        .collect();
    anyhow::ensure!(missing.is_empty(), "entities without a table: {missing:?}");

    let mut plans = Vec::new();
    let mut dropped_columns = Vec::new();
    let mut nullability = Vec::new();
    for spec in specs {
        let source = source_table(&spec.table).to_owned();
        let target_info = schema::table_info(db, &spec.table).await?;
        let foreign_keys = schema::foreign_keys(db, &spec.table).await?;
        let left_behind = LEFT_BEHIND
            .iter()
            .find(|(t, _)| *t == spec.table)
            .map(|(_, why)| *why);
        let stage_info = if facts.tables.contains(&source) {
            schema::table_info(stage, &source).await?
        } else {
            Vec::new()
        };

        let mut columns = Vec::new();
        for col in &spec.columns {
            let target = target_info
                .iter()
                .find(|c| c.name == col.name)
                .with_context(|| {
                    format!("{}.{} is not in the migrated schema", spec.table, col.name)
                })?;
            match stage_info.iter().find(|c| c.name == col.name) {
                Some(src) => {
                    if target.notnull && !src.notnull && src.pk == 0 && left_behind.is_none() {
                        let nulls: i64 = sqlx::query_scalar(&format!(
                            "SELECT COUNT(*) FROM {} WHERE {} IS NULL",
                            quote(&source),
                            quote(&col.name)
                        ))
                        .fetch_one(&mut *stage)
                        .await?;
                        nullability.push(NullabilityDiff {
                            table: spec.table.clone(),
                            column: col.name.clone(),
                            source_null_rows: u64::try_from(nulls)?,
                        });
                    }
                    columns.push(PlannedColumn {
                        spec: col.clone(),
                        primary_key: target.pk > 0,
                    });
                }
                None if !stage_info.is_empty()
                    && target.notnull
                    && !target.has_default
                    && left_behind.is_none() =>
                {
                    bail!(
                        "the stage table {source} has no column {} (required by the app schema)",
                        col.name
                    );
                }
                None => {}
            }
        }
        for src in &stage_info {
            if !spec.columns.iter().any(|c| c.name == src.name) && left_behind.is_none() {
                let rows: i64 = sqlx::query_scalar(&format!(
                    "SELECT COUNT(*) FROM {} WHERE {} IS NOT NULL",
                    quote(&source),
                    quote(&src.name)
                ))
                .fetch_one(&mut *stage)
                .await?;
                dropped_columns.push(DroppedColumn {
                    table: spec.table.clone(),
                    column: src.name.clone(),
                    non_null_rows: u64::try_from(rows)?,
                });
            }
        }

        let names: Vec<String> = columns.iter().map(|c| quote(&c.spec.name)).collect();
        let select_sql = format!(
            "SELECT {} FROM {} ORDER BY {}",
            names.join(", "),
            quote(&source),
            order_by(&spec.table)
        );
        let insert_sql = format!(
            "INSERT INTO {} ({}) VALUES ({})",
            quote(&spec.table),
            names.join(", "),
            vec!["?"; names.len()].join(", ")
        );
        plans.push(Plan {
            table: spec.table.clone(),
            source,
            columns,
            select_sql,
            insert_sql,
            left_behind,
            foreign_keys,
        });
    }

    let parents = plans
        .iter()
        .map(|p| {
            (
                p.table.clone(),
                p.foreign_keys.iter().map(|f| f.parent.clone()).collect(),
            )
        })
        .collect();
    let order = schema::parents_first(&parents);
    let mut by_table: HashMap<String, Plan> =
        plans.into_iter().map(|p| (p.table.clone(), p)).collect();
    let ordered = order
        .iter()
        .map(|t| by_table.remove(t).expect("every table is planned"))
        .collect();
    Ok(Plans {
        ordered,
        dropped_columns,
        nullability,
    })
}

// ── The run ──────────────────────────────────────────────────────────

/// Everything the copy learns on the way, turned into the report at the
/// end.
struct Run<'a> {
    import_instant: DateTime<Utc>,
    facts: &'a StageFacts,
    tables: BTreeMap<String, TableState>,
    unique_diff: Vec<UniqueDiff>,
    fk_diff: Vec<FkDiff>,
    seeds: SeedReport,
    derived: Vec<DerivedCounter>,
    /// Per table: the dangling-reference counts found before repair, by
    /// foreign key id.
    fk_violations: HashMap<(String, i64), u64>,
}

struct TableState {
    source_table: String,
    source_rows: u64,
    skipped: Tally,
    pruned: Tally,
    rejected: Tally,
    fixes: BTreeMap<String, u64>,
    restored: u64,
}

impl TableState {
    fn fix(&mut self, what: impl Into<String>) {
        *self.fixes.entry(what.into()).or_default() += 1;
    }
}

impl<'a> Run<'a> {
    fn new(import_instant: DateTime<Utc>, plans: &Plans, facts: &'a StageFacts) -> Self {
        let tables = plans
            .ordered
            .iter()
            .map(|p| {
                (
                    p.table.clone(),
                    TableState {
                        source_table: p.source.clone(),
                        source_rows: 0,
                        skipped: Tally::default(),
                        pruned: Tally::default(),
                        rejected: Tally::default(),
                        fixes: BTreeMap::new(),
                        restored: 0,
                    },
                )
            })
            .collect();
        Self {
            import_instant,
            facts,
            tables,
            unique_diff: Vec::new(),
            fk_diff: Vec::new(),
            seeds: SeedReport::default(),
            derived: Vec::new(),
            fk_violations: HashMap::new(),
        }
    }

    fn state(&mut self, table: &str) -> &mut TableState {
        self.tables.get_mut(table).expect("every table has a state")
    }

    /// Compare the UNIQUE constraints of the two schemas.
    async fn diff_schemas(
        &mut self,
        stage: &mut SqliteConnection,
        db: &mut SqliteConnection,
        plans: &Plans,
    ) -> anyhow::Result<()> {
        for plan in &plans.ordered {
            if plan.left_behind.is_some() {
                continue;
            }
            let source_sets = if self.facts.tables.contains(&plan.source) {
                sorted_sets(schema::unique_indexes(stage, &plan.source).await?)
            } else {
                Vec::new()
            };
            for columns in schema::unique_indexes(db, &plan.table).await? {
                let mut key = columns.clone();
                key.sort();
                self.unique_diff.push(UniqueDiff {
                    table: plan.table.clone(),
                    columns,
                    in_source: source_sets.contains(&key),
                    rows_skipped: 0,
                });
            }
        }
        Ok(())
    }

    /// Empty the migrator's seed tables (keeping a copy, to restore what
    /// D1 lacks); D1's rows take their place in the copy.
    async fn replace_seeds(&mut self, db: &mut SqliteConnection) -> anyhow::Result<()> {
        for statement in [
            "CREATE TEMP TABLE seed_roles AS SELECT * FROM roles",
            "CREATE TEMP TABLE seed_permissions AS SELECT * FROM permissions",
            "CREATE TEMP TABLE seed_grants AS \
             SELECT r.name AS role_name, p.name AS permission_name, rp.assigned_at \
             FROM role_permissions rp \
             JOIN roles r ON r.id = rp.role_id \
             JOIN permissions p ON p.id = rp.permission_id",
        ] {
            sqlx::query(statement).execute(&mut *db).await?;
        }
        for table in SEEDED {
            let removed = sqlx::query(&format!("DELETE FROM {}", quote(table)))
                .execute(&mut *db)
                .await?
                .rows_affected();
            self.seeds.replaced.insert((*table).to_owned(), removed);
        }
        Ok(())
    }

    /// Copy one table.
    async fn copy_table(
        &mut self,
        stage: &mut SqliteConnection,
        db: &mut SqliteConnection,
        plan: &Plan,
    ) -> anyhow::Result<()> {
        let present = self.facts.tables.contains(&plan.source);
        let source_rows = if present {
            count_rows(stage, &plan.source).await?
        } else {
            0
        };
        self.state(&plan.table).source_rows = source_rows;
        if !present {
            return Ok(());
        }
        if let Some(why) = plan.left_behind {
            self.state(&plan.table).skipped.add_many(why, source_rows);
            return Ok(());
        }

        let hook = RowHook::for_table(plan, stage, self.import_instant).await?;
        let width = plan.columns.len();
        let mut rows = sqlx::query(&plan.select_sql).fetch(&mut *stage);
        while let Some(row) = rows.try_next().await? {
            let raw = read_cells(&row, width)?;
            let key = row_key(plan, &raw);
            let converted = match self.convert_row(plan, &hook, &raw) {
                Ok(cells) => cells,
                Err(reject) => {
                    self.state(&plan.table).rejected.add(reject.0, key);
                    continue;
                }
            };
            let Some(cells) = converted else {
                self.state(&plan.table).pruned.add(
                    "job kind is not in the app's catalog; the boot code would delete the schedule",
                    key,
                );
                continue;
            };
            let mut insert = sqlx::query(&plan.insert_sql);
            for cell in &cells {
                insert = bind(insert, cell);
            }
            match insert.execute(&mut *db).await {
                Ok(_) => {}
                Err(sqlx::Error::Database(e))
                    if matches!(
                        e.kind(),
                        sqlx::error::ErrorKind::UniqueViolation
                            | sqlx::error::ErrorKind::NotNullViolation
                            | sqlx::error::ErrorKind::CheckViolation
                    ) =>
                {
                    self.state(&plan.table)
                        .skipped
                        .add(e.message().to_owned(), key);
                }
                Err(e) => {
                    return Err(e).with_context(|| format!("inserting into {}", plan.table));
                }
            }
        }
        Ok(())
    }

    /// One stage row → the cells to insert. `Ok(None)` = pruned.
    fn convert_row(
        &mut self,
        plan: &Plan,
        hook: &RowHook,
        raw: &[Cell],
    ) -> Result<Option<Vec<Cell>>, Reject> {
        let mut fixes = Vec::new();
        let mut cells = Vec::with_capacity(raw.len());
        let mut literal_defaults = Vec::new();
        for (i, (col, cell)) in plan.columns.iter().zip(raw).enumerate() {
            let (cell, change) = convert::convert(col.spec.kind, cell.clone())
                .map_err(|r| Reject(format!("{}: {}", col.spec.name, r.0)))?;
            match change {
                Change::LiteralDefault => literal_defaults.push(i),
                Change::Repaired => {
                    fixes.push(format!(
                        "{}: malformed UUID repaired (last group zero-padded)",
                        col.spec.name
                    ));
                }
                Change::Reshaped if !matches!(col.spec.kind, Kind::Uuid | Kind::Instant) => {
                    fixes.push(format!("{}: reformatted", col.spec.name));
                }
                _ => {}
            }
            cells.push(cell);
        }

        if !literal_defaults.is_empty() {
            // The true insert time is unrecoverable (the Worker's own
            // repair migration says so); the row's creation time is the
            // nearest honest value, else the import instant.
            let created = plan
                .index_of("created_at")
                .filter(|i| !literal_defaults.contains(i))
                .and_then(|i| match &cells[i] {
                    Cell::Text(t) => match convert::parse_instant(t) {
                        Ok(Parsed::Instant(at)) => Some(at),
                        _ => None,
                    },
                    _ => None,
                })
                .unwrap_or(self.import_instant);
            for i in literal_defaults {
                let col = &plan.columns[i];
                cells[i] = Cell::Text(convert::format_instant(col.spec.kind, created));
                fixes.push(format!("{}: literal default replaced", col.spec.name));
            }
        }

        let keep = hook.apply(plan, raw, &mut cells, &mut fixes)?;
        if keep {
            for fix in fixes {
                self.state(&plan.table).fix(fix);
            }
            Ok(Some(cells))
        } else {
            Ok(None)
        }
    }

    /// Roles and permissions the app addresses by name that D1 did not
    /// have come back from the migrator's seed (with the grants that name
    /// them), so no feature loses its permission by being absent.
    async fn restore_missing_seeds(&mut self, db: &mut SqliteConnection) -> anyhow::Result<()> {
        let missing_roles = names(
            db,
            "SELECT name FROM seed_roles WHERE name NOT IN (SELECT name FROM roles)",
        )
        .await?;
        let missing_permissions = names(
            db,
            "SELECT name FROM seed_permissions WHERE name NOT IN (SELECT name FROM permissions)",
        )
        .await?;
        sqlx::query(
            "INSERT INTO roles SELECT * FROM seed_roles WHERE name NOT IN (SELECT name FROM roles)",
        )
        .execute(&mut *db)
        .await?;
        sqlx::query(
            "INSERT INTO permissions SELECT * FROM seed_permissions \
             WHERE name NOT IN (SELECT name FROM permissions)",
        )
        .execute(&mut *db)
        .await?;
        self.state("roles").restored += missing_roles.len() as u64;
        self.state("permissions").restored += missing_permissions.len() as u64;
        self.seeds
            .restored
            .extend(missing_roles.iter().map(|n| format!("role {n}")));
        self.seeds.restored.extend(
            missing_permissions
                .iter()
                .map(|n| format!("permission {n}")),
        );

        let mut restored_grants = 0;
        for grant in sqlx::query("SELECT role_name, permission_name, assigned_at FROM seed_grants")
            .fetch_all(&mut *db)
            .await?
        {
            let (role, permission): (String, String) = (
                grant.try_get("role_name")?,
                grant.try_get("permission_name")?,
            );
            if !missing_roles.contains(&role) && !missing_permissions.contains(&permission) {
                continue;
            }
            restored_grants += sqlx::query(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_id, assigned_at) \
                 SELECT r.id, p.id, ? FROM roles r, permissions p WHERE r.name = ? AND p.name = ?",
            )
            .bind(grant.try_get::<String, _>("assigned_at")?)
            .bind(&role)
            .bind(&permission)
            .execute(&mut *db)
            .await?
            .rows_affected();
        }
        self.state("role_permissions").restored += restored_grants;
        if restored_grants > 0 {
            self.seeds
                .restored
                .push(format!("{restored_grants} grant(s) of the restored rows"));
        }
        Ok(())
    }

    /// Make every reference resolve. A nullable reference to a row D1
    /// lost is cleared; a row that cannot exist without its parent is
    /// left out (and its own dependants with it, a round later).
    async fn repair_dangling_references(
        &mut self,
        db: &mut SqliteConnection,
    ) -> anyhow::Result<()> {
        let foreign_keys: HashMap<String, Vec<ForeignKey>> = {
            let mut map = HashMap::new();
            for table in self.tables.keys() {
                map.insert(table.clone(), schema::foreign_keys(db, table).await?);
            }
            map
        };
        let mut columns: HashMap<String, Vec<ColumnInfo>> = HashMap::new();
        for table in self.tables.keys() {
            columns.insert(table.clone(), schema::table_info(db, table).await?);
        }

        for round in 0..MAX_REPAIR_ROUNDS {
            let violations = foreign_key_check(db).await?;
            if violations.is_empty() {
                return Ok(());
            }
            if round == 0 {
                for v in &violations {
                    *self
                        .fk_violations
                        .entry((v.table.clone(), v.fkid))
                        .or_default() += 1;
                }
            }
            let mut by_row: BTreeMap<(String, i64), Vec<&Violation>> = BTreeMap::new();
            for v in &violations {
                by_row
                    .entry((v.table.clone(), v.rowid))
                    .or_default()
                    .push(v);
            }
            for ((table, rowid), found) in by_row {
                let infos = &columns[&table];
                let nullable = |fk: &ForeignKey| {
                    fk.columns
                        .iter()
                        .all(|c| infos.iter().any(|i| &i.name == c && !i.notnull))
                };
                let fks: Vec<&ForeignKey> = found
                    .iter()
                    .filter_map(|v| foreign_keys[&table].iter().find(|f| f.id == v.fkid))
                    .collect();
                if let Some(fk) = fks.iter().find(|f| !nullable(f)) {
                    let key = row_key_in(db, &table, infos, rowid).await?;
                    sqlx::query(&format!("DELETE FROM {} WHERE rowid = ?", quote(&table)))
                        .bind(rowid)
                        .execute(&mut *db)
                        .await?;
                    self.state(&table).skipped.add(
                        format!(
                            "dangling reference: {}.{} points at a {} row that does not exist",
                            table,
                            fk.columns.join(", "),
                            fk.parent
                        ),
                        key,
                    );
                } else {
                    for fk in fks {
                        for column in &fk.columns {
                            sqlx::query(&format!(
                                "UPDATE {} SET {} = NULL WHERE rowid = ?",
                                quote(&table),
                                quote(column)
                            ))
                            .bind(rowid)
                            .execute(&mut *db)
                            .await?;
                        }
                        self.state(&table).fix(format!(
                            "{}: dangling reference to {} cleared",
                            fk.columns.join(", "),
                            fk.parent
                        ));
                    }
                }
            }
        }
        bail!(
            "foreign_key_check still reports dangling rows after {MAX_REPAIR_ROUNDS} repair rounds"
        )
    }

    /// Columns that are a function of other rows (see the notes on each),
    /// recomputed from the rows that were imported.
    async fn recompute_derived(&mut self, db: &mut SqliteConnection) -> anyhow::Result<()> {
        // `available_seats` is the number of seats still `available` in the
        // trip's inventory: the hold path subtracts, every release adds
        // (`store::booking`), and the inventory is created whole with the
        // trip. The Worker never added seats back on a cancel, so its
        // counters drift upwards from the truth. A trip without inventory
        // rows (a vehicle-type fallback) has no seats to count and keeps
        // its capacity.
        const SEATS_LEFT: &str = "(SELECT COUNT(*) FROM seat_inventory si \
             WHERE si.trip_session_id = trip_session.id AND si.status = 'available')";
        const HAS_INVENTORY: &str =
            "EXISTS (SELECT 1 FROM seat_inventory si WHERE si.trip_session_id = trip_session.id)";
        let considered: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM trip_session WHERE {HAS_INVENTORY}"
        ))
        .fetch_one(&mut *db)
        .await?;
        let changed = sqlx::query(&format!(
            "UPDATE trip_session SET available_seats = {SEATS_LEFT} \
             WHERE {HAS_INVENTORY} AND available_seats <> {SEATS_LEFT}"
        ))
        .execute(&mut *db)
        .await?
        .rows_affected();
        self.derived.push(DerivedCounter {
            table: "trip_session".into(),
            column: "available_seats".into(),
            rule: "seat_inventory rows with status 'available' (trips with an inventory only)",
            considered: u64::try_from(considered)?,
            changed,
        });

        // A brand with approved reviews is rated by their mean, as
        // `review_service::reconcile_brand_ratings` does at every boot; a
        // brand without keeps its stored (operator) rating.
        const MEAN: &str = "(SELECT AVG(r.rating) FROM review r \
             WHERE r.brand_id = brand.id AND r.status = 'approved')";
        let considered: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM brand WHERE EXISTS \
             (SELECT 1 FROM review r WHERE r.brand_id = brand.id AND r.status = 'approved')",
        )
        .fetch_one(&mut *db)
        .await?;
        let changed = sqlx::query(&format!(
            "UPDATE brand SET rating = {MEAN} WHERE {MEAN} IS NOT NULL AND rating IS NOT {MEAN}"
        ))
        .execute(&mut *db)
        .await?
        .rows_affected();
        self.derived.push(DerivedCounter {
            table: "brand".into(),
            column: "rating".into(),
            rule: "mean rating of the brand's approved reviews (brands without any keep theirs)",
            considered: u64::try_from(considered)?,
            changed,
        });

        // Not derived, so not touched: `brand.total_trips` and
        // `campaign.used_count` are written by no code on either side, and
        // `discount_tier.claimed_slots` depends on history (a slot comes
        // back only when a coupon is given up while its campaign runs), so
        // no row count reproduces it.
        Ok(())
    }

    /// The checks, the counts, and the report.
    async fn finish(
        mut self,
        db: &mut SqliteConnection,
        stage_conn: &mut SqliteConnection,
        stage: &Path,
        out: &Path,
        plans: Plans,
    ) -> anyhow::Result<Report> {
        let Plans {
            ordered,
            dropped_columns,
            nullability,
        } = plans;
        let mut checks = Checks {
            stage_integrity_check: self.facts.integrity.clone(),
            stage_foreign_key_violations: self.facts.foreign_key_violations.clone(),
            ..Checks::default()
        };
        checks.integrity_check = sqlx::query("PRAGMA integrity_check")
            .fetch_all(&mut *db)
            .await?
            .iter()
            .map(|r| r.try_get(0))
            .collect::<Result<_, _>>()?;
        checks.foreign_key_check = foreign_key_check(db)
            .await?
            .iter()
            .map(|v| format!("{} rowid {} -> {}", v.table, v.rowid, v.parent))
            .collect();

        let mut json_warnings = Vec::new();
        for (table, column) in JSON_COLUMNS {
            let invalid: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {t} WHERE {c} IS NOT NULL AND NOT json_valid({c})",
                t = quote(table),
                c = quote(column)
            ))
            .fetch_one(&mut *db)
            .await?;
            if invalid > 0 {
                json_warnings.push(JsonWarning {
                    table: (*table).to_owned(),
                    column: (*column).to_owned(),
                    invalid_rows: u64::try_from(invalid)?,
                });
            }
        }

        sqlx::query("ANALYZE").execute(&mut *db).await?;
        let mut final_rows = BTreeMap::new();
        for plan in &ordered {
            final_rows.insert(plan.table.clone(), count_rows(db, &plan.table).await?);
        }
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&mut *db)
            .await?;

        let decode = decode_proof(out).await?;

        // UNIQUE and FK diffs now know how many rows each cost.
        for diff in &mut self.unique_diff {
            let reason = format!(
                "UNIQUE constraint failed: {}",
                diff.columns
                    .iter()
                    .map(|c| format!("{}.{c}", diff.table))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            diff.rows_skipped = self.tables[&diff.table].skipped.count_of(&reason);
        }
        let mut fk_diff = Vec::new();
        for plan in &ordered {
            for fk in &plan.foreign_keys {
                fk_diff.push(FkDiff {
                    table: plan.table.clone(),
                    columns: fk.columns.clone(),
                    parent: fk.parent.clone(),
                    on_delete: fk.on_delete.clone(),
                    in_source: false,
                    violations: self
                        .fk_violations
                        .get(&(plan.table.clone(), fk.id))
                        .copied()
                        .unwrap_or(0),
                });
            }
        }
        self.fk_diff = fk_diff;

        let mut problems = Vec::new();
        let mut tables = Vec::new();
        for plan in &ordered {
            let state = &self.tables[&plan.table];
            let final_count = final_rows[&plan.table];
            let imported = final_count.saturating_sub(state.restored);
            let accounted =
                imported + state.skipped.total() + state.pruned.total() + state.rejected.total();
            let reconciled = accounted == state.source_rows;
            if !self.facts.tables.contains(&state.source_table) {
                problems.push(format!(
                    "the stage has no table {} (was the export incomplete?)",
                    state.source_table
                ));
            }
            if !reconciled {
                problems.push(format!(
                    "{}: {} source rows but {accounted} accounted for",
                    plan.table, state.source_rows
                ));
            }
            if state.rejected.total() > 0 {
                problems.push(format!(
                    "{}: {} row(s) hold values the app cannot read",
                    plan.table,
                    state.rejected.total()
                ));
            }
            tables.push(TableReport {
                table: plan.table.clone(),
                source_table: state.source_table.clone(),
                source_rows: state.source_rows,
                imported_rows: imported,
                restored_rows: state.restored,
                skipped: state.skipped.groups(),
                pruned: state.pruned.groups(),
                rejected: state.rejected.groups(),
                fixes: state.fixes.clone(),
                reconciled,
            });
        }

        let planned: HashSet<&str> = ordered.iter().map(|p| p.source.as_str()).collect();
        let mut stage_only = Vec::new();
        for table in &self.facts.tables {
            if planned.contains(table.as_str()) {
                continue;
            }
            let rows = count_rows(stage_conn, table).await?;
            let ignored = is_bookkeeping(table);
            if !ignored && rows > 0 {
                problems.push(format!(
                    "the stage table {table} has {rows} row(s) and no place in the app"
                ));
            }
            stage_only.push(StageOnlyTable {
                table: table.clone(),
                rows,
                disposition: if ignored { "ignored" } else { "unexplained" },
            });
        }
        let stage_fks = {
            let mut map: HashMap<String, Vec<ForeignKey>> = HashMap::new();
            for plan in &ordered {
                if self.facts.tables.contains(&plan.source) {
                    map.insert(
                        plan.table.clone(),
                        schema::foreign_keys(stage_conn, &plan.source).await?,
                    );
                }
            }
            map
        };
        for diff in &mut self.fk_diff {
            diff.in_source = stage_fks.get(&diff.table).is_some_and(|fks| {
                fks.iter()
                    .any(|f| f.parent == diff.parent && f.columns == diff.columns)
            });
        }

        if checks.integrity_check != ["ok"] {
            problems.push(format!("integrity_check: {:?}", checks.integrity_check));
        }
        if !checks.foreign_key_check.is_empty() {
            problems.push(format!(
                "foreign_key_check reports {} dangling row(s)",
                checks.foreign_key_check.len()
            ));
        }
        for result in &decode {
            match (&result.error, result.rows) {
                (Some(e), _) => problems.push(format!("{} does not decode: {e}", result.table)),
                (None, Some(rows)) if rows != final_rows[&result.table] => problems.push(format!(
                    "{}: {} rows decoded but {} stored",
                    result.table, rows, final_rows[&result.table]
                )),
                _ => {}
            }
        }

        Ok(Report {
            clean: problems.is_empty(),
            problems,
            stage: stage.display().to_string(),
            out: out.display().to_string(),
            sqlite_version: crate::db::sqlite_version().to_owned(),
            import_instant: convert::format_instant_text(self.import_instant),
            tables,
            stage_only_tables: stage_only,
            dropped_columns,
            unique_diff: self.unique_diff,
            nullability_diff: nullability,
            fk_diff: self.fk_diff,
            seeds: self.seeds,
            derived: self.derived,
            json_warnings,
            checks,
            decode,
        })
    }
}

/// Load every row of every entity the way the app does.
async fn decode_proof(out: &Path) -> anyhow::Result<Vec<report::DecodeResult>> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(out)
                .foreign_keys(false)
                .disable_statement_logging(),
        )
        .await?;
    let db = SqlxSqliteConnector::from_sqlx_sqlite_pool(pool);
    let results = schema::decode_every_row(&db).await;
    db.close().await?;
    Ok(results)
}

// ── Row helpers ──────────────────────────────────────────────────────

/// The few tables whose rows need more than a column-by-column conversion.
enum RowHook {
    None,
    /// `schedule_point`: the Worker's stop kinds and 1-based order.
    SchedulePoint {
        /// Lowest `stop_order` of each schedule (by its stage id).
        first: HashMap<String, i64>,
    },
    /// `route_picture`: a picture without a thumbnail is its own.
    RoutePicture,
    /// `scheduled_job`: only jobs the app still has, each with a next run.
    ScheduledJob {
        /// Local time zone of `at_hour:at_minute`, minutes east of UTC.
        offset_minutes: i32,
        now: DateTime<Utc>,
    },
}

impl RowHook {
    async fn for_table(
        plan: &Plan,
        stage: &mut SqliteConnection,
        now: DateTime<Utc>,
    ) -> anyhow::Result<Self> {
        Ok(match plan.table.as_str() {
            "schedule_point" => {
                let rows = sqlx::query(
                    "SELECT schedule_id, MIN(CAST(stop_order AS INTEGER)) AS first \
                     FROM schedule_point GROUP BY schedule_id",
                )
                .fetch_all(&mut *stage)
                .await?;
                let mut first = HashMap::new();
                for row in rows {
                    first.insert(row.try_get("schedule_id")?, row.try_get("first")?);
                }
                Self::SchedulePoint { first }
            }
            "route_picture" => Self::RoutePicture,
            "scheduled_job" => Self::ScheduledJob {
                // The app's own default and variable (`config::SchedulerConfig`).
                offset_minutes: std::env::var("SCHEDULER_TZ_OFFSET_MINUTES")
                    .ok()
                    .and_then(|v| v.trim().parse().ok())
                    .unwrap_or(420),
                now,
            },
            _ => Self::None,
        })
    }

    /// Rewrite the converted `cells`. `false` = prune the row.
    fn apply(
        &self,
        plan: &Plan,
        raw: &[Cell],
        cells: &mut [Cell],
        fixes: &mut Vec<String>,
    ) -> Result<bool, Reject> {
        match self {
            Self::None => {}
            Self::SchedulePoint { first } => {
                let kind = plan.index_of("kind").expect("schedule_point.kind");
                if let Cell::Text(current) = &cells[kind] {
                    let mapped = convert::stop_kind(current)?;
                    if mapped != current {
                        fixes.push("kind: Worker stop name mapped to pickup/middle/drop".into());
                    }
                    cells[kind] = Cell::Text(mapped.to_owned());
                }
                // The Worker numbered stops from 1; the app from 0.
                let order = plan
                    .index_of("stop_order")
                    .expect("schedule_point.stop_order");
                let schedule = plan
                    .index_of("schedule_id")
                    .expect("schedule_point.schedule_id");
                if let (Cell::Int(n), Cell::Text(id)) = (&cells[order], &raw[schedule]) {
                    let lowest = first.get(id).copied().unwrap_or(0);
                    if lowest != 0 {
                        cells[order] = Cell::Int(n - lowest);
                        fixes.push("stop_order: renumbered to start at 0".into());
                    }
                }
            }
            Self::RoutePicture => {
                let storage = plan
                    .index_of("storage_key")
                    .expect("route_picture.storage_key");
                let thumb = plan.index_of("thumb_key").expect("route_picture.thumb_key");
                if cells[thumb] == Cell::Null && cells[storage] != Cell::Null {
                    // The Worker served `thumbKey ?? storageKey`: the
                    // original is its own thumbnail.
                    cells[thumb] = cells[storage].clone();
                    let bytes = plan
                        .index_of("thumb_bytes")
                        .expect("route_picture.thumb_bytes");
                    let size = plan
                        .index_of("size_bytes")
                        .expect("route_picture.size_bytes");
                    if cells[bytes] == Cell::Null {
                        cells[bytes] = cells[size].clone();
                    }
                    fixes.push("thumb_key: the original image serves as its own thumbnail".into());
                }
            }
            Self::ScheduledJob {
                offset_minutes,
                now,
            } => {
                let kind = plan.index_of("job_type").expect("scheduled_job.job_type");
                if let Cell::Text(kind) = &cells[kind] {
                    if crate::jobs::find_definition(kind).is_none() {
                        return Ok(false);
                    }
                }
                // The scheduler only fires a row whose `next_run_at` is set
                // (`find_due_schedules`), and the boot code keeps existing
                // rows as they are: the Worker's seed rows, which have none,
                // would never run. Give them what `ensure_default_jobs`
                // gives a new row: the next occurrence of their time of day.
                let next = plan
                    .index_of("next_run_at")
                    .expect("scheduled_job.next_run_at");
                if cells[next] == Cell::Null {
                    let at = |column: &str| match plan.index_of(column).map(|i| &cells[i]) {
                        Some(Cell::Int(v)) => i16::try_from(*v).ok(),
                        _ => None,
                    };
                    let (Some(hour), Some(minute)) = (at("at_hour"), at("at_minute")) else {
                        return reject("at_hour / at_minute are not small integers");
                    };
                    let slot =
                        crate::scheduler::next_occurrence(*now, hour, minute, *offset_minutes);
                    cells[next] = Cell::Text(convert::format_instant_text(slot));
                    fixes.push(
                        "next_run_at: empty, set to the next occurrence of at_hour:at_minute"
                            .into(),
                    );
                }
            }
        }
        Ok(true)
    }
}

fn read_cells(row: &SqliteRow, width: usize) -> anyhow::Result<Vec<Cell>> {
    (0..width).map(|i| read_cell(row, i)).collect()
}

fn read_cell(row: &SqliteRow, i: usize) -> anyhow::Result<Cell> {
    let raw = row.try_get_raw(i)?;
    if raw.is_null() {
        return Ok(Cell::Null);
    }
    let name = raw.type_info().name().to_owned();
    Ok(match name.as_str() {
        "INTEGER" => Cell::Int(row.try_get_unchecked(i)?),
        "REAL" => Cell::Real(row.try_get_unchecked(i)?),
        "TEXT" => Cell::Text(row.try_get_unchecked(i)?),
        "BLOB" => Cell::Blob(row.try_get_unchecked(i)?),
        other => bail!("column {i}: unexpected SQLite type {other}"),
    })
}

fn bind<'q>(
    query: Query<'q, Sqlite, SqliteArguments<'q>>,
    cell: &'q Cell,
) -> Query<'q, Sqlite, SqliteArguments<'q>> {
    match cell {
        Cell::Null => query.bind(Option::<i64>::None),
        Cell::Int(v) => query.bind(*v),
        Cell::Real(v) => query.bind(*v),
        Cell::Text(s) => query.bind(s.as_str()),
        Cell::Blob(b) => query.bind(b.as_slice()),
    }
}

/// How a row is named in the report: its primary key, UUIDs as text.
fn row_key(plan: &Plan, raw: &[Cell]) -> Option<String> {
    let parts: Vec<String> = plan
        .columns
        .iter()
        .zip(raw)
        .filter(|(c, _)| c.primary_key)
        .map(|(c, cell)| format!("{}={}", c.spec.name, cell_text(cell)))
        .collect();
    (!parts.is_empty()).then(|| parts.join(", "))
}

fn cell_text(cell: &Cell) -> String {
    match cell {
        Cell::Null => "NULL".into(),
        Cell::Int(v) => v.to_string(),
        Cell::Real(v) => v.to_string(),
        Cell::Text(t) => t.clone(),
        Cell::Blob(b) => uuid::Uuid::from_slice(b)
            .map_or_else(|_| format!("{} bytes", b.len()), |u| u.to_string()),
    }
}

/// The key of a row already in the app database.
async fn row_key_in(
    db: &mut SqliteConnection,
    table: &str,
    infos: &[ColumnInfo],
    rowid: i64,
) -> anyhow::Result<Option<String>> {
    let mut keys: Vec<&ColumnInfo> = infos.iter().filter(|c| c.pk > 0).collect();
    keys.sort_by_key(|c| c.pk);
    if keys.is_empty() {
        return Ok(None);
    }
    let select = keys
        .iter()
        .map(|c| quote(&c.name))
        .collect::<Vec<_>>()
        .join(", ");
    let row = sqlx::query(&format!(
        "SELECT {select} FROM {} WHERE rowid = ?",
        quote(table)
    ))
    .bind(rowid)
    .fetch_one(&mut *db)
    .await?;
    let parts = keys
        .iter()
        .enumerate()
        .map(|(i, c)| Ok(format!("{}={}", c.name, cell_text(&read_cell(&row, i)?))))
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(Some(parts.join(", ")))
}

async fn names(db: &mut SqliteConnection, sql: &str) -> anyhow::Result<Vec<String>> {
    sqlx::query(sql)
        .fetch_all(db)
        .await?
        .iter()
        .map(|r| Ok(r.try_get::<String, _>(0)?))
        .collect()
}

fn sorted_sets(sets: Vec<Vec<String>>) -> Vec<Vec<String>> {
    sets.into_iter()
        .map(|mut s| {
            s.sort();
            s
        })
        .collect()
}

struct Violation {
    table: String,
    rowid: i64,
    parent: String,
    fkid: i64,
}

async fn foreign_key_check(db: &mut SqliteConnection) -> anyhow::Result<Vec<Violation>> {
    sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(db)
        .await?
        .iter()
        .map(|r| {
            Ok(Violation {
                table: r.try_get("table")?,
                rowid: r.try_get("rowid")?,
                parent: r.try_get("parent")?,
                fkid: r.try_get("fkid")?,
            })
        })
        .collect()
}

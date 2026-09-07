//! Boot-time migration of legacy C-SQLite database files to the rustqlite
//! engine.
//!
//! The `sqlite` backend of this app links the **rustqlite** engine (pure
//! Rust) through the `libsqlite3-sys` compat layer instead of C SQLite.
//! rustqlite uses its own on-disk format (file magic `RSQLDB01`, row codec
//! v2), so a database file written by C SQLite (`SQLite format 3\0`) cannot
//! be opened directly — the data must be re-imported once.
//!
//! [`maybe_migrate_sqlite_database`] performs that import automatically,
//! before the connection pool opens:
//!
//! 1. Resolve the file path from the `DATABASE_URL` and sniff the header.
//!    Anything that is not a legacy C-SQLite file (rustqlite file, missing
//!    file, empty file handled below) is left alone — the call is a no-op.
//! 2. Dump the legacy file with the `sqlite3` CLI (`.dump` — the CLI
//!    checkpoints any pending WAL and emits a full SQL script: schema,
//!    `seaql_migrations` bookkeeping rows, and data).
//! 3. Rename the legacy file to `<path>.sqlite.bak` (plus its `-wal` /
//!    `-shm` siblings) so the original data is preserved on disk.
//! 4. Replay the dump into a fresh rustqlite database through the same
//!    C ABI the pool uses (one engine instance, shared per path), inside
//!    a single transaction.
//! 5. Verify per-table row counts match the legacy file; on ANY mismatch
//!    or error the new file is deleted and the `.bak` is restored, so a
//!    failed migration can never lose data — boot then fails loudly.
//!
//! An empty (0-byte) file is also treated as migratable: the dump is empty
//! and the replay produces a valid empty rustqlite database, which the
//! migrator then populates.
//!
//! Because the dump includes the `seaql_migrations` tracking table, after
//! migration the sea-orm migrator sees every migration as applied and
//! boot proceeds exactly as before.
//!
//! The `sqlite3` CLI is only needed on the legacy path — fresh
//! deployments never invoke it. The runtime Docker image ships it.

use std::ffi::CString;
use std::os::raw::c_int;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context};
use libsqlite3_sys as sq;

// Force the rustqlite engine into every binary that links this crate
// (rlib link mode — see .cargo/config.toml). sqlx-sqlite's objects carry
// the sqlite3_* undefined references, but rustc keeps the `sqlite3`
// crate's rlib on a binary's link line only when some compiled code
// REFERENCES the crate — the C-ABI #[no_mangle] exports alone are
// invisible to that selection. This anchor references the compat
// crate's Rust-visible `engine_version`, so the rlib (and its engine
// dependency) land on the link line of every dependent — integration
// tests included — and ALL 124 sqlite3_* exports come with them.
#[cfg(feature = "sqlite")]
#[used]
static ENGINE_LINK_ANCHOR: fn() -> &'static str = sqlite3::engine_version;

/// The database engine identity this build links (rustqlite via the
/// compat C ABI). Also serves as the Rust-visible link anchor for the
/// `sqlite3` crate — see `ENGINE_LINK_ANCHOR`.
pub fn engine_version() -> &'static str {
    sqlite3::engine_version()
}

/// What [`maybe_migrate_sqlite_database`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// No legacy file found — nothing to do.
    NotNeeded,
    /// The legacy file was migrated; the original is kept as
    /// `<path>.sqlite.bak`.
    Migrated {
        tables: usize,
        rows: i64,
        backup: PathBuf,
    },
}

/// Legacy C-SQLite file header magic (16 bytes at offset 0).
const SQLITE_MAGIC: &[u8; 15] = b"SQLite format 3";

/// Extract the database file path from a `sqlite://…` DATABASE_URL.
///
/// Returns `None` for in-memory URLs (`sqlite::memory:`,
/// `sqlite://:memory:`) and for non-sqlite URLs — those never migrate.
/// Mirrors the forms sqlx-sqlite accepts:
/// `sqlite:relative/path.db?mode=rwc`, `sqlite:///abs/path.db`, …
pub fn sqlite_file_from_url(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("sqlite:")?;
    let rest = rest.strip_prefix("//").unwrap_or(rest);
    let path = rest.split('?').next().unwrap_or_default();
    if path.is_empty() || path == ":memory:" {
        return None;
    }
    Some(PathBuf::from(path))
}

/// True when the file exists and carries the legacy C-SQLite header
/// (or is a 0-byte file — a valid empty SQLite database).
fn is_legacy_sqlite_file(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() && m.len() == 0 => return true,
        Ok(m) if !m.is_file() => return false,
        _ => {}
    }
    let mut magic = [0u8; 15];
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    use std::io::Read;
    match f.read_exact(&mut magic) {
        Ok(()) => &magic == SQLITE_MAGIC,
        Err(_) => false,
    }
}

/// Run the migration check + import for a DATABASE_URL.
///
/// Cheap when there is nothing to do (one `stat` + one 16-byte read).
/// Blocking (spawns the `sqlite3` CLI and does file I/O); call from
/// `spawn_blocking` or plain sync code.
pub fn maybe_migrate_sqlite_database_blocking(url: &str) -> anyhow::Result<Outcome> {
    let Some(path) = sqlite_file_from_url(url) else {
        return Ok(Outcome::NotNeeded);
    };
    if !is_legacy_sqlite_file(&path) {
        return Ok(Outcome::NotNeeded);
    }

    tracing::info!(
        path = %path.display(),
        "legacy C-SQLite database detected — migrating to the rustqlite engine"
    );

    let dump = dump_legacy(&path)?;
    let old_tables = list_legacy_tables(&path)?;

    // Preserve the original file before the new engine writes anything.
    let backup = backup_legacy_file(&path)?;

    let result = replay_dump(&path, &dump).and_then(|()| verify_counts(&path, &old_tables));
    match result {
        Ok(()) => {
            let rows = old_tables
                .iter()
                .map(|t| count_rows_via_engine(&path, t).unwrap_or(0))
                .sum::<i64>();
            tracing::info!(
                tables = old_tables.len(),
                rows,
                backup = %backup.display(),
                "legacy SQLite database migrated to rustqlite (original kept as backup)"
            );
            Ok(Outcome::Migrated {
                tables: old_tables.len(),
                rows,
                backup,
            })
        }
        Err(e) => {
            // Never leave a half-migrated file behind: drop the new file,
            // put the legacy one back, and fail the boot with the reason.
            let _ = remove_engine_files(&path);
            let _ = std::fs::rename(&backup, &path);
            Err(e.context("legacy SQLite → rustqlite migration failed (original file restored)"))
        }
    }
}

/// Async wrapper — runs the blocking migration on the blocking pool.
pub async fn maybe_migrate_sqlite_database(url: &str) -> anyhow::Result<Outcome> {
    let url = url.to_owned();
    tokio::task::spawn_blocking(move || maybe_migrate_sqlite_database_blocking(&url))
        .await
        .context("sqlite migration task panicked")?
}

// ── legacy-side helpers (sqlite3 CLI) ──────────────────────────────────

fn sqlite3_cli() -> Command {
    Command::new("sqlite3")
}

/// `sqlite3 -bail <path> .dump`
fn dump_legacy(path: &Path) -> anyhow::Result<String> {
    let out = sqlite3_cli()
        .arg("-bail")
        .arg(path)
        .arg(".dump")
        .output()
        .context("spawning the sqlite3 CLI to dump the legacy database")?;
    if !out.status.success() {
        bail!(
            "sqlite3 .dump failed ({}): {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// User tables (excluding SQLite internals) in the legacy file.
fn list_legacy_tables(path: &Path) -> anyhow::Result<Vec<String>> {
    let out = sqlite3_cli()
        .arg("-noheader")
        .arg(path)
        .arg("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .output()
        .context("spawning the sqlite3 CLI to list legacy tables")?;
    if !out.status.success() {
        bail!(
            "sqlite3 table listing failed ({}): {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_owned)
        .collect())
}

fn count_rows_via_cli(path: &Path, table: &str) -> anyhow::Result<i64> {
    let sql = format!("SELECT count(*) FROM {}", quote_ident(table));
    let out = sqlite3_cli()
        .arg("-noheader")
        .arg(path)
        .arg(&sql)
        .output()
        .with_context(|| format!("counting rows of table {table:?} in the legacy file"))?;
    if !out.status.success() {
        bail!(
            "sqlite3 count failed for {table}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<i64>()
        .context("sqlite3 count output not a number")
}

/// Move the legacy file aside (plus `-wal` / `-shm` siblings).
fn backup_legacy_file(path: &Path) -> anyhow::Result<PathBuf> {
    let backup = PathBuf::from(format!("{}.sqlite.bak", path.display()));
    std::fs::rename(path, &backup)
        .with_context(|| format!("renaming {} for migration backup", path.display()))?;
    for (sibling, backup_sibling) in [
        (
            format!("{}-wal", path.display()),
            format!("{}-wal", backup.display()),
        ),
        (
            format!("{}-shm", path.display()),
            format!("{}-shm", backup.display()),
        ),
    ] {
        if Path::new(&sibling).exists() {
            let _ = std::fs::rename(&sibling, &backup_sibling);
        }
    }
    Ok(backup)
}

fn remove_engine_files(path: &Path) -> anyhow::Result<()> {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    Ok(())
}

// ── engine-side helpers (C ABI into the shared compat engine) ──────────

/// Quote an identifier the SQL way (`"name"`, embedded quotes doubled).
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// A raw C-ABI connection to the rustqlite engine. Opening through the
/// compat layer (rather than the engine's Rust API directly) means the
/// replay shares the single per-path engine instance the pool will use.
struct EngineConn(*mut sq::sqlite3);

impl EngineConn {
    fn open(path: &Path) -> anyhow::Result<Self> {
        let c_path = CString::new(path.to_string_lossy().as_bytes())
            .context("database path contains a NUL byte")?;
        let mut db: *mut sq::sqlite3 = std::ptr::null_mut();
        let flags: c_int = sq::SQLITE_OPEN_READWRITE | sq::SQLITE_OPEN_CREATE;
        let rc = unsafe { sq::sqlite3_open_v2(c_path.as_ptr(), &mut db, flags, std::ptr::null()) };
        if rc != sq::SQLITE_OK {
            let msg = if db.is_null() {
                format!("sqlite3_open_v2 rc={rc}")
            } else {
                errmsg(db)
            };
            if !db.is_null() {
                unsafe { sq::sqlite3_close(db) };
            }
            bail!("engine could not open {}: {msg}", path.display());
        }
        unsafe { sq::sqlite3_busy_timeout(db, 30_000) };
        Ok(Self(db))
    }

    fn exec(&self, sql: &str) -> anyhow::Result<()> {
        let c_sql = CString::new(sql.as_bytes()).context("statement contains a NUL byte")?;
        let rc = unsafe {
            sq::sqlite3_exec(
                self.0,
                c_sql.as_ptr(),
                None,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if rc != sq::SQLITE_OK {
            let msg = errmsg(self.0);
            bail!("engine rejected {sql:?}: {msg} (rc={rc})");
        }
        Ok(())
    }

    /// `SELECT count(*) FROM <table>` through the prepare/step machinery.
    fn count(&self, table: &str) -> anyhow::Result<i64> {
        let sql = format!("SELECT count(*) FROM {}", quote_ident(table));
        let c_sql = CString::new(sql.as_bytes()).context("statement contains a NUL byte")?;
        let mut stmt: *mut sq::sqlite3_stmt = std::ptr::null_mut();
        let rc = unsafe {
            sq::sqlite3_prepare_v2(self.0, c_sql.as_ptr(), -1, &mut stmt, std::ptr::null_mut())
        };
        if rc != sq::SQLITE_OK {
            let msg = errmsg(self.0);
            if !stmt.is_null() {
                unsafe { sq::sqlite3_finalize(stmt) };
            }
            bail!("engine prepare failed for {sql:?}: {msg} (rc={rc})");
        }
        let rc = unsafe { sq::sqlite3_step(stmt) };
        let value = if rc == sq::SQLITE_ROW {
            unsafe { sq::sqlite3_column_int64(stmt, 0) }
        } else {
            let msg = errmsg(self.0);
            unsafe { sq::sqlite3_finalize(stmt) };
            bail!("engine step failed for {sql:?}: {msg} (rc={rc})");
        };
        unsafe { sq::sqlite3_finalize(stmt) };
        Ok(value)
    }
}

impl Drop for EngineConn {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { sq::sqlite3_close(self.0) };
        }
    }
}

fn errmsg(db: *mut sq::sqlite3) -> String {
    unsafe {
        let p = sq::sqlite3_errmsg(db);
        if p.is_null() {
            return String::new();
        }
        std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

/// Replay a `.dump` script into the (fresh) engine database file.
fn replay_dump(new_path: &Path, dump: &str) -> anyhow::Result<()> {
    let conn = EngineConn::open(new_path)?;
    conn.exec("BEGIN")?;
    let replay = (|| -> anyhow::Result<()> {
        for stmt in split_statements(dump) {
            // The dump wraps itself in a transaction and disables FKs for
            // the import; we manage the transaction ourselves and the
            // engine defaults FKs to OFF (SQLite's own default).
            if stmt.eq_ignore_ascii_case("BEGIN TRANSACTION")
                || stmt.eq_ignore_ascii_case("COMMIT")
                || stmt.is_empty()
            {
                continue;
            }
            conn.exec(&stmt)?;
        }
        Ok(())
    })();
    match replay {
        Ok(()) => conn
            .exec("COMMIT")
            .context("committing the migrated data")?,
        Err(e) => {
            let _ = conn.exec("ROLLBACK");
            return Err(e);
        }
    }
    Ok(())
}

/// Split a SQL script into statements on top-level semicolons.
///
/// Not line-based: `.dump` INSERTs can contain embedded newlines inside
/// string literals. Tracks `'…'` strings (`''` escapes), `"…"` identifiers
/// (`""` escapes), and `--` / `/* */` comments; only a `;` OUTSIDE any of
/// those terminates a statement.
fn split_statements(script: &str) -> Vec<String> {
    #[derive(PartialEq)]
    enum State {
        Code,
        SingleQuoted,
        DoubleQuoted,
        LineComment,
        BlockComment,
    }
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut state = State::Code;
    let mut chars = script.chars().peekable();
    while let Some(c) = chars.next() {
        match state {
            State::Code => match c {
                '\'' => {
                    cur.push(c);
                    state = State::SingleQuoted;
                }
                '"' => {
                    cur.push(c);
                    state = State::DoubleQuoted;
                }
                '-' if chars.peek() == Some(&'-') => {
                    chars.next();
                    state = State::LineComment;
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    state = State::BlockComment;
                }
                ';' => {
                    let trimmed = cur.trim();
                    if !trimmed.is_empty() {
                        out.push(trimmed.to_owned());
                    }
                    cur.clear();
                }
                _ => cur.push(c),
            },
            State::SingleQuoted => {
                // `''` is an escaped quote and stays inside the literal.
                if c == '\'' {
                    if chars.peek() == Some(&'\'') {
                        cur.push(c);
                        cur.push('\'');
                        chars.next();
                    } else {
                        cur.push(c);
                        state = State::Code;
                    }
                } else {
                    cur.push(c);
                }
            }
            State::DoubleQuoted => {
                if c == '"' {
                    if chars.peek() == Some(&'"') {
                        cur.push(c);
                        cur.push('"');
                        chars.next();
                    } else {
                        cur.push(c);
                        state = State::Code;
                    }
                } else {
                    cur.push(c);
                }
            }
            State::LineComment => {
                if c == '\n' {
                    cur.push(c);
                    state = State::Code;
                }
            }
            State::BlockComment => {
                if c == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    cur.push_str("*/");
                    state = State::Code;
                }
            }
        }
    }
    let trimmed = cur.trim();
    if !trimmed.is_empty() {
        out.push(trimmed.to_owned());
    }
    out
}

/// Compare per-table row counts between the backup (via the CLI) and the
/// new engine file (via the C ABI). Any mismatch is an error.
fn verify_counts(new_path: &Path, old_tables: &[String]) -> anyhow::Result<()> {
    // The engine file now lives at `new_path`; the legacy data moved to
    // `<new_path>.sqlite.bak`.
    let backup = PathBuf::from(format!("{}.sqlite.bak", new_path.display()));
    let conn = EngineConn::open(new_path)?;
    for table in old_tables {
        let old = count_rows_via_cli(&backup, table)?;
        let new = conn.count(table)?;
        if old != new {
            bail!(
                "row-count mismatch after migration for table {table:?}: \
                 legacy file has {old} rows, engine has {new}"
            );
        }
    }
    Ok(())
}

fn count_rows_via_engine(path: &Path, table: &str) -> anyhow::Result<i64> {
    let conn = EngineConn::open(path)?;
    conn.count(table)
}

#[cfg(test)]
impl EngineConn {
    /// `SELECT full_name, email, payload, score FROM "user" WHERE id='d4e5f6'`
    /// — used by the round-trip test to prove values survive verbatim.
    fn tricky_user_row(&self) -> (String, String, Vec<u8>, Option<f64>) {
        let sql = "SELECT full_name, email, payload, score FROM \"user\" WHERE id = 'd4e5f6'";
        let c_sql = CString::new(sql).unwrap();
        let mut stmt: *mut sq::sqlite3_stmt = std::ptr::null_mut();
        let rc = unsafe {
            sq::sqlite3_prepare_v2(self.0, c_sql.as_ptr(), -1, &mut stmt, std::ptr::null_mut())
        };
        assert_eq!(rc, sq::SQLITE_OK, "prepare failed");
        let rc = unsafe { sq::sqlite3_step(stmt) };
        assert_eq!(rc, sq::SQLITE_ROW, "expected one row");
        let text = |i: c_int| unsafe {
            let p = sq::sqlite3_column_text(stmt, i);
            if p.is_null() {
                String::new()
            } else {
                let len = sq::sqlite3_column_bytes(stmt, i) as usize;
                String::from_utf8_lossy(std::slice::from_raw_parts(p, len)).into_owned()
            }
        };
        let blob = unsafe {
            let p = sq::sqlite3_column_blob(stmt, 2);
            if p.is_null() {
                Vec::new()
            } else {
                let len = sq::sqlite3_column_bytes(stmt, 2) as usize;
                std::slice::from_raw_parts(p as *const u8, len).to_vec()
            }
        };
        let score = unsafe {
            if sq::sqlite3_column_type(stmt, 3) == sq::SQLITE_NULL {
                None
            } else {
                Some(sq::sqlite3_column_double(stmt, 3))
            }
        };
        let out = (text(0), text(1), blob, score);
        unsafe { sq::sqlite3_finalize(stmt) };
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_file(path: &Path, bytes: &[u8]) {
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(bytes).unwrap();
    }

    #[test]
    fn url_parsing_covers_the_deployed_forms() {
        // Deploy/stack forms.
        assert_eq!(
            sqlite_file_from_url("sqlite:/app/data/app.db?mode=rwc"),
            Some(PathBuf::from("/app/data/app.db"))
        );
        assert_eq!(
            sqlite_file_from_url("sqlite://./app.db?mode=rwc"),
            Some(PathBuf::from("./app.db"))
        );
        assert_eq!(
            sqlite_file_from_url("sqlite:./data/app.db"),
            Some(PathBuf::from("./data/app.db"))
        );
        // In-memory and other schemes never migrate.
        assert_eq!(sqlite_file_from_url("sqlite::memory:"), None);
        assert_eq!(sqlite_file_from_url("sqlite://:memory:"), None);
        assert_eq!(sqlite_file_from_url("postgres://u:p@h/db"), None);
    }

    #[test]
    fn legacy_header_detection() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join("legacy.db");
        let engine = dir.path().join("engine.db");

        // C-SQLite magic → detected.
        write_file(&legacy, b"SQLite format 3\0rest-of-header");
        assert!(is_legacy_sqlite_file(&legacy));

        // rustqlite magic → not legacy.
        write_file(&engine, b"RSQLDB01rest-of-header");
        assert!(!is_legacy_sqlite_file(&engine));

        // Missing / empty files.
        assert!(!is_legacy_sqlite_file(&dir.path().join("missing.db")));
        let empty = dir.path().join("empty.db");
        write_file(&empty, b"");
        assert!(
            is_legacy_sqlite_file(&empty),
            "empty file counts as migratable"
        );
    }

    #[test]
    fn statement_splitting_handles_tricky_literals() {
        let script = "CREATE TABLE t (a TEXT);\n\
                      INSERT INTO t VALUES('it''s\nmultiline; string');\n\
                      INSERT INTO \"quoted;name\" VALUES(x'0A');\n\
                      -- a comment; with a semicolon\n\
                      COMMIT";
        let stmts = split_statements(script);
        assert_eq!(stmts.len(), 4, "got: {stmts:?}");
        assert!(stmts[1].contains("multiline"));
        assert!(stmts[1].contains('\n'));
        assert_eq!(stmts[3], "COMMIT");
    }

    #[test]
    fn engine_blob_literal_round_trip() {
        // Isolated check: X'hex' literals + column_blob/bytes through the
        // compat ABI (the migration replay path stores dump blobs this way).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blob.db");
        {
            let conn = EngineConn::open(&path).unwrap();
            conn.exec("CREATE TABLE b (id INTEGER PRIMARY KEY, v BLOB)")
                .unwrap();
            conn.exec("INSERT INTO b VALUES (1, X'0A0B0C')").unwrap();
            conn.exec("INSERT INTO b VALUES (2, x'0a0b0c')").unwrap();
        }
        let conn = EngineConn::open(&path).unwrap();
        for id in [1, 2] {
            let sql = format!("SELECT v, hex(v), typeof(v) FROM b WHERE id = {id}");
            let c_sql = CString::new(sql.as_bytes()).unwrap();
            let mut stmt: *mut sq::sqlite3_stmt = std::ptr::null_mut();
            let rc = unsafe {
                sq::sqlite3_prepare_v2(conn.0, c_sql.as_ptr(), -1, &mut stmt, std::ptr::null_mut())
            };
            assert_eq!(rc, sq::SQLITE_OK, "prepare");
            let rc = unsafe { sq::sqlite3_step(stmt) };
            assert_eq!(rc, sq::SQLITE_ROW, "row");
            let blob: Vec<u8> = unsafe {
                let p = sq::sqlite3_column_blob(stmt, 0);
                if p.is_null() {
                    Vec::new()
                } else {
                    let len = sq::sqlite3_column_bytes(stmt, 0) as usize;
                    std::slice::from_raw_parts(p as *const u8, len).to_vec()
                }
            };
            let hex: String = unsafe {
                let p = sq::sqlite3_column_text(stmt, 1);
                if p.is_null() {
                    String::new()
                } else {
                    let len = sq::sqlite3_column_bytes(stmt, 1) as usize;
                    String::from_utf8_lossy(std::slice::from_raw_parts(p, len)).into_owned()
                }
            };
            let ty: String = unsafe {
                let p = sq::sqlite3_column_text(stmt, 2);
                if p.is_null() {
                    String::new()
                } else {
                    let len = sq::sqlite3_column_bytes(stmt, 2) as usize;
                    String::from_utf8_lossy(std::slice::from_raw_parts(p, len)).into_owned()
                }
            };
            unsafe { sq::sqlite3_finalize(stmt) };
            eprintln!("id={id} blob={blob:?} hex={hex:?} typeof={ty:?}");
            assert_eq!(blob, vec![0x0A, 0x0B, 0x0C], "id={id} blob bytes");
        }
    }

    // ── full round-trip tests (need the real `sqlite3` CLI in PATH) ────

    fn sqlite3_available() -> bool {
        Command::new("sqlite3")
            .arg("-version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Run SQL against a file with the real sqlite3 CLI.
    fn cli_sql(path: &Path, sql: &str) -> String {
        let out = Command::new("sqlite3")
            .arg(path)
            .arg(sql)
            .output()
            .expect("sqlite3 CLI");
        assert!(
            out.status.success(),
            "sqlite3 {sql:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// Build a realistic legacy database: an app-shaped schema with a
    /// `seaql_migrations` bookkeeping table, tricky text/blob values,
    /// and a pending WAL that the dump must fold in.
    fn make_legacy_db(path: &Path) {
        cli_sql(
            path,
            "CREATE TABLE seaql_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMP);
             INSERT INTO seaql_migrations VALUES ('m20260905_000001_create_users_auth','2026-09-05 00:00:00'),
                                                ('m20260905_000002_create_rbac','2026-09-05 00:00:00');
             CREATE TABLE \"user\" (id TEXT PRIMARY KEY, full_name TEXT, email TEXT UNIQUE, payload BLOB, score REAL);
             INSERT INTO \"user\" VALUES
               ('a1b2c3', 'Alice O''Neil', 'alice@example.com', NULL, 1.5),
               ('d4e5f6', 'B\u{1F600}b multi\nline; ''quoted'' text', 'bob@example.com', x'0A0B0C', NULL);
             CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT UNIQUE);
             INSERT INTO roles VALUES ('r1','admin'), ('r2','user');
             CREATE INDEX idx_user_email ON \"user\"(email);
             CREATE TABLE user_roles (user_id TEXT, role_id TEXT, PRIMARY KEY (user_id, role_id));
             INSERT INTO user_roles VALUES ('a1b2c3','r1');",
        );
        // Leave a pending WAL frame: uncheckpointed writes must be folded
        // into the dump by the CLI on its read-only-open path.
        cli_sql(
            path,
            "PRAGMA journal_mode=WAL;
             INSERT INTO roles VALUES ('r3','employee');",
        );
    }

    #[test]
    fn migration_round_trip_legacy_sqlite_to_engine() {
        if !sqlite3_available() {
            eprintln!("skipping: sqlite3 CLI not available in PATH");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("app.db");
        make_legacy_db(&db_path);
        let url = format!("sqlite:{}?mode=rwc", db_path.display());

        let outcome = maybe_migrate_sqlite_database_blocking(&url).expect("migration");
        let Outcome::Migrated {
            tables,
            rows,
            backup,
        } = outcome
        else {
            panic!("expected Migrated, got {outcome:?}");
        };
        assert_eq!(tables, 4, "user, roles, user_roles, seaql_migrations");
        assert_eq!(
            rows, 8,
            "2 user + 3 roles + 1 user_roles + 2 seaql_migrations rows"
        );
        assert_eq!(backup, db_path.with_file_name("app.db.sqlite.bak"));
        assert!(backup.exists(), "legacy file preserved as .bak");

        // The new file is a rustqlite engine file (format magic
        // `RSQLDB0x` — assert the family prefix, not the exact version).
        let mut magic = [0u8; 7];
        use std::io::Read;
        std::fs::File::open(&db_path)
            .unwrap()
            .read_exact(&mut magic)
            .unwrap();
        assert_eq!(&magic, b"RSQLDB0", "engine file magic");

        // Values survived verbatim — including the WAL-frame row, the
        // tricky text, the blob, and the NULLs.
        let conn = EngineConn::open(&db_path).unwrap();
        assert_eq!(conn.count("user").unwrap(), 2);
        assert_eq!(conn.count("roles").unwrap(), 3, "WAL row folded in");
        assert_eq!(conn.count("user_roles").unwrap(), 1);
        assert_eq!(conn.count("seaql_migrations").unwrap(), 2);
        let (name, email, blob, score) = conn.tricky_user_row();
        assert_eq!(name, "B\u{1F600}b multi\nline; 'quoted' text");
        assert_eq!(email, "bob@example.com");
        assert_eq!(blob, vec![0x0A, 0x0B, 0x0C]);
        assert!(score.is_none(), "NULL REAL stays NULL");

        // Idempotent: a second run is a no-op (engine file, not legacy).
        let second = maybe_migrate_sqlite_database_blocking(&url).unwrap();
        assert_eq!(second, Outcome::NotNeeded);
        assert!(backup.exists(), "backup untouched by the second run");
    }

    #[test]
    fn failed_replay_restores_the_legacy_file() {
        if !sqlite3_available() {
            eprintln!("skipping: sqlite3 CLI not available in PATH");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("app.db");
        // A legacy DB containing FTS5: its dump emits
        // `CREATE VIRTUAL TABLE … USING fts5(...)`, which the engine
        // cannot replay (module not registered) — forcing the failure
        // path so we can prove the backup/restore logic.
        cli_sql(
            &db_path,
            "CREATE TABLE keep (id INTEGER PRIMARY KEY, v TEXT);
             INSERT INTO keep VALUES (1, 'x');
             CREATE VIRTUAL TABLE fts USING fts5(body);
             INSERT INTO fts VALUES ('searchable');",
        );
        let before = std::fs::read(&db_path).unwrap();
        let url = format!("sqlite:{}?mode=rwc", db_path.display());

        let err = maybe_migrate_sqlite_database_blocking(&url)
            .expect_err("engine cannot replay fts5 DDL");
        let msg = format!("{err:#}");
        assert!(
            msg.contains("migration failed"),
            "error should explain the migration failure: {msg}"
        );

        // The legacy file is restored byte-identical and no new-format
        // file (or stray -wal/-shm) is left behind.
        assert_eq!(
            std::fs::read(&db_path).unwrap(),
            before,
            "legacy file restored"
        );
        assert!(!db_path.with_file_name("app.db.sqlite.bak").exists());
        assert!(!db_path.with_file_name("app.db-wal").exists());
        assert!(!db_path.with_file_name("app.db-shm").exists());
    }
}

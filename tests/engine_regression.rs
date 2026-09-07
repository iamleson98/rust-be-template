//! Regression: the worker's dequeue statement through the compat C ABI.
//!
//! DELETE FROM "jobs" WHERE "id" IN (SELECT "id" FROM "jobs"
//!   WHERE "available_at" <= ? ORDER BY "available_at" ASC LIMIT ?)
//!   RETURNING "id", "job_type", "payload", "attempts"
//!
//! The full test suite showed this returning no rows (worker "job did not
//! run") while literal-LIMIT variants worked — isolating the bound-param
//! LIMIT inside the IN-subquery.

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::ptr;

use libsqlite3_sys as sq;
use sea_orm::ConnectionTrait;

const SQLITE_OK: c_int = 0;
const SQLITE_ROW: c_int = 100;
const SQLITE_DONE: c_int = 101;

struct Db(*mut sq::sqlite3);
impl Drop for Db {
    fn drop(&mut self) {
        unsafe { sq::sqlite3_close(self.0) };
    }
}

fn open_memory() -> Db {
    let mut db: *mut sq::sqlite3 = ptr::null_mut();
    let rc = unsafe { sq::sqlite3_open(c_str(":memory:"), &mut db) };
    assert_eq!(rc, SQLITE_OK);
    unsafe { sq::sqlite3_extended_result_codes(db, 1) };
    Db(db)
}

fn c_str(s: &str) -> *const c_char {
    CString::new(s).unwrap().into_raw()
}

fn cstr(p: *const c_char) -> String {
    unsafe { CStr::from_ptr(p).to_string_lossy().into_owned() }
}

fn exec(db: &Db, sql: &str) {
    let rc = unsafe { sq::sqlite3_exec(db.0, c_str(sql), None, ptr::null_mut(), ptr::null_mut()) };
    assert_eq!(rc, SQLITE_OK, "exec {sql:?} failed: {}", errmsg(db.0));
}

fn errmsg(db: *mut sq::sqlite3) -> String {
    unsafe {
        let p = sq::sqlite3_errmsg(db);
        if p.is_null() {
            return String::new();
        }
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

struct Stmt(*mut sq::sqlite3_stmt);
impl Drop for Stmt {
    fn drop(&mut self) {
        unsafe { sq::sqlite3_finalize(self.0) };
    }
}

fn prepare(db: &Db, sql: &str) -> Stmt {
    let mut st: *mut sq::sqlite3_stmt = ptr::null_mut();
    let rc = unsafe { sq::sqlite3_prepare_v2(db.0, c_str(sql), -1, &mut st, ptr::null_mut()) };
    assert_eq!(rc, SQLITE_OK, "prepare {sql:?}: {}", errmsg(db.0));
    Stmt(st)
}

fn bind_text(st: &Stmt, idx: c_int, v: &str) {
    let rc = unsafe {
        sq::sqlite3_bind_text(st.0, idx, v.as_ptr() as *const c_char, v.len() as i32, None)
    };
    assert_eq!(rc, SQLITE_OK);
}

fn bind_int(st: &Stmt, idx: c_int, v: i64) {
    let rc = unsafe { sq::sqlite3_bind_int64(st.0, idx, v) };
    assert_eq!(rc, SQLITE_OK);
}

fn col_text(st: &Stmt, i: c_int) -> String {
    let p = unsafe { sq::sqlite3_column_text(st.0, i) };
    if p.is_null() {
        return "<null>".into();
    }
    cstr(p as *const c_char)
}

/// The enqueue side: INSERT with bound params (job row exactly like the
/// worker creates).
#[test]
fn worker_dequeue_delete_in_subquery_bound_limit() {
    let db = open_memory();
    exec(
        &db,
        r#"CREATE TABLE IF NOT EXISTS jobs (
                id            TEXT PRIMARY KEY,
                job_type      TEXT NOT NULL,
                payload      TEXT NOT NULL,
                attempts      INTEGER NOT NULL DEFAULT 0,
                available_at  TIMESTAMP NOT NULL,
                created_at    TIMESTAMP NOT NULL
            )"#,
    );

    // INSERT with binds (the worker's enqueue).
    let ins = prepare(
        &db,
        r#"INSERT INTO "jobs" ("id", "job_type", "payload", "attempts", "available_at", "created_at") VALUES (?, ?, ?, ?, ?, ?)"#,
    );
    bind_text(&ins, 1, "2f230c53-c600-4700-a7b2-2d661de7d694");
    bind_text(&ins, 2, "test.noop");
    bind_text(&ins, 3, "{}");
    bind_int(&ins, 4, 0);
    bind_text(&ins, 5, "2026-09-07T08:21:46.321212062");
    bind_text(&ins, 6, "2026-09-07T08:21:46.321212062");
    let rc = unsafe { sq::sqlite3_step(ins.0) };
    assert_eq!(rc, SQLITE_DONE, "insert step: {}", errmsg(db.0));

    // The worker's dequeue (LIMIT as a BOUND param).
    let sql = r#"DELETE FROM "jobs" WHERE "id" IN (SELECT "id" FROM "jobs" WHERE "available_at" <= ? ORDER BY "available_at" ASC LIMIT ?) RETURNING "id", "job_type", "payload", "attempts""#;
    let dq = prepare(&db, sql);
    let n_params = unsafe { sq::sqlite3_bind_parameter_count(dq.0) };
    assert_eq!(n_params, 2, "both ? must be discovered (subquery + LIMIT)");

    bind_text(&dq, 1, "2026-09-07T08:21:48.365990514");
    bind_int(&dq, 2, 1);

    let rc = unsafe { sq::sqlite3_step(dq.0) };
    assert_eq!(
        rc,
        SQLITE_ROW,
        "dequeue must RETURNING the due job, got rc={rc} (err: {})",
        errmsg(db.0)
    );
    assert_eq!(col_text(&dq, 0), "2f230c53-c600-4700-a7b2-2d661de7d694");
    assert_eq!(col_text(&dq, 1), "test.noop");

    // Second step: done.
    let rc = unsafe { sq::sqlite3_step(dq.0) };
    assert_eq!(rc, SQLITE_DONE);
    assert_eq!(unsafe { sq::sqlite3_changes(db.0) }, 1);
}

/// Control: identical statement with LITERAL LIMIT 1 — worked before.
#[test]
fn worker_dequeue_delete_in_subquery_literal_limit() {
    let db = open_memory();
    exec(
        &db,
        r#"CREATE TABLE IF NOT EXISTS jobs (
                id            TEXT PRIMARY KEY,
                job_type      TEXT NOT NULL,
                payload      TEXT NOT NULL,
                attempts      INTEGER NOT NULL DEFAULT 0,
                available_at  TIMESTAMP NOT NULL,
                created_at    TIMESTAMP NOT NULL
            )"#,
    );
    exec(
        &db,
        r#"INSERT INTO "jobs" VALUES ('2f230c53-c600-4700-a7b2-2d661de7d694', 'test.noop', '{}', 0, '2026-09-07T08:21:46.321212062', '2026-09-07T08:21:46.321212062')"#,
    );

    let sql = r#"DELETE FROM "jobs" WHERE "id" IN (SELECT "id" FROM "jobs" WHERE "available_at" <= ? ORDER BY "available_at" ASC LIMIT 1) RETURNING "id", "job_type", "payload", "attempts""#;
    let dq = prepare(&db, sql);
    bind_text(&dq, 1, "2026-09-07T08:21:48.365990514");
    let rc = unsafe { sq::sqlite3_step(dq.0) };
    assert_eq!(rc, SQLITE_ROW, "literal-limit control: {}", errmsg(db.0));
    assert_eq!(col_text(&dq, 0), "2f230c53-c600-4700-a7b2-2d661de7d694");
}

/// Control 2: the subquery alone (SELECT ... LIMIT ?) as a plain SELECT —
/// does the bound LIMIT work there?
#[test]
fn plain_select_in_source_bound_limit() {
    let db = open_memory();
    exec(
        &db,
        r#"CREATE TABLE "jobs" ("id" text PRIMARY KEY NOT NULL, "available_at" TIMESTAMP NOT NULL)"#,
    );
    exec(
        &db,
        r#"INSERT INTO "jobs" VALUES ('j1', '2026-09-07T08:21:46.321212062')"#,
    );

    // a) plain subquery SELECT with bound LIMIT
    let st = prepare(
        &db,
        r#"SELECT "id" FROM "jobs" WHERE "available_at" <= ? ORDER BY "available_at" ASC LIMIT ?"#,
    );
    bind_text(&st, 1, "2026-09-07T08:21:48.365990514");
    bind_int(&st, 2, 1);
    let rc = unsafe { sq::sqlite3_step(st.0) };
    assert_eq!(rc, SQLITE_ROW, "plain select bound limit: {}", errmsg(db.0));
    assert_eq!(col_text(&st, 0), "j1");

    // b) IN (subquery with bound LIMIT) as a plain SELECT
    let st2 = prepare(
        &db,
        r#"SELECT "id" FROM "jobs" WHERE "id" IN (SELECT "id" FROM "jobs" WHERE "available_at" <= ? ORDER BY "available_at" ASC LIMIT ?)"#,
    );
    bind_text(&st2, 1, "2026-09-07T08:21:48.365990514");
    bind_int(&st2, 2, 1);
    let rc = unsafe { sq::sqlite3_step(st2.0) };
    assert_eq!(
        rc,
        SQLITE_ROW,
        "select IN subquery bound limit: {}",
        errmsg(db.0)
    );
    assert_eq!(col_text(&st2, 0), "j1");
}

/// Control 3: scalar subquery in WHERE (no IN) — WHERE (SELECT COUNT ...) > 0.
#[test]
fn scalar_subquery_in_delete_where() {
    let db = open_memory();
    exec(
        &db,
        r#"CREATE TABLE "jobs" ("id" text PRIMARY KEY NOT NULL, "available_at" TIMESTAMP NOT NULL)"#,
    );
    exec(
        &db,
        r#"INSERT INTO "jobs" VALUES ('j1', '2026-09-07T08:21:46.321212062')"#,
    );
    let st = prepare(
        &db,
        r#"DELETE FROM "jobs" WHERE "id" IN (SELECT "id" FROM "jobs" WHERE "available_at" <= ?) RETURNING "id""#,
    );
    bind_text(&st, 1, "2026-09-07T08:21:48.365990514");
    let rc = unsafe { sq::sqlite3_step(st.0) };
    assert_eq!(
        rc,
        SQLITE_ROW,
        "IN subquery no ORDER/LIMIT: {}",
        errmsg(db.0)
    );
    assert_eq!(col_text(&st, 0), "j1");
}

/// The full sea-orm path: pool → raw DELETE...RETURNING → query_one →
/// row.try_get — exactly what the worker's DbBroker::dequeue does. If the
/// row read fails, print the error (the runner swallows it via tracing,
/// which is dropped in tests — that hid the worker failures' cause).
#[tokio::test]
async fn worker_dequeue_via_sea_orm() {
    let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();

    db.execute(sea_orm::Statement::from_string(
        db.get_database_backend(),
        r#"CREATE TABLE IF NOT EXISTS jobs (
                id            TEXT PRIMARY KEY,
                job_type      TEXT NOT NULL,
                payload       TEXT NOT NULL,
                attempts      INTEGER NOT NULL DEFAULT 0,
                available_at  TIMESTAMP NOT NULL,
                created_at    TIMESTAMP NOT NULL
            )"#,
    ))
    .await
    .unwrap();

    let id = "297f1733-8ec9-470d-991a-8c84b5523baa";
    let now = "2026-09-07 08:29:29.651401309";
    let ins = format!(
        r#"INSERT INTO "jobs" ("id", "job_type", "payload", "attempts", "available_at", "created_at") VALUES ('{id}', 'test.noop', '{{}}', 0, '{now}', '{now}')"#
    );
    db.execute(sea_orm::Statement::from_string(
        db.get_database_backend(),
        ins,
    ))
    .await
    .unwrap();

    // The worker's exact dequeue SQL (sea-query generated):
    // DELETE FROM "jobs" WHERE "id" IN (SELECT "id" FROM "jobs" WHERE
    // "available_at" <= ? ORDER BY "available_at" ASC LIMIT ?) RETURNING *
    let dq_sql = r#"DELETE FROM "jobs" WHERE "id" IN (SELECT "id" FROM "jobs" WHERE "available_at" <= ? ORDER BY "available_at" ASC LIMIT ?) RETURNING *"#;
    let stmt = sea_orm::Statement::from_sql_and_values(
        db.get_database_backend(),
        dq_sql,
        ["2026-09-07 08:29:29.999999999".into(), 1i32.into()],
    );

    let row = match db.query_one(stmt).await {
        Ok(Some(row)) => row,
        Ok(None) => panic!("query_one returned None — the due job was not matched"),
        Err(e) => panic!("query_one failed: {e:#}"),
    };

    let id_str: String = row.try_get("", "id").expect("try_get id");
    assert_eq!(id_str, id);
    let job_type: String = row.try_get("", "job_type").expect("try_get job_type");
    assert_eq!(job_type, "test.noop");
    let payload: String = row.try_get("", "payload").expect("try_get payload");
    assert_eq!(payload, "{}");
    let attempts: i32 = row.try_get("", "attempts").expect("try_get attempts");
    assert_eq!(attempts, 0);
}

// Silence dead-code warnings for helpers used per-test.
#[allow(dead_code)]
fn _unused(_: *const c_void) {}

/// Probe: what column names does DELETE ... RETURNING * report?
#[test]
fn probe_returning_star_column_names() {
    let db = open_memory();
    exec(
        &db,
        r#"CREATE TABLE IF NOT EXISTS jobs (
                id            TEXT PRIMARY KEY,
                job_type      TEXT NOT NULL,
                payload       TEXT NOT NULL,
                attempts      INTEGER NOT NULL DEFAULT 0,
                available_at  TIMESTAMP NOT NULL,
                created_at    TIMESTAMP NOT NULL
            )"#,
    );
    exec(
        &db,
        r#"INSERT INTO "jobs" VALUES ('297f1733-8ec9-470d-991a-8c84b5523baa', 'test.noop', '{}', 0, '2026-09-07 08:29:29.651401309', '2026-09-07 08:29:29.651401309')"#,
    );

    for sql in [
        r#"DELETE FROM "jobs" WHERE "id" IN (SELECT "id" FROM "jobs" WHERE "available_at" <= ?) RETURNING *"#,
        r#"DELETE FROM "jobs" WHERE "id" = '297f1733-8ec9-470d-991a-8c84b5523baa' RETURNING *"#,
        r#"SELECT * FROM jobs"#,
        r#"DELETE FROM "jobs" WHERE "id" = '297f1733-8ec9-470d-991a-8c84b5523baa' RETURNING "id", "job_type""#,
    ] {
        let st = prepare(&db, sql);
        let n = unsafe { sq::sqlite3_column_count(st.0) };
        let mut names = Vec::new();
        for i in 0..n {
            let p = unsafe { sq::sqlite3_column_name(st.0, i) };
            names.push(if p.is_null() {
                "<null>".to_string()
            } else {
                cstr(p)
            });
        }
        eprintln!("PROBE {sql:.60}… count={n} names={names:?}");
        let rc = unsafe { sq::sqlite3_step(st.0) };
        eprintln!(
            "      step rc={rc} col0={:?}",
            if rc == 100 {
                col_text(&st, 0)
            } else {
                "-".into()
            }
        );
    }
}

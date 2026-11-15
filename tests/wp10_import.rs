//! WP10 — the D1 → SQLite import.
//!
//! The stage database is built the way a real export is: the Worker's own
//! migrations 0000-0009, then `seed_cf.sql` (the Worker's seed script) and
//! `synthetic.sql` (a row or more in every table, shaped like D1 data), all
//! under `tests/fixtures/d1/`. The import runs on it for real: the app's
//! migrator creates the output, every row is copied and converted, and the
//! result is read back through the app's own entities, services and HTTP
//! router.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use backend::cli::import_d1::report::{Report, TableReport};
use backend::cli::import_d1::{import, run};
use chrono::{DateTime, Utc};
use sea_orm::sqlx::sqlite::SqliteConnectOptions;
use sea_orm::sqlx::{self, ConnectOptions, Connection, Executor, Row, SqliteConnection};
use serde_json::{json, Value};
use tower::ServiceExt;

const MIGRATIONS: [&str; 10] = [
    include_str!("fixtures/d1/migrations/0000_init_domain.sql"),
    include_str!("fixtures/d1/migrations/0001_fts_and_seeds.sql"),
    include_str!("fixtures/d1/migrations/0002_realtime_meeting_id.sql"),
    include_str!("fixtures/d1/migrations/0003_drizzle_baseline.sql"),
    include_str!("fixtures/d1/migrations/0004_deep_callisto.sql"),
    include_str!("fixtures/d1/migrations/0005_repair_literal_timestamps.sql"),
    include_str!("fixtures/d1/migrations/0006_drop_fts_reindex_job.sql"),
    include_str!("fixtures/d1/migrations/0007_seed_campaigns_permission.sql"),
    include_str!("fixtures/d1/migrations/0008_user_role_without_users_read.sql"),
    include_str!("fixtures/d1/migrations/0009_address_city.sql"),
];
const SEED: &str = include_str!("fixtures/d1/seed_cf.sql");
const SYNTHETIC: &str = include_str!("fixtures/d1/synthetic.sql");

/// The Worker-made hash and refresh token of WP6's fixture (Node WebCrypto
/// replica of `cloudflare/src/lib/auth/*.ts`).
const AUTH_FIXTURE: &str = include_str!("fixtures/wp6_ref_auth.json");

/// Tables the Worker has and the app has too, in the fixture.
const APP_TABLES: usize = 46;

async fn open(path: &Path, foreign_keys: bool) -> SqliteConnection {
    SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(foreign_keys)
        .disable_statement_logging()
        .connect()
        .await
        .expect("open database")
}

/// A stage database in the shape a real export produces. Loaded with
/// foreign keys ON: the fixture is valid against D1's own schema.
async fn build_stage(dir: &Path) -> PathBuf {
    let path = dir.join("stage.db");
    let mut conn = open(&path, true).await;
    for sql in MIGRATIONS.iter().chain([&SEED, &SYNTHETIC]) {
        conn.execute(*sql).await.expect("fixture SQL");
    }
    // What D1 and Cloudflare keep next to the data (`place_fts*` came with
    // migration 0001): the import must leave all of it alone.
    conn.execute(
        "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, applied_at TIMESTAMP);
         INSERT INTO d1_migrations (name) VALUES ('0000_init_domain.sql'), ('0001_fts_and_seeds.sql');
         CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID;
         INSERT INTO _cf_KV VALUES ('k', x'00');",
    )
    .await
    .expect("bookkeeping tables");
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut conn)
        .await
        .expect("foreign_key_check");
    assert!(
        violations.is_empty(),
        "the fixture breaks D1's own foreign keys"
    );
    conn.close().await.expect("close");
    path
}

async fn exec(path: &Path, sql: &str) {
    let mut conn = open(path, false).await;
    conn.execute(sql)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
    conn.close().await.expect("close");
}

async fn scalar_text(db: &mut SqliteConnection, sql: &str) -> Option<String> {
    sqlx::query(sql)
        .fetch_one(db)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
        .try_get(0)
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

async fn scalar_i64(db: &mut SqliteConnection, sql: &str) -> i64 {
    sqlx::query_scalar(sql)
        .fetch_one(db)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

fn table<'a>(report: &'a Report, name: &str) -> &'a TableReport {
    report
        .tables
        .iter()
        .find(|t| t.table == name)
        .unwrap_or_else(|| panic!("no report for {name}"))
}

/// `(reason, count)` of one table's skipped rows.
fn skipped(report: &Report, name: &str) -> Vec<(String, u64)> {
    table(report, name)
        .skipped
        .iter()
        .map(|g| (g.reason.clone(), g.count))
        .collect()
}

struct Imported {
    _dir: tempfile::TempDir,
    out: PathBuf,
    report: Report,
    started: DateTime<Utc>,
    finished: DateTime<Utc>,
}

async fn imported() -> Imported {
    let dir = tempfile::tempdir().expect("tempdir");
    let stage = build_stage(dir.path()).await;
    let out = dir.path().join("app.db");
    let started = Utc::now();
    let report = import(&stage, &out).await.expect("import");
    Imported {
        _dir: dir,
        out,
        report,
        started,
        finished: Utc::now(),
    }
}

// ── The whole fixture ────────────────────────────────────────────────

#[tokio::test]
async fn the_fixture_imports_with_every_row_accounted_for_and_every_entity_decoding() {
    let run = imported().await;
    let report = &run.report;
    assert!(report.clean, "problems: {:#?}", report.problems);

    // One report per app table, each reconciled: source rows = imported +
    // skipped + pruned + rejected.
    assert_eq!(report.tables.len(), APP_TABLES);
    for t in &report.tables {
        assert!(t.reconciled, "{} does not reconcile: {t:#?}", t.table);
        assert!(t.rejected.is_empty(), "{}: {:#?}", t.table, t.rejected);
    }

    // Counts equal everywhere except where the Rust schema cannot hold a
    // row (or the cutover plan leaves it behind). Every exception is named.
    let expected_losses: BTreeMap<&str, (u64, u64)> = [
        // (source rows, imported rows)
        ("user_roles", (4, 3)),      // D1 had no unique pair
        ("address", (4, 3)),         // longitude NULL, NOT NULL in the app
        ("schedule_point", (5, 4)),  // its address was the one left out
        ("place", (26, 2)),          // the seed's places have no osm_id
        ("route_picture", (3, 2)),   // width/height NULL, NOT NULL in the app
        ("scheduled_job", (3, 1)),   // jobs the app no longer has
        ("job_run", (3, 0)),         // cutover plan: not migrated
        ("chat_assignment", (2, 1)), // one assignment row per channel
    ]
    .into_iter()
    .collect();
    for t in &report.tables {
        let (source, imported) = expected_losses
            .get(t.table.as_str())
            .copied()
            .unwrap_or((t.source_rows, t.source_rows));
        assert_eq!(
            (t.source_rows, t.imported_rows),
            (source, imported),
            "{}",
            t.table
        );
    }
    // The Worker's RBAC seed numbers sixteen permissions one zero short of a
    // UUID, and the grants that name them the same way: padded, together.
    let repaired = "malformed UUID repaired (last group zero-padded)";
    assert_eq!(
        table(report, "permissions")
            .fixes
            .get(&format!("id: {repaired}")),
        Some(&16)
    );
    assert_eq!(
        table(report, "role_permissions")
            .fixes
            .get(&format!("permission_id: {repaired}")),
        Some(&28)
    );
    assert_eq!(table(report, "user").source_rows, 6);
    assert_eq!(
        table(report, "null_claw_exchange").source_table,
        "nullclaw_exchange"
    );
    assert_eq!(table(report, "null_claw_exchange").imported_rows, 1);

    // Why each of those rows was left out.
    assert_eq!(
        skipped(report, "user_roles"),
        [(
            "UNIQUE constraint failed: user_roles.user_id, user_roles.role_id".to_owned(),
            1
        )]
    );
    assert_eq!(
        skipped(report, "address"),
        [("NOT NULL constraint failed: address.lon".to_owned(), 1)]
    );
    assert_eq!(skipped(report, "schedule_point").len(), 1);
    assert!(skipped(report, "schedule_point")[0]
        .0
        .starts_with("dangling reference: schedule_point.address_id"));
    assert_eq!(
        skipped(report, "place"),
        [("NOT NULL constraint failed: place.osm_id".to_owned(), 24)]
    );
    assert_eq!(
        skipped(report, "chat_assignment"),
        [(
            "UNIQUE constraint failed: chat_assignment.channel_id".to_owned(),
            1
        )]
    );
    assert_eq!(table(report, "scheduled_job").pruned[0].count, 2);
    assert_eq!(skipped(report, "job_run")[0].1, 3);
    // Skipped rows are named by key.
    assert_eq!(
        table(report, "address").skipped[0].keys.len(),
        1,
        "the skipped address is listed"
    );

    // Dangling references the app schema forbids but D1 allowed are cleared,
    // the row kept.
    for (name, what) in [
        (
            "review",
            "booking_id: dangling reference to booking cleared",
        ),
        (
            "booking",
            "campaign_applied_id: dangling reference to campaign cleared",
        ),
        (
            "seat_inventory",
            "held_by_booking_id: dangling reference to booking cleared",
        ),
        (
            "null_claw_exchange",
            "assistant_message_id: dangling reference to chat_message cleared",
        ),
    ] {
        assert_eq!(
            table(report, name).fixes.get(what),
            Some(&1),
            "{name}: {what}"
        );
    }

    // The schema diff names what differs.
    let chat_assignment_unique = report
        .unique_diff
        .iter()
        .find(|d| d.table == "chat_assignment" && d.columns == ["channel_id"])
        .expect("chat_assignment channel uniqueness");
    assert!(!chat_assignment_unique.in_source);
    assert_eq!(chat_assignment_unique.rows_skipped, 1);
    let coupon_code = report
        .unique_diff
        .iter()
        .find(|d| d.table == "coupon" && d.columns == ["code"])
        .expect("coupon code uniqueness");
    assert!(coupon_code.in_source, "D1 enforced coupon codes too");
    let not_null: Vec<_> = report
        .nullability_diff
        .iter()
        .map(|d| (d.table.as_str(), d.column.as_str(), d.source_null_rows))
        .collect();
    for expected in [
        ("address", "lon", 1),
        ("place", "osm_id", 24),
        ("route_picture", "width", 1),
        ("route_picture", "height", 1),
        ("route_picture", "thumb_key", 2),
    ] {
        assert!(not_null.contains(&expected), "{expected:?} in {not_null:?}");
    }
    let review_booking = report
        .fk_diff
        .iter()
        .find(|f| f.table == "review" && f.columns == ["booking_id"])
        .expect("review.booking_id");
    assert!(!review_booking.in_source, "D1 declared no such reference");
    assert_eq!(review_booking.violations, 1);
    let review_trip = report
        .fk_diff
        .iter()
        .find(|f| f.table == "review" && f.columns == ["trip_session_id"])
        .expect("review.trip_session_id");
    assert!(review_trip.in_source);
    assert_eq!(review_trip.violations, 0);
    assert_eq!(
        report
            .dropped_columns
            .iter()
            .map(|d| (d.table.as_str(), d.column.as_str(), d.non_null_rows))
            .collect::<Vec<_>>(),
        [("chat_channel", "realtime_meeting_id", 1)]
    );

    // D1 / Cloudflare bookkeeping is ignored, not lost.
    let ignored: Vec<_> = report
        .stage_only_tables
        .iter()
        .map(|t| (t.table.as_str(), t.disposition))
        .collect();
    assert!(
        ignored.contains(&("d1_migrations", "ignored")),
        "{ignored:?}"
    );
    assert!(ignored.contains(&("_cf_KV", "ignored")), "{ignored:?}");
    assert!(ignored.contains(&("place_fts", "ignored")), "{ignored:?}");
    assert!(ignored.iter().all(|(_, d)| *d == "ignored"));

    // The proofs.
    assert_eq!(report.checks.integrity_check, ["ok"]);
    assert!(report.checks.foreign_key_check.is_empty());
    assert_eq!(report.decode.len(), APP_TABLES);
    let mut out = open(&run.out, false).await;
    for d in &report.decode {
        assert_eq!(d.error, None, "{} does not decode", d.table);
        let stored = scalar_i64(&mut out, &format!("SELECT COUNT(*) FROM \"{}\"", d.table)).await;
        assert_eq!(d.rows, Some(stored as u64), "{} decoded rows", d.table);
    }
    assert_eq!(
        report
            .json_warnings
            .iter()
            .map(|w| (w.table.as_str(), w.column.as_str(), w.invalid_rows))
            .collect::<Vec<_>>(),
        [("bus_layout", "layout_data", 1)]
    );
    // The database is real SQLite, not a stage copy.
    assert_eq!(
        scalar_i64(&mut out, "SELECT COUNT(*) FROM seaql_migrations").await,
        24
    );
}

// ── Shapes ───────────────────────────────────────────────────────────

#[tokio::test]
async fn values_arrive_in_the_shape_the_app_reads_and_compares() {
    let run = imported().await;
    let mut db = open(&run.out, false).await;
    let worker = "085de57d-d6fc-4e88-bb39-b6a3906e801f";

    // UUIDs are the 16 raw bytes sqlx writes; text id columns stay text.
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT typeof(id) || length(id) FROM user WHERE email = 'worker.user@example.com'"
        )
        .await
        .as_deref(),
        Some("blob16")
    );
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT lower(hex(id)) FROM user WHERE email = 'worker.user@example.com'"
        )
        .await
        .as_deref(),
        Some(worker.replace('-', "").as_str())
    );
    assert_eq!(
        scalar_text(&mut db, "SELECT typeof(employee_id) FROM chat_assignment")
            .await
            .as_deref(),
        Some("text")
    );
    // No UUID column was left as text.
    for (table, column) in [
        ("booking", "trip_session_id"),
        ("seat_inventory", "held_by_booking_id"),
        ("coupon", "active_holder"),
        ("audit_log", "actor_id"),
    ] {
        let texts = scalar_i64(
            &mut db,
            &format!("SELECT COUNT(*) FROM {table} WHERE typeof({column}) = 'text'"),
        )
        .await;
        assert_eq!(texts, 0, "{table}.{column}");
    }

    // Entity instants: what sqlx writes for a DateTime<Utc>.
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT created_at FROM user WHERE email = 'worker.user@example.com'"
        )
        .await
        .as_deref(),
        Some("2026-10-01T08:30:15.123+00:00")
    );
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT created_at FROM user WHERE email = 'admin@example.com'"
        )
        .await
        .as_deref(),
        Some("2026-09-01T07:00:00+00:00"),
        "SQLite's own datetime('now') form is UTC"
    );
    // String columns: RFC 3339 with Z, the fraction kept only when there is one.
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT created_at FROM chat_message WHERE client_msg_id = 'c-1'"
        )
        .await
        .as_deref(),
        Some("2026-11-10T03:00:00.100Z")
    );
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT created_at FROM brand WHERE slug = 'viet-bus'"
        )
        .await
        .as_deref(),
        Some("2026-09-10T00:00:00Z")
    );
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT created_at FROM booking WHERE code = 'WP10DONE03'"
        )
        .await
        .as_deref(),
        Some("2026-11-01T08:00:00Z")
    );
    // Dates stay dates; a zone-less departure stays local time.
    let departure_date = scalar_text(
        &mut db,
        "SELECT departure_date FROM trip_session WHERE driver_name = 'Tài xế An'",
    )
    .await
    .unwrap();
    assert_eq!(departure_date.len(), 10);
    let actual = scalar_text(
        &mut db,
        "SELECT actual_departure_at FROM trip_session WHERE driver_name = 'Tài xế An'",
    )
    .await
    .unwrap();
    assert!(actual.ends_with("T06:35:00"), "{actual}");

    // The literal default text is gone everywhere, replaced by the row's
    // creation time when it has one, else the import instant.
    for t in &run.report.tables {
        for column in [
            "created_at",
            "updated_at",
            "assigned_at",
            "joined_at",
            "issued_at",
        ] {
            let has = scalar_i64(
                &mut db,
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = '{column}'",
                    t.table
                ),
            )
            .await;
            if has == 1 {
                let left = scalar_i64(
                    &mut db,
                    &format!(
                        "SELECT COUNT(*) FROM \"{}\" WHERE \"{column}\" LIKE '(datetime%'",
                        t.table
                    ),
                )
                .await;
                assert_eq!(left, 0, "{}.{column}", t.table);
            }
        }
    }
    let staff_created = scalar_text(
        &mut db,
        "SELECT created_at FROM user WHERE email = 'staff@example.com'",
    )
    .await
    .unwrap();
    let staff_created = DateTime::parse_from_rfc3339(&staff_created).expect("an RFC 3339 instant");
    assert!(
        staff_created >= run.started - chrono::Duration::seconds(1)
            && staff_created <= run.finished
    );
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT created_at FROM notification WHERE type = 'price_drop'"
        )
        .await
        .as_deref(),
        Some(run.report.import_instant.as_str())
    );
    assert!(table(&run.report, "user")
        .fixes
        .contains_key("created_at: literal default replaced"));
    // A literal in a column next to a real created_at takes that time.
    // (job_run.created_at etc. are covered by the loop above.)

    // days_of_week: the JSON arrays became masks, Monday first.
    let masks: Vec<(String, Option<String>)> = sqlx::query("SELECT departure_time, days_of_week FROM schedule WHERE route_id IN (SELECT id FROM route WHERE name LIKE '%Việt Bus%') ORDER BY departure_time")
        .fetch_all(&mut db)
        .await
        .unwrap()
        .iter()
        .map(|r| (r.get(0), r.get(1)))
        .collect();
    assert_eq!(
        masks,
        [
            ("06:30".into(), Some("1111111".into())),
            ("14:00".into(), Some("1111100".into())),
            ("22:00".into(), Some("0000011".into())),
        ]
    );
    assert_eq!(
        scalar_i64(
            &mut db,
            "SELECT COUNT(*) FROM schedule WHERE days_of_week IS NULL"
        )
        .await,
        7,
        "the seed's empty arrays mean every day"
    );

    // Stop kinds and order: the app's names, counting from 0.
    let stops: Vec<(i64, String)> = sqlx::query(
        "SELECT sp.stop_order, sp.kind FROM schedule_point sp JOIN schedule s ON s.id = sp.schedule_id \
         WHERE s.departure_time = '06:30' ORDER BY sp.stop_order",
    )
    .fetch_all(&mut db)
    .await
    .unwrap()
    .iter()
    .map(|r| (r.get(0), r.get(1)))
    .collect();
    assert_eq!(
        stops,
        [
            (0, "pickup".to_owned()),
            (1, "middle".to_owned()),
            (2, "drop".to_owned())
        ]
    );

    // Pictures: a legacy one without a thumbnail is its own thumbnail; the
    // one without dimensions could not be held.
    let legacy: (String, String, i64, i64) = {
        let r = sqlx::query("SELECT storage_key, thumb_key, size_bytes, thumb_bytes FROM route_picture WHERE sort_order = 1")
            .fetch_one(&mut db)
            .await
            .unwrap();
        (r.get(0), r.get(1), r.get(2), r.get(3))
    };
    assert_eq!((legacy.0.as_str(), legacy.2), (legacy.1.as_str(), legacy.3));
    assert_eq!(
        scalar_i64(
            &mut db,
            "SELECT COUNT(*) FROM route_picture WHERE sort_order = 2"
        )
        .await,
        0
    );
    assert!(
        legacy.0.starts_with("routes/") && legacy.0.ends_with(".jpg"),
        "keys are the R2 keys"
    );

    // Coordinates the Worker stored as text are numbers.
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT typeof(pickup_lat) FROM booking WHERE code = 'WP10PEND01'"
        )
        .await
        .as_deref(),
        Some("real")
    );
    // JSON and comma lists are copied as they are: the app reads both.
    assert_eq!(scalar_text(&mut db, "SELECT amenities FROM schedule WHERE departure_time = '14:00' AND amenities IS NOT NULL AND days_of_week = '1111100'").await.as_deref(), Some("wifi,water"));
    assert_eq!(
        scalar_text(&mut db, "SELECT tags FROM review WHERE rating = 5")
            .await
            .as_deref(),
        Some("wifi,sạch sẽ")
    );
    assert_eq!(
        scalar_text(&mut db, "SELECT tags FROM review WHERE rating = 3")
            .await
            .as_deref(),
        Some(r#"["late"]"#)
    );

    // The Worker's seed row has no next run, and the scheduler never fires
    // such a row: it gets the next occurrence of its time of day (00:10 at
    // UTC+7), as a freshly seeded schedule would.
    let next = scalar_text(
        &mut db,
        "SELECT next_run_at FROM scheduled_job WHERE job_type = 'coupons.expire'",
    )
    .await
    .unwrap();
    assert!(next.ends_with("T17:10:00Z"), "{next}");
    let next = DateTime::parse_from_rfc3339(&next).unwrap();
    assert!(
        next > run.started && next <= run.finished + chrono::Duration::hours(24),
        "{next}"
    );

    // The assignment kept is the active one.
    assert_eq!(
        scalar_i64(
            &mut db,
            "SELECT COUNT(*) FROM chat_assignment WHERE unassigned_at IS NULL"
        )
        .await,
        1
    );
    // Hashes and tokens are copied as they are.
    let fixture: Value = serde_json::from_str(AUTH_FIXTURE).unwrap();
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT password_hash FROM user WHERE email = 'worker.user@example.com'"
        )
        .await
        .as_deref(),
        fixture["passwordHash"].as_str()
    );
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT token_hash FROM refresh_tokens WHERE revoked = 0"
        )
        .await
        .as_deref(),
        fixture["refreshTokenHash"].as_str()
    );
}

// ── Seeds ────────────────────────────────────────────────────────────

#[tokio::test]
async fn d1s_roles_and_vehicle_types_replace_the_migrators_seeds_and_references_hold() {
    let run = imported().await;
    let mut db = open(&run.out, false).await;
    assert_eq!(
        scalar_text(
            &mut db,
            "SELECT lower(hex(id)) FROM roles WHERE name = 'admin'"
        )
        .await
        .as_deref(),
        Some("0000000000004000a000000000000001")
    );
    // Every user_roles / role_permissions reference resolves.
    for sql in [
        "SELECT COUNT(*) FROM user_roles ur LEFT JOIN roles r ON r.id = ur.role_id WHERE r.id IS NULL",
        "SELECT COUNT(*) FROM role_permissions rp LEFT JOIN permissions p ON p.id = rp.permission_id WHERE p.id IS NULL",
    ] {
        assert_eq!(scalar_i64(&mut db, sql).await, 0, "{sql}");
    }
    assert_eq!(
        scalar_i64(
            &mut db,
            "SELECT COUNT(*) FROM schedule s JOIN vehicle_type v ON v.id = s.vehicle_type_id"
        )
        .await,
        9,
        "the schedules that name a vehicle type still find it"
    );
    // Counts match D1; the user role lost users:read in D1 (migration 0008).
    for (t, n) in [
        ("roles", 3),
        ("permissions", 32),
        ("role_permissions", 58),
        ("vehicle_type", 5),
    ] {
        assert_eq!(table(&run.report, t).source_rows, n);
        assert_eq!(table(&run.report, t).imported_rows, n);
        assert_eq!(table(&run.report, t).restored_rows, 0);
    }
    assert_eq!(
        scalar_i64(
            &mut db,
            "SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id \
             JOIN permissions p ON p.id = rp.permission_id WHERE r.name = 'user' AND p.name = 'users:read'"
        )
        .await,
        0
    );
    assert_eq!(run.report.seeds.replaced["roles"], 3);
    assert!(run.report.seeds.restored.is_empty());
}

#[tokio::test]
async fn a_permission_the_app_needs_and_d1_lacked_is_kept_with_its_grants() {
    let dir = tempfile::tempdir().unwrap();
    let stage = build_stage(dir.path()).await;
    exec(
        &stage,
        "DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'admin:campaigns:manage');
         DELETE FROM permissions WHERE name = 'admin:campaigns:manage';",
    )
    .await;
    let out = dir.path().join("app.db");
    let report = import(&stage, &out).await.expect("import");
    assert!(report.clean, "{:#?}", report.problems);
    assert_eq!(table(&report, "permissions").source_rows, 31);
    assert_eq!(table(&report, "permissions").imported_rows, 31);
    assert_eq!(table(&report, "permissions").restored_rows, 1);
    assert!(report
        .seeds
        .restored
        .contains(&"permission admin:campaigns:manage".to_owned()));
    let mut db = open(&out, false).await;
    assert_eq!(
        scalar_i64(
            &mut db,
            "SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id \
             JOIN permissions p ON p.id = rp.permission_id \
             WHERE r.name = 'admin' AND p.name = 'admin:campaigns:manage'"
        )
        .await,
        1,
        "the admin keeps the permission"
    );
    assert_eq!(table(&report, "role_permissions").restored_rows, 1);
}

// ── Derived counters ─────────────────────────────────────────────────

#[tokio::test]
async fn derived_counters_are_recomputed_from_the_rows_that_arrived() {
    let run = imported().await;
    let mut db = open(&run.out, false).await;
    // The Worker's counter said 3; the inventory holds 2 seats still for sale.
    let seats = |trip: &'static str| {
        format!("SELECT available_seats FROM trip_session t WHERE t.total_seats = {trip}")
    };
    assert_eq!(
        scalar_i64(
            &mut db,
            &seats("4 AND t.departure_date = date('now','+3 days')")
        )
        .await,
        2
    );
    // A trip without an inventory keeps its capacity; so does a past one.
    assert_eq!(scalar_i64(&mut db, &seats("16")).await, 16);
    assert_eq!(
        scalar_i64(&mut db, &seats("4 AND t.status = 'completed'")).await,
        4
    );
    let counter = run
        .report
        .derived
        .iter()
        .find(|d| d.table == "trip_session" && d.column == "available_seats")
        .expect("available_seats");
    assert_eq!((counter.considered, counter.changed), (1, 1));

    // A brand's rating follows its approved reviews (5 and 3 -> 4.0); a
    // brand with none keeps the one it had.
    let rating = |slug: &'static str| format!("SELECT rating FROM brand WHERE slug = '{slug}'");
    let r: f64 = sqlx::query_scalar(&rating("phuong-trang"))
        .fetch_one(&mut db)
        .await
        .unwrap();
    assert!((r - 4.0).abs() < f64::EPSILON, "{r}");
    let r: f64 = sqlx::query_scalar(&rating("viet-bus"))
        .fetch_one(&mut db)
        .await
        .unwrap();
    assert!((r - 4.2).abs() < f64::EPSILON, "{r}");
    let r: f64 = sqlx::query_scalar(&rating("thanh-buoi"))
        .fetch_one(&mut db)
        .await
        .unwrap();
    assert!((r - 4.4).abs() < f64::EPSILON, "{r}");
    let counter = run
        .report
        .derived
        .iter()
        .find(|d| d.table == "brand")
        .expect("brand.rating");
    assert_eq!((counter.considered, counter.changed), (1, 1));
}

// ── The imported database, driven through the app ────────────────────

fn boot_env(database: &Path) {
    let _ = dotenvy::dotenv();
    std::env::set_var(
        "DATABASE_URL",
        format!("sqlite://{}?mode=rwc", database.display()),
    );
    let fixture: Value = serde_json::from_str(AUTH_FIXTURE).unwrap();
    // The Worker's secret and issuer: its sessions must carry over.
    std::env::set_var("JWT_SECRET", fixture["jwtSecret"].as_str().unwrap());
    std::env::set_var("JWT_ISSUER", fixture["issuer"].as_str().unwrap());
    std::env::set_var("CORS_ORIGINS", "https://wp10.test");
    std::env::set_var("RATE_LIMIT_RPM", "100000");
    std::env::set_var("RATE_LIMIT_BURST", "100000");
    std::env::set_var("COOKIE_SECURE", "false");
    std::env::set_var("CACHE_BACKEND", "moka");
    std::env::set_var("WORKER_BACKEND", "db");
    std::env::set_var("SCHEDULER_ENABLED", "false");
    std::env::set_var("SEARCH_INDEX_DIR", "");
    std::env::set_var("AUDIO_CALL_ENABLED", "false");
    std::env::set_var("NULLCLAW_ENABLED", "false");
    std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
    std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
    std::env::set_var("STORAGE_BACKEND", "local");
    std::env::set_var(
        "STORAGE_LOCAL_ROOT",
        std::env::temp_dir().join(format!("wp10-storage-{}", std::process::id())),
    );
    std::env::remove_var("STORAGE_PUBLIC_BASE_URL");
}

async fn login(app: &axum::Router, email: &str, password: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/login")
        .header(
            header::USER_AGENT,
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        )
        .header(header::ORIGIN, "https://wp10.test")
        .header("x-forwarded-for", "203.0.113.50")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "email": email, "password": password }).to_string(),
        ))
        .unwrap();
    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn the_imported_database_serves_logins_and_trip_search() -> anyhow::Result<()> {
    use backend::service::trip_search::{Filters, Options, Sort};

    let run = imported().await;
    boot_env(&run.out);
    let state = backend::server::bootstrap().await?;
    let app = backend::routes::build_router(state.clone());
    let fixture: Value = serde_json::from_str(AUTH_FIXTURE).unwrap();

    // The Worker's PBKDF2 hash verifies, and the row is rehashed to Argon2.
    let password = fixture["password"].as_str().unwrap();
    let (status, _) = login(&app, "worker.user@example.com", "not-the-password").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let mut db = open(&run.out, false).await;
    let sql = "SELECT password_hash FROM user WHERE email = 'worker.user@example.com'";
    assert_eq!(
        scalar_text(&mut db, sql).await.as_deref(),
        fixture["passwordHash"].as_str(),
        "a failed login leaves the stored hash alone"
    );
    let (status, body) = login(&app, "worker.user@example.com", password).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user"]["email"], "worker.user@example.com");
    let hash = scalar_text(&mut db, sql).await.unwrap();
    assert!(
        hash.starts_with("$argon2id$"),
        "rehashed on login, got {hash}"
    );

    // Trips over the imported schedules: the seed's, and the fixture's own
    // (whose trip row, imported with its inventory, shows the recomputed
    // count of seats left).
    let date = (Utc::now() + chrono::Duration::days(3))
        .format("%Y-%m-%d")
        .to_string();
    let options = Options::new(
        &date,
        Some(50),
        Some(0),
        Sort::Departure,
        Some(1),
        None,
        Filters::default(),
    )?;
    let found = state
        .public
        .search_trips("Hà Nội", "Đà Nẵng", &options)
        .await?;
    let times: Vec<_> = found
        .items
        .iter()
        .filter_map(|t| t.departure_time.clone())
        .collect();
    for expected in ["06:30", "08:00", "20:00", "21:30"] {
        assert!(
            times.contains(&expected.to_owned()),
            "{expected} in {times:?}"
        );
    }
    let imported_trip = found
        .items
        .iter()
        .find(|t| t.departure_time.as_deref() == Some("06:30"))
        .expect("the imported 06:30 trip");
    assert_eq!(imported_trip.available_seats, 2, "{imported_trip:?}");
    assert_eq!(
        scalar_i64(&mut db, "SELECT COUNT(*) FROM trip_session WHERE departure_date = date('now','+3 days') AND total_seats = 4").await,
        1,
        "search used the imported trip instead of making another"
    );
    Ok(())
}

// ── Refusals ─────────────────────────────────────────────────────────

#[tokio::test]
async fn values_the_app_cannot_read_make_the_run_unclean_and_are_listed() {
    let dir = tempfile::tempdir().unwrap();
    let stage = build_stage(dir.path()).await;
    exec(
        &stage,
        "INSERT INTO user (id, full_name, email, created_at, updated_at) VALUES \
           ('not-a-uuid', 'Bad id', 'bad-id@example.com', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'), \
           ('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', 'Bad time', 'bad-time@example.com', 'yesterday', '2026-10-01T00:00:00.000Z');",
    )
    .await;
    let out = dir.path().join("app.db");
    let report = import(&stage, &out).await.expect("the import finishes");
    assert!(!report.clean);
    let rejected: Vec<_> = table(&report, "user")
        .rejected
        .iter()
        .map(|g| (g.reason.as_str(), g.keys.clone()))
        .collect();
    assert_eq!(rejected.len(), 2, "{rejected:?}");
    assert!(rejected
        .iter()
        .any(|(r, k)| r.contains("not a 36-character UUID") && k[0].contains("not-a-uuid")));
    assert!(rejected
        .iter()
        .any(|(r, _)| r.contains("created_at: not a timestamp")));
    assert!(
        report.problems.iter().any(|p| p.contains("user: 2 row(s)")),
        "{:?}",
        report.problems
    );
    assert!(
        table(&report, "user").reconciled,
        "rejected rows are accounted for"
    );

    // The command fails, with the report on disk.
    let (out2, report_path) = (
        dir.path().join("app2.db"),
        dir.path().join("reports/report.json"),
    );
    let err = run_cli(&stage, &out2, &report_path)
        .await
        .expect_err("an unclean import fails");
    assert!(err.to_string().contains("not clean"), "{err}");
    let written: Value = serde_json::from_slice(&std::fs::read(&report_path).unwrap()).unwrap();
    assert_eq!(written["clean"], false);
    assert!(out2.exists(), "the database stays for inspection");
}

async fn run_cli(stage: &Path, out: &Path, report: &Path) -> anyhow::Result<()> {
    run(stage.to_path_buf(), out.to_path_buf(), report.to_path_buf()).await
}

#[tokio::test]
async fn a_stage_that_is_missing_or_holds_unplaced_rows_is_not_clean() {
    let dir = tempfile::tempdir().unwrap();
    let stage = build_stage(dir.path()).await;
    exec(
        &stage,
        "CREATE TABLE surprise (x); INSERT INTO surprise VALUES (1), (2); DROP TABLE ad_conversion;",
    )
    .await;
    let report = import(&stage, &dir.path().join("app.db"))
        .await
        .expect("import");
    assert!(!report.clean);
    assert!(
        report
            .problems
            .iter()
            .any(|p| p.contains("surprise") && p.contains("2 row(s)")),
        "{:?}",
        report.problems
    );
    assert!(
        report
            .problems
            .iter()
            .any(|p| p.contains("no table ad_conversion")),
        "{:?}",
        report.problems
    );
}

#[tokio::test]
async fn the_import_never_overwrites_a_database_and_leaves_nothing_behind_on_failure() {
    let dir = tempfile::tempdir().unwrap();
    let stage = build_stage(dir.path()).await;
    let existing = dir.path().join("existing.db");
    std::fs::write(&existing, b"keep me").unwrap();
    let err = import(&stage, &existing).await.expect_err("must refuse");
    assert!(err.to_string().contains("already exists"), "{err}");
    assert_eq!(std::fs::read(&existing).unwrap(), b"keep me");

    // A stage that is not a database at all.
    let junk = dir.path().join("junk.db");
    std::fs::write(&junk, b"this is not sqlite").unwrap();
    let out = dir.path().join("app.db");
    assert!(import(&junk, &out).await.is_err());
    assert!(!out.exists(), "no half-made database");
}

// ── The shell scripts ────────────────────────────────────────────────

fn script(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("scripts")
        .join(name)
}

fn have(tool: &str) -> bool {
    std::process::Command::new(tool)
        .arg("--version")
        .output()
        .is_ok()
}

struct Ran {
    ok: bool,
    stderr: String,
}

fn run_export_script(fake_db: &Path, out: &Path, extra: &[&str], env: &[(&str, &str)]) -> Ran {
    let fake = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/d1/fake-wrangler.sh");
    let mut command = std::process::Command::new("bash");
    command
        .arg(script("d1-export.sh"))
        .args(["--database", "fixture", "--out"])
        .arg(out)
        .args(extra)
        .env("WRANGLER", fake)
        .env("FAKE_D1_DB", fake_db);
    for (k, v) in env {
        command.env(k, v);
    }
    let output = command.output().expect("run d1-export.sh");
    Ran {
        ok: output.status.success(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

/// Per table: (source rows, imported rows).
fn totals(report: &Report) -> BTreeMap<String, (u64, u64)> {
    report
        .tables
        .iter()
        .map(|t| (t.table.clone(), (t.source_rows, t.imported_rows)))
        .collect()
}

#[tokio::test]
async fn the_export_script_builds_a_stage_the_import_accepts_and_notices_writes() {
    if !have("bash") || !have("sqlite3") {
        eprintln!("skipped: bash and the sqlite3 CLI are needed");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let remote = build_stage(dir.path()).await;
    let direct = import(&remote, &dir.path().join("direct.db"))
        .await
        .expect("import");

    // Table by table through the (fake) wrangler: the FTS tables and the
    // bookkeeping are left out, the place triggers dropped.
    let stage = dir.path().join("exported.db");
    let ran = run_export_script(&remote, &stage, &[], &[]);
    assert!(ran.ok, "{}", ran.stderr);
    let mut conn = open(&stage, false).await;
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    for left_out in [
        "d1_migrations",
        "_cf_KV",
        "place_fts",
        "place_fts_data",
        "place_ai",
    ] {
        assert!(
            !names.iter().any(|n| n == left_out),
            "{left_out} is in the stage"
        );
    }
    assert!(names.iter().any(|n| n == "place") && names.iter().any(|n| n == "nullclaw_exchange"));
    conn.close().await.unwrap();

    let report = import(&stage, &dir.path().join("from-script.db"))
        .await
        .expect("import");
    assert!(report.clean, "{:#?}", report.problems);
    assert_eq!(
        totals(&report),
        totals(&direct),
        "same rows as importing the remote itself"
    );

    // It never overwrites a stage.
    let again = run_export_script(&remote, &stage, &[], &[]);
    assert!(
        !again.ok && again.stderr.contains("already exists"),
        "{}",
        again.stderr
    );

    // A write that lands while the export runs fails it (the freeze did not
    // hold), unless a dry run says that is fine.
    let late = "INSERT INTO ad_conversion (id, event, transaction_id, status, created_at) VALUES \
                ('99999999-9999-4999-8999-999999999999', 'late', 'late', 'pending', '2026-11-15T00:00:00.000Z')";
    for (name, extra, should_pass) in [
        ("strict", &[][..], false),
        ("dry-run", &["--allow-writes"][..], true),
    ] {
        let remote_copy = dir.path().join(format!("remote-{name}.db"));
        std::fs::copy(&remote, &remote_copy).unwrap();
        let out = dir.path().join(format!("{name}.db"));
        let ran = run_export_script(&remote_copy, &out, extra, &[("FAKE_D1_WRITE", late)]);
        assert_eq!(ran.ok, should_pass, "{name}: {}", ran.stderr);
        assert!(
            ran.stderr.contains("ad_conversion"),
            "{name}: {}",
            ran.stderr
        );
        assert_eq!(
            out.exists(),
            should_pass,
            "{name}: a failed export leaves no stage"
        );
    }
}

/// The object keys the imported database points at.
async fn referenced_keys(db: &Path) -> Vec<String> {
    let mut conn = open(db, false).await;
    let keys = sqlx::query_scalar(
        "SELECT storage_key FROM route_picture UNION SELECT thumb_key FROM route_picture \
         UNION SELECT substr(logo_url, length('/api/media/') + 1) FROM brand WHERE logo_url LIKE '/api/media/%'",
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    keys
}

#[tokio::test]
async fn the_sync_script_proves_every_object_the_database_points_at_is_there() {
    if !have("bash") || !have("sqlite3") {
        eprintln!("skipped: bash and the sqlite3 CLI are needed");
        return;
    }
    let run = imported().await;
    let uploads = tempfile::tempdir().unwrap();
    let keys = referenced_keys(&run.out).await;
    // Two pictures (the legacy one is its own thumbnail) and one logo.
    assert_eq!(keys.len(), 4, "{keys:?}");
    assert!(keys.iter().any(|k| k.starts_with("brands/logos/")));
    for key in &keys[1..] {
        let path = uploads.path().join(key);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }
    let check = |dest: &Path| {
        std::process::Command::new("bash")
            .arg(script("r2-sync.sh"))
            .args(["--check-only", "--check-db"])
            .arg(&run.out)
            .arg("--dest")
            .arg(dest)
            .output()
            .expect("run r2-sync.sh")
    };
    let missing = check(uploads.path());
    assert!(!missing.status.success());
    let stderr = String::from_utf8_lossy(&missing.stderr);
    assert!(
        stderr.contains(&format!("missing: {}", keys[0])),
        "{stderr}"
    );
    assert_eq!(stderr.matches("missing:").count(), 1, "{stderr}");

    let path = uploads.path().join(&keys[0]);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, b"x").unwrap();
    let complete = check(uploads.path());
    assert!(
        complete.status.success(),
        "{}",
        String::from_utf8_lossy(&complete.stderr)
    );
}

#[test]
fn the_sync_script_copies_with_the_keys_unchanged_and_keeps_the_secret_off_the_command_line() {
    if !have("bash") {
        eprintln!("skipped: bash is needed");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("bin");
    std::fs::create_dir(&bin).unwrap();
    let log = dir.path().join("rclone.log");
    // A recording stand-in for rclone.
    let stub = bin.join("rclone");
    std::fs::write(
        &stub,
        format!(
            "#!/usr/bin/env bash\necho \"$*\" >> '{log}'\necho \"endpoint=$RCLONE_S3_ENDPOINT provider=$RCLONE_S3_PROVIDER\" >> '{log}'\n",
            log = log.display()
        ),
    )
    .unwrap();
    std::process::Command::new("chmod")
        .arg("+x")
        .arg(&stub)
        .status()
        .unwrap();
    let dest = dir.path().join("uploads");
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let output = std::process::Command::new("bash")
        .arg(script("r2-sync.sh"))
        .arg("--dest")
        .arg(&dest)
        .env("PATH", path)
        .env("R2_ACCOUNT_ID", "acct123")
        .env("R2_ACCESS_KEY_ID", "key-id")
        .env("R2_SECRET_ACCESS_KEY", "s3cr3t-value")
        .output()
        .expect("run r2-sync.sh");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let recorded = std::fs::read_to_string(&log).unwrap();
    let dest_arg = dest.display().to_string();
    assert!(
        recorded.contains(&format!(
            "copy --size-only --transfers 8 :s3:datxevui-uploads {dest_arg}"
        )),
        "{recorded}"
    );
    assert!(
        recorded.contains(&format!(
            "check --one-way --size-only :s3:datxevui-uploads {dest_arg}"
        )),
        "{recorded}"
    );
    assert!(
        recorded.contains("endpoint=https://acct123.r2.cloudflarestorage.com provider=Cloudflare"),
        "{recorded}"
    );
    assert!(
        !recorded.contains("s3cr3t-value") && !recorded.contains("key-id"),
        "credentials on a command line"
    );
    assert!(dest.is_dir(), "the destination is created");

    // Refused without credentials; refused for a dangerous destination.
    let no_creds = std::process::Command::new("bash")
        .arg(script("r2-sync.sh"))
        .arg("--dest")
        .arg(&dest)
        .env_remove("R2_ACCOUNT_ID")
        .output()
        .unwrap();
    assert!(!no_creds.status.success());
    let root = std::process::Command::new("bash")
        .arg(script("r2-sync.sh"))
        .args(["--dest", "/"])
        .output()
        .unwrap();
    assert!(!root.status.success());
}

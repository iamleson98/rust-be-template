//! staff_presence_state upsert integration — the production regression
//! guard for the rust-sql column-level-PK autoindex bug (2026-09-10).
//!
//! The engine's reopen path (`rebuild_implicit_indexes`) used to skip
//! column-level `PRIMARY KEY` constraints, so the implicit autoindex of
//! `staff_presence_state` (`user_id uuid_text NOT NULL PRIMARY KEY`)
//! vanished from the catalog after every process restart. Symptoms in
//! production: every presence-journal flush failed with "ON CONFLICT
//! clause does not match any PRIMARY KEY or UNIQUE constraint", and —
//! far worse — duplicate PK rows were silently ACCEPTED for the whole
//! session (the unique check only walks loaded indexes).
//!
//! These tests run the REAL store path (sea-orm `Entity::insert()
//! .on_conflict()`) against a fully-migrated engine, including a
//! close-and-reopen cycle that mirrors a deploy reboot.

#[used]
static ENGINE_LINK: fn() -> &'static str = sqlite3::engine_version;

use sea_orm::Database;
use sea_orm::{ConnectionTrait, EntityTrait};
use sea_orm_migration::MigratorTrait;

use backend::entity::staff_presence_state;
use backend::store::{DbStaffPresenceStore, StaffPresenceStore, StaffPresenceUpsert};

/// In-memory: the happy path (also what a same-session create+use sees).
#[tokio::test]
async fn presence_upsert_memory() -> anyhow::Result<()> {
    let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
    opts.max_connections(1);
    let db = Database::connect(opts).await?;
    migrator::Migrator::up(&db, None).await?;
    exercise_store(&db).await
}

/// FILE + close + REOPEN — the production shape: the schema was created
/// by an earlier process (deploy migration), the app opens the file at
/// boot. The autoindex must be rebuilt from the table's DDL; before the
/// engine fix this exact sequence lost it.
#[tokio::test]
async fn presence_upsert_after_file_reopen() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("staff_presence_reopen.db");
    let url = format!("sqlite://{}?mode=rwc", path.display());

    // Session 1: create the schema (the deploy's migration run).
    {
        let mut opts = sea_orm::ConnectOptions::new(url.clone());
        opts.max_connections(1);
        let db = Database::connect(opts).await?;
        migrator::Migrator::up(&db, None).await?;
        db.close().await?;
    }

    // Session 2: reopen the file (the app boot after the deploy).
    let mut opts = sea_orm::ConnectOptions::new(url);
    opts.max_connections(1);
    let db = Database::connect(opts).await?;

    // The implicit autoindex must be in the catalog right after open.
    let idx = db
        .query_all(sea_orm::Statement::from_string(
            db.get_database_backend(),
            "SELECT name FROM sqlite_master \
             WHERE type='index' AND name='sqlite_autoindex_staff_presence_state_1'",
        ))
        .await?;
    assert_eq!(idx.len(), 1, "PK autoindex row must exist in sqlite_master");

    exercise_store(&db).await
}

/// The real store path: insert → conflict-update → re-online, plus the
/// duplicate-PK rejection (the silent-corruption half of the bug).
async fn exercise_store(db: &sea_orm::DatabaseConnection) -> anyhow::Result<()> {
    let store = DbStaffPresenceStore::new(std::sync::Arc::new(db.clone()));
    let uid = uuid::Uuid::new_v4();
    let mk = |name: &str, online: bool| StaffPresenceUpsert {
        user_id: uid,
        name: name.to_string(),
        role: "employee".into(),
        brand_id: None,
        online,
        last_seen_at: "2026-09-10T10:00:00Z".into(),
        last_online_at: online.then(|| "2026-09-10T10:00:00Z".to_string()),
    };

    // Insert (fresh row).
    store.upsert(mk("First", true)).await?;

    // Upsert (conflict path) — the exact prod failure.
    store.upsert(mk("Second", false)).await?;

    // Back online with a fresh stint.
    store.upsert(mk("Third", true)).await?;

    // Final state: exactly ONE row with the last write's values.
    let row = db
        .query_one(sea_orm::Statement::from_string(
            db.get_database_backend(),
            "SELECT name, online FROM staff_presence_state",
        ))
        .await?
        .expect("row must exist");
    let name: String = row.try_get("", "name")?;
    let online: i64 = row.try_get("", "online")?;
    assert_eq!(name, "Third", "conflict updates must apply in place");
    assert_eq!(online, 1);
    let rows = db
        .query_all(sea_orm::Statement::from_string(
            db.get_database_backend(),
            "SELECT user_id FROM staff_presence_state",
        ))
        .await?;
    assert_eq!(rows.len(), 1, "upsert must never append a second row");

    // The corruption half: a duplicate PK insert must be REJECTED. The
    // insert goes through the SAME typed path as the store (sea-orm binds
    // the Uuid natively — the compat layer stores it as a 16-byte BLOB,
    // so a raw TEXT-literal insert would NOT be a true duplicate).
    let dup_model = staff_presence_state::ActiveModel {
        user_id: sea_orm::Set(uid),
        name: sea_orm::Set("dupe".into()),
        role: sea_orm::Set("employee".into()),
        brand_id: sea_orm::Set(None),
        online: sea_orm::Set(1),
        last_seen_at: sea_orm::Set("2026-09-10T10:00:00Z".into()),
        last_online_at: sea_orm::Set(None),
    };
    let res = staff_presence_state::Entity::insert(dup_model)
        .exec(db)
        .await;
    assert!(
        res.is_err(),
        "duplicate column-level PK must be rejected — before the engine \
         fix the unique check was silently SKIPPED after a reopen"
    );
    Ok(())
}

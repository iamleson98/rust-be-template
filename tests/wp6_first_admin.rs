//! WP6 — the first admin is chosen atomically.
//!
//! The first human account becomes `admin`, everyone else a `user`. The role
//! is decided inside the INSERT of a write transaction, so simultaneous
//! first signups cannot both win. Runs on a real WAL database file (the
//! production shape: `BEGIN CONCURRENT`), in its own process so the database
//! starts without a human account.

use std::sync::Arc;

use backend::auth::account::{NewAccount, NewBot};
use backend::service::auth_service::RegisterInput;
use backend::store::{DbUserStore, UserStore};
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

const PARALLEL: usize = 20;

/// The environment is process-wide: one boot at a time.
static BOOT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn boot() -> anyhow::Result<(tempfile::TempDir, backend::state::AppState)> {
    let _one_at_a_time = BOOT.lock().await;
    let dir = tempfile::tempdir()?;
    let _ = dotenvy::dotenv();
    std::env::set_var(
        "DATABASE_URL",
        format!("sqlite://{}?mode=rwc", dir.path().join("wp6.db").display()),
    );
    std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
    std::env::set_var("COOKIE_SECURE", "false");
    std::env::set_var("CACHE_BACKEND", "moka");
    std::env::set_var("WORKER_BACKEND", "db");
    std::env::set_var("SCHEDULER_ENABLED", "false");
    std::env::set_var("AUDIO_CALL_ENABLED", "false");
    std::env::set_var("NULLCLAW_ENABLED", "false");
    std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
    std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
    std::env::set_var("STORAGE_BACKEND", "local");
    std::env::set_var(
        "STORAGE_LOCAL_ROOT",
        dir.path().join("storage").to_str().unwrap(),
    );
    std::env::remove_var("STORAGE_PUBLIC_BASE_URL");
    let state = backend::server::bootstrap().await?;
    Ok((dir, state))
}

async fn count(state: &backend::state::AppState, sql: &str) -> i64 {
    state
        .db
        .query_one(Statement::from_string(DatabaseBackend::Sqlite, sql))
        .await
        .expect("count")
        .expect("a row")
        .try_get_by_index(0)
        .expect("a number")
}

#[tokio::test]
async fn twenty_parallel_registrations_make_exactly_one_admin() -> anyhow::Result<()> {
    let (_dir, state) = boot().await?;

    // First the store alone: the transaction is what must be atomic, so
    // this races the INSERTs themselves (no hashing in between).
    let store = Arc::new(DbUserStore::new(state.db.clone()));
    let mut tasks = Vec::new();
    for i in 0..PARALLEL {
        let store = store.clone();
        tasks.push(tokio::spawn(async move {
            store
                .register_account(
                    NewAccount {
                        full_name: format!("Racer {i}"),
                        email: Some(format!("racer{i}@example.com")),
                        phone: None,
                        password_hash: "not-a-real-hash".into(),
                        locale: "vi".into(),
                    },
                    NewBot {
                        email: "nullclaw_agent@example.com".into(),
                        full_name: "nullclaw_agent".into(),
                        password_hash: "hashed_password".into(),
                    },
                )
                .await
        }));
    }
    let mut roles = Vec::new();
    for task in tasks {
        roles.push(task.await?.expect("register").role);
    }
    assert_eq!(
        roles.iter().filter(|r| *r == "admin").count(),
        1,
        "exactly one admin among {roles:?}"
    );
    assert_eq!(roles.iter().filter(|r| *r == "user").count(), PARALLEL - 1);
    assert_eq!(
        count(&state, "SELECT COUNT(*) FROM \"user\" WHERE role = 'admin'").await,
        1
    );
    // The bot was seeded once, flagged, and holds the employee role.
    assert_eq!(
        count(
            &state,
            "SELECT COUNT(*) FROM \"user\" WHERE is_bot = 1 AND role = 'employee' \
             AND email = 'nullclaw_agent@example.com'"
        )
        .await,
        1
    );
    // Every human holds exactly the grant of their role.
    assert_eq!(
        count(
            &state,
            "SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id \
             JOIN \"user\" u ON u.id = ur.user_id WHERE u.is_bot = 0 AND r.name = u.role"
        )
        .await,
        PARALLEL as i64
    );
    Ok(())
}

#[tokio::test]
async fn the_bot_never_counts_as_the_first_human() -> anyhow::Result<()> {
    let (_dir, state) = boot().await?;
    // A database holding only the bot (every human deleted) still promotes
    // the next registrant.
    state
        .db
        .execute_unprepared(
            "INSERT INTO \"user\" (id, full_name, email, role, is_bot, created_at, updated_at) \
             VALUES (x'00000000000000000000000000000001', 'bot', 'nullclaw_agent@example.com', \
             'employee', 1, '2026-01-01 00:00:00+00:00', '2026-01-01 00:00:00+00:00')",
        )
        .await?;
    let first = state
        .auth
        .register(RegisterInput {
            full_name: "First Human".into(),
            email: Some("first@example.com".into()),
            phone: None,
            password: "correct-horse-battery".into(),
            locale: None,
        })
        .await?;
    assert_eq!(first.role, "admin");
    let second = state
        .auth
        .register(RegisterInput {
            full_name: "Second Human".into(),
            email: Some("second@example.com".into()),
            phone: None,
            password: "correct-horse-battery".into(),
            locale: None,
        })
        .await?;
    assert_eq!(second.role, "user");
    // The existing bot row was reused, not duplicated.
    assert_eq!(
        count(
            &state,
            "SELECT COUNT(*) FROM \"user\" WHERE email = 'nullclaw_agent@example.com'"
        )
        .await,
        1
    );
    Ok(())
}

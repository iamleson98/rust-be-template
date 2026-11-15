//! WP6 — auth parity with the Cloudflare Worker.
//!
//! Drives the real router and service graph over an in-memory database:
//! PBKDF2 imports and the rehash, account lockout, equalised timing,
//! OAuth linking onto an unverified password account, display-name length
//! in characters, phone-only registration, logout ownership, the mobile
//! 90-day session, a deleted user's token, and tokens minted by the
//! Worker with the same JWT secret.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use backend::auth::account::PasswordRehash;
use backend::auth::oauth::OAuthProfile;
use backend::entity::{refresh_tokens, user};
use backend::store::{DbUserStore, UserStore};
use sea_orm::{ConnectionTrait, DatabaseBackend, EntityTrait, Statement};
use serde_json::{json, Value};
use tower::ServiceExt;
use uuid::Uuid;

/// Worker-made hash, refresh token and access token (Node WebCrypto replica of
/// `cloudflare/src/lib/auth/*.ts`), see `tests/fixtures/wp6_ref_auth.json`.
const FIXTURE: &str = include_str!("fixtures/wp6_ref_auth.json");

const ORIGIN: &str = "https://wp6.test";
const BROWSER_UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)";
const PASSWORD: &str = "correct-horse-battery";
/// `AUTH_LOCKOUT_MAX_FAILURES` of this test process.
const MAX_FAILURES: i64 = 3;

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("fixture")
}

async fn boot() -> anyhow::Result<(axum::Router, backend::state::AppState)> {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = dotenvy::dotenv();
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
        // The Worker's secret and issuer: its sessions must carry over.
        std::env::set_var("JWT_SECRET", fixture()["jwtSecret"].as_str().unwrap());
        std::env::set_var("JWT_ISSUER", fixture()["issuer"].as_str().unwrap());
        std::env::set_var("AUTH_LOCKOUT_MAX_FAILURES", MAX_FAILURES.to_string());
        std::env::set_var("AUTH_LOCKOUT_SECS", "900");
        std::env::set_var("CORS_ORIGINS", ORIGIN);
        std::env::set_var("RATE_LIMIT_RPM", "100000");
        std::env::set_var("RATE_LIMIT_BURST", "100000");
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
            std::env::temp_dir()
                .join(format!("wp6-storage-{}", Uuid::new_v4()))
                .to_str()
                .unwrap(),
        );
        std::env::remove_var("STORAGE_PUBLIC_BASE_URL");
    });
    let state = backend::server::bootstrap().await?;
    Ok((backend::routes::build_router(state.clone()), state))
}

// ── HTTP helpers ─────────────────────────────────────────────────────

static NEXT_IP: AtomicU32 = AtomicU32::new(1);

#[derive(Default)]
struct Call<'a> {
    body: Option<Value>,
    bearer: Option<&'a str>,
    cookies: Vec<String>,
    mobile: bool,
}

impl<'a> Call<'a> {
    fn json(body: Value) -> Self {
        Self {
            body: Some(body),
            ..Self::default()
        }
    }
    fn mobile(mut self) -> Self {
        self.mobile = true;
        self
    }
    fn bearer(mut self, token: &'a str) -> Self {
        self.bearer = Some(token);
        self
    }
    fn cookie(mut self, name: &str, value: &str) -> Self {
        self.cookies.push(format!("{name}={value}"));
        self
    }
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    json: Value,
}

impl Reply {
    /// The value of a `Set-Cookie` the response sent.
    fn cookie(&self, name: &str) -> Option<String> {
        self.headers
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find_map(|c| c.strip_prefix(&format!("{name}=")))
            .map(|rest| rest.split(';').next().unwrap_or_default().to_string())
            .filter(|v| !v.is_empty())
    }
}

async fn send(app: &axum::Router, method: Method, uri: &str, call: Call<'_>) -> Reply {
    let ip = NEXT_IP.fetch_add(1, Ordering::Relaxed);
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::USER_AGENT, BROWSER_UA)
        .header(header::ORIGIN, ORIGIN)
        .header("x-forwarded-for", format!("203.0.113.{}", ip % 250 + 1))
        .header(header::CONTENT_TYPE, "application/json");
    if call.mobile {
        req = req.header("x-client", "mobile");
    }
    if let Some(token) = call.bearer {
        req = req.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    if !call.cookies.is_empty() {
        req = req.header(header::COOKIE, call.cookies.join("; "));
    }
    let body = call
        .body
        .map_or_else(Body::empty, |v| Body::from(v.to_string()));
    let res = app
        .clone()
        .oneshot(req.body(body).expect("request"))
        .await
        .expect("response");
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .expect("body");
    Reply {
        status,
        headers,
        json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

async fn post(app: &axum::Router, uri: &str, call: Call<'_>) -> Reply {
    send(app, Method::POST, uri, call).await
}

async fn register(app: &axum::Router, name: &str, email: &str) -> Reply {
    let reply = post(
        app,
        "/api/auth/register",
        Call::json(json!({ "fullName": name, "email": email, "password": PASSWORD })),
    )
    .await;
    assert_eq!(
        reply.status,
        StatusCode::OK,
        "register {email}: {:?}",
        reply.json
    );
    reply
}

async fn login(app: &axum::Router, email: &str, password: &str) -> Reply {
    post(
        app,
        "/api/auth/login",
        Call::json(json!({ "email": email, "password": password })),
    )
    .await
}

fn email(tag: &str) -> String {
    format!("{tag}-{}@example.com", Uuid::new_v4().simple())
}

// ── Database helpers ─────────────────────────────────────────────────

async fn user_row(state: &backend::state::AppState, email: &str) -> user::Model {
    use sea_orm::{ColumnTrait, QueryFilter};
    user::Entity::find()
        .filter(user::Column::Email.eq(email))
        .one(state.db.as_ref())
        .await
        .expect("query")
        .unwrap_or_else(|| panic!("no user {email}"))
}

/// A user with a known password hash, created through the store.
async fn seed_user(state: &backend::state::AppState, email: &str, hash: &str) -> user::Model {
    DbUserStore::new(state.db.clone())
        .create_user(
            email.into(),
            "Seeded User".into(),
            hash.into(),
            "user".into(),
        )
        .await
        .expect("seed user")
}

async fn set_lock(state: &backend::state::AppState, id: Uuid, attempts: i64, until: Option<&str>) {
    state
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "UPDATE \"user\" SET failed_login_attempts = ?, locked_until = ? WHERE id = ?",
            [attempts.into(), until.map(str::to_string).into(), id.into()],
        ))
        .await
        .expect("set lock");
}

fn refresh_id(token: &str) -> Uuid {
    Uuid::parse_str(token.split('.').next().unwrap()).expect("uuid prefix")
}

async fn refresh_row(state: &backend::state::AppState, token: &str) -> refresh_tokens::Model {
    refresh_tokens::Entity::find_by_id(refresh_id(token))
        .one(state.db.as_ref())
        .await
        .expect("query")
        .expect("refresh row")
}

// ── PBKDF2 ───────────────────────────────────────────────────────────

#[tokio::test]
async fn a_worker_pbkdf2_user_logs_in_and_the_row_becomes_argon2id() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let fx = fixture();
    let (hash, password) = (
        fx["passwordHash"].as_str().unwrap(),
        fx["password"].as_str().unwrap(),
    );
    let email = email("pbkdf2");
    let seeded = seed_user(&state, &email, hash).await;
    assert!(seeded
        .password_hash
        .as_deref()
        .unwrap()
        .starts_with("pbkdf2$"));

    let wrong = login(&app, &email, "not-the-password").await;
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        user_row(&state, &email).await.password_hash.as_deref(),
        Some(hash),
        "a failed login leaves the stored hash alone"
    );

    let ok = login(&app, &email, password).await;
    assert_eq!(ok.status, StatusCode::OK, "{:?}", ok.json);
    assert_eq!(ok.json["user"]["email"], email);
    let row = user_row(&state, &email).await;
    assert!(
        row.password_hash
            .as_deref()
            .unwrap()
            .starts_with("$argon2id$"),
        "rehashed: {:?}",
        row.password_hash
    );
    assert!(row.last_login_at.is_some());

    // The upgraded hash keeps working, and no longer changes.
    let again = login(&app, &email, password).await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(
        user_row(&state, &email).await.password_hash,
        row.password_hash
    );
    assert_eq!(
        login(&app, &email, "not-the-password").await.status,
        StatusCode::UNAUTHORIZED
    );
    Ok(())
}

#[tokio::test]
async fn a_rehash_never_overwrites_a_password_changed_meanwhile() -> anyhow::Result<()> {
    let (_app, state) = boot().await?;
    let seeded = seed_user(&state, &email("race"), "pbkdf2$1$AAAA$AAAA").await;
    let store = DbUserStore::new(state.db.clone());
    // The login verified the OLD hash, but the password was changed
    // (hash B stored) before the rehash landed.
    store
        .record_login_success(
            seeded.id,
            None,
            Some(PasswordRehash {
                old: "some-older-hash".into(),
                new: "$argon2id$stale".into(),
            }),
        )
        .await?;
    let row = store.get_user(seeded.id).await?;
    assert_eq!(row.password_hash.as_deref(), Some("pbkdf2$1$AAAA$AAAA"));
    Ok(())
}

// ── Lockout ──────────────────────────────────────────────────────────

#[tokio::test]
async fn the_account_locks_after_the_configured_wrong_passwords() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let email = email("lock");
    register(&app, "Lock Tester", &email).await;

    for _ in 0..MAX_FAILURES {
        assert_eq!(
            login(&app, &email, "wrong").await.status,
            StatusCode::UNAUTHORIZED
        );
    }
    let row = user_row(&state, &email).await;
    assert_eq!(row.failed_login_attempts, MAX_FAILURES);
    assert!(row.locked_until.is_some());

    // Locked: even the right password is refused, in the Worker's shape.
    let locked = login(&app, &email, PASSWORD).await;
    assert_eq!(locked.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(locked.json["error"], "too_many_requests");
    assert!(locked.json["message"]
        .as_str()
        .unwrap()
        .contains("too many failed sign-in attempts"));
    let retry: i64 = locked
        .headers
        .get(header::RETRY_AFTER)
        .expect("Retry-After")
        .to_str()?
        .parse()?;
    assert!((14 * 60..=15 * 60).contains(&retry), "retry-after {retry}");

    // The employee entrance is behind the same lock.
    let staff = post(
        &app,
        "/api/auth/employee-login",
        Call::json(json!({ "email": email, "password": PASSWORD })),
    )
    .await;
    assert_eq!(staff.status, StatusCode::TOO_MANY_REQUESTS);
    Ok(())
}

#[tokio::test]
async fn an_expired_lock_lets_the_user_in_and_clears_the_counters() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let email = email("expired");
    register(&app, "Lock Tester", &email).await;
    let id = user_row(&state, &email).await.id;

    set_lock(&state, id, MAX_FAILURES, Some("2020-01-01T00:00:00Z")).await;
    assert_eq!(login(&app, &email, PASSWORD).await.status, StatusCode::OK);
    let row = user_row(&state, &email).await;
    assert_eq!(row.failed_login_attempts, 0);
    assert_eq!(row.locked_until, None);
    Ok(())
}

#[tokio::test]
async fn a_wrong_password_after_an_expired_lock_restarts_the_count() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let email = email("restart");
    register(&app, "Lock Tester", &email).await;
    let id = user_row(&state, &email).await.id;

    set_lock(&state, id, MAX_FAILURES, Some("2020-01-01T00:00:00Z")).await;
    assert_eq!(
        login(&app, &email, "wrong").await.status,
        StatusCode::UNAUTHORIZED
    );
    let row = user_row(&state, &email).await;
    assert_eq!(row.failed_login_attempts, 1, "not locked again at once");
    assert_eq!(row.locked_until, None);
    Ok(())
}

#[tokio::test]
async fn a_successful_sign_in_forgives_earlier_failures() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let email = email("forgive");
    register(&app, "Lock Tester", &email).await;
    login(&app, &email, "wrong").await;
    login(&app, &email, "wrong").await;
    assert_eq!(user_row(&state, &email).await.failed_login_attempts, 2);
    assert_eq!(login(&app, &email, PASSWORD).await.status, StatusCode::OK);
    assert_eq!(user_row(&state, &email).await.failed_login_attempts, 0);
    Ok(())
}

#[tokio::test]
async fn concurrent_guessing_cannot_slip_past_the_limit() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let email = email("burst");
    register(&app, "Lock Tester", &email).await;

    let mut tasks = Vec::new();
    for _ in 0..12 {
        let (app, email) = (app.clone(), email.clone());
        tasks.push(tokio::spawn(async move {
            login(&app, &email, "wrong").await.status
        }));
    }
    for task in tasks {
        let status = task.await?;
        assert!(
            status == StatusCode::UNAUTHORIZED || status == StatusCode::TOO_MANY_REQUESTS,
            "{status}"
        );
    }
    let row = user_row(&state, &email).await;
    assert!(row.failed_login_attempts >= MAX_FAILURES);
    assert!(row.locked_until.is_some());
    assert_eq!(
        login(&app, &email, PASSWORD).await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
    Ok(())
}

// ── Timing ───────────────────────────────────────────────────────────

#[tokio::test]
async fn an_unknown_email_takes_about_as_long_as_a_wrong_password() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let known = email("timing");
    register(&app, "Timing Tester", &known).await;
    let id = user_row(&state, &known).await.id;

    async fn timed(app: &axum::Router, email: &str) -> Duration {
        let started = Instant::now();
        let reply = login(app, email, "wrong-password").await;
        assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
        started.elapsed()
    }
    // The other tests of this process share the two password workers, so
    // sample both paths alternately and compare their fastest runs.
    let mut wrong_password = Duration::MAX;
    let mut unknown = Duration::MAX;
    for _ in 0..4 {
        wrong_password = wrong_password.min(timed(&app, &known).await);
        set_lock(&state, id, 0, None).await;
        unknown = unknown.min(timed(&app, "nobody@example.com").await);
    }
    // Without the decoy verification an unknown email answers in
    // milliseconds, a wrong password in hundreds of them.
    assert!(
        unknown * 2 >= wrong_password,
        "unknown email answered in {unknown:?}, wrong password in {wrong_password:?}"
    );
    Ok(())
}

// ── OAuth ────────────────────────────────────────────────────────────

fn profile(subject: &str, email: &str) -> OAuthProfile {
    OAuthProfile {
        provider: "google".into(),
        subject: subject.into(),
        email: email.into(),
        name: "Google Person".into(),
        avatar_url: Some("https://example.com/a.png".into()),
    }
}

#[tokio::test]
async fn oauth_onto_an_unverified_password_account_takes_it_back() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let squatted = email("squat");
    let reg = register(&app, "Squatter", &squatted).await;
    let refresh = reg.cookie("refresh_token").expect("refresh cookie");
    let before = user_row(&state, &squatted).await;
    assert!(before.password_hash.is_some());
    assert_eq!(before.email_verified_at, None);

    // The real owner arrives through Google (the address differs in case).
    let linked = state
        .auth
        .register_oauth_user(profile("g-squat", &squatted.to_uppercase()))
        .await?;
    assert_eq!(linked.id, before.id, "linked, not duplicated");

    let after = user_row(&state, &squatted).await;
    assert_eq!(after.password_hash, None, "the squatter's password is gone");
    assert!(
        after.email_verified_at.is_some(),
        "the provider verified it"
    );
    assert_eq!(after.oauth_provider.as_deref(), Some("google"));
    assert_eq!(after.oauth_subject.as_deref(), Some("g-squat"));
    assert!(after.password_changed_at.is_some());
    assert!(
        refresh_row(&state, &refresh).await.revoked,
        "tokens revoked"
    );

    // Neither the password nor the old session works any more.
    assert_eq!(
        login(&app, &squatted, PASSWORD).await.status,
        StatusCode::UNAUTHORIZED
    );
    let refreshed = post(
        &app,
        "/api/auth/refresh",
        Call::json(json!({})).cookie("refresh_token", &refresh),
    )
    .await;
    assert_eq!(refreshed.status, StatusCode::UNAUTHORIZED);

    // The same identity again is idempotent.
    let again = state
        .auth
        .register_oauth_user(profile("g-squat", "someone-else@example.com"))
        .await?;
    assert_eq!(again.id, before.id);
    Ok(())
}

#[tokio::test]
async fn oauth_onto_a_verified_account_keeps_its_password_and_sessions() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let verified = email("verified");
    let reg = register(&app, "Verified Owner", &verified).await;
    let refresh = reg.cookie("refresh_token").expect("refresh cookie");
    state
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "UPDATE \"user\" SET email_verified_at = ? WHERE email = ?",
            ["2026-01-01T00:00:00Z".into(), verified.clone().into()],
        ))
        .await?;

    state
        .auth
        .register_oauth_user(profile("g-verified", &verified))
        .await?;
    let after = user_row(&state, &verified).await;
    assert!(after.password_hash.is_some(), "an owner's password stays");
    assert_eq!(
        after.email_verified_at.as_deref(),
        Some("2026-01-01T00:00:00Z")
    );
    assert_eq!(after.oauth_subject.as_deref(), Some("g-verified"));
    assert!(!refresh_row(&state, &refresh).await.revoked);
    assert_eq!(
        login(&app, &verified, PASSWORD).await.status,
        StatusCode::OK
    );
    Ok(())
}

#[tokio::test]
async fn a_new_oauth_account_is_verified_and_has_no_password() -> anyhow::Result<()> {
    let (_app, state) = boot().await?;
    let fresh = email("fresh");
    let created = state
        .auth
        .register_oauth_user(profile("g-fresh", &fresh))
        .await?;
    assert_eq!(created.password_hash, None);
    assert!(created.email_verified_at.is_some());
    assert_eq!(
        created.avatar_url.as_deref(),
        Some("https://example.com/a.png")
    );
    Ok(())
}

// ── Registration ─────────────────────────────────────────────────────

#[tokio::test]
async fn the_display_name_is_counted_in_characters_not_bytes() -> anyhow::Result<()> {
    let (app, _state) = boot().await?;
    let register_named = |name: String| {
        let app = app.clone();
        async move {
            post(
                &app,
                "/api/auth/register",
                Call::json(
                    json!({ "fullName": name, "email": email("name"), "password": PASSWORD }),
                ),
            )
            .await
        }
    };
    // 64 three-byte characters: 192 bytes, within the limit.
    let long_enough = register_named("ệ".repeat(64)).await;
    assert_eq!(long_enough.status, StatusCode::OK, "{:?}", long_enough.json);
    let vietnamese = register_named("Nguyễn Thị Phương Thảo".into()).await;
    assert_eq!(vietnamese.status, StatusCode::OK);

    let too_long = register_named("ệ".repeat(65)).await;
    assert_eq!(too_long.status, StatusCode::BAD_REQUEST);
    assert!(too_long.json["message"]
        .as_str()
        .unwrap()
        .contains("username must be 3-64 characters"));
    // Two characters are fewer than three even though they are six bytes.
    assert_eq!(
        register_named("ệệ".into()).await.status,
        StatusCode::BAD_REQUEST
    );
    Ok(())
}

#[tokio::test]
async fn phone_only_registration_signs_in_with_the_number() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let number = format!("09{:08}", Uuid::new_v4().as_u128() % 100_000_000);
    let normalized = format!("+84{}", &number[1..]);

    let reg = post(
        &app,
        "/api/auth/register",
        Call::json(json!({ "fullName": "Phone Only", "phone": number, "password": PASSWORD })),
    )
    .await;
    assert_eq!(reg.status, StatusCode::OK, "{:?}", reg.json);
    assert_eq!(reg.json["user"]["phone"], normalized);
    // The number is the account's identity in the unique email column too.
    let row = user_row(&state, &normalized).await;
    assert_eq!(row.phone.as_deref(), Some(normalized.as_str()));

    // Both spellings sign in.
    for spelling in [number.as_str(), normalized.as_str()] {
        let ok = post(
            &app,
            "/api/auth/login",
            Call::json(json!({ "phone": spelling, "password": PASSWORD })),
        )
        .await;
        assert_eq!(ok.status, StatusCode::OK, "{spelling}: {:?}", ok.json);
        assert_eq!(ok.json["user"]["id"], reg.json["user"]["id"]);
    }
    let wrong = post(
        &app,
        "/api/auth/login",
        Call::json(json!({ "phone": number, "password": "wrong-password" })),
    )
    .await;
    assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);

    // The same number cannot register twice, nor can an address, in any case.
    let dup_phone = post(
        &app,
        "/api/auth/register",
        Call::json(json!({ "fullName": "Phone Twice", "phone": number, "password": PASSWORD })),
    )
    .await;
    assert_eq!(dup_phone.status, StatusCode::CONFLICT);
    assert!(dup_phone.json["message"]
        .as_str()
        .unwrap()
        .contains("phone already registered"));

    let mail = email("dup");
    register(&app, "Mail Owner", &mail).await;
    let dup_mail = post(
        &app,
        "/api/auth/register",
        Call::json(
            json!({ "fullName": "Mail Twice", "email": mail.to_uppercase(), "password": PASSWORD }),
        ),
    )
    .await;
    assert_eq!(dup_mail.status, StatusCode::CONFLICT);
    assert!(dup_mail.json["message"]
        .as_str()
        .unwrap()
        .contains("email already registered"));
    Ok(())
}

#[tokio::test]
async fn email_and_phone_are_both_kept_and_either_one_is_required() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let mail = email("both");
    let number = format!("09{:08}", Uuid::new_v4().as_u128() % 100_000_000);
    let reg = post(
        &app,
        "/api/auth/register",
        Call::json(json!({
            "fullName": "Both Contacts", "email": mail.to_uppercase(), "phone": number,
            "password": PASSWORD, "locale": "en"
        })),
    )
    .await;
    assert_eq!(reg.status, StatusCode::OK, "{:?}", reg.json);
    let row = user_row(&state, &mail).await;
    assert_eq!(
        row.phone.as_deref(),
        Some(format!("+84{}", &number[1..]).as_str())
    );
    assert_eq!(row.locale, "en");
    // The email logs in in any case.
    assert_eq!(
        login(&app, &mail.to_uppercase(), PASSWORD).await.status,
        StatusCode::OK
    );

    let neither = post(
        &app,
        "/api/auth/register",
        Call::json(json!({ "fullName": "No Contact", "password": PASSWORD })),
    )
    .await;
    assert_eq!(neither.status, StatusCode::BAD_REQUEST);
    assert!(neither.json["message"]
        .as_str()
        .unwrap()
        .contains("Email or phone is required"));
    Ok(())
}

// ── Logout ───────────────────────────────────────────────────────────

#[tokio::test]
async fn logout_checks_the_token_owner_before_revoking() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let alice = register(&app, "Alice A", &email("alice")).await;
    let bob = register(&app, "Bob B", &email("bob")).await;
    let alice_refresh = alice.cookie("refresh_token").unwrap();
    let bob_refresh = bob.cookie("refresh_token").unwrap();
    let bob_access = bob.cookie("access_token").unwrap();

    // Bob, signed in, posts Alice's refresh token to end her session.
    let attack = post(
        &app,
        "/api/auth/logout",
        Call::json(json!({ "refresh_token": alice_refresh })).bearer(&bob_access),
    )
    .await;
    assert_eq!(attack.status, StatusCode::NO_CONTENT);
    assert!(
        !refresh_row(&state, &alice_refresh).await.revoked,
        "Alice's session survives"
    );
    let still_alive = post(
        &app,
        "/api/auth/refresh",
        Call::json(json!({ "refresh_token": alice_refresh })),
    )
    .await;
    assert_eq!(still_alive.status, StatusCode::OK);

    // Bob's own token, posted by Bob, is revoked.
    let own = post(
        &app,
        "/api/auth/logout",
        Call::json(json!({ "refresh_token": bob_refresh })).bearer(&bob_access),
    )
    .await;
    assert_eq!(own.status, StatusCode::NO_CONTENT);
    assert!(refresh_row(&state, &bob_refresh).await.revoked);
    Ok(())
}

#[tokio::test]
async fn logout_with_only_a_refresh_cookie_revokes_just_that_session() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let mail = email("cookie");
    let first = register(&app, "Cookie User", &mail).await;
    let second = login(&app, &mail, PASSWORD).await;
    let (a, b) = (
        first.cookie("refresh_token").unwrap(),
        second.cookie("refresh_token").unwrap(),
    );
    let out = post(
        &app,
        "/api/auth/logout",
        Call::default().cookie("refresh_token", &a),
    )
    .await;
    assert_eq!(out.status, StatusCode::NO_CONTENT);
    assert!(refresh_row(&state, &a).await.revoked);
    assert!(
        !refresh_row(&state, &b).await.revoked,
        "other devices stay signed in"
    );

    // A forged secret revokes nothing.
    let forged = format!("{}.{}", refresh_id(&b), "0".repeat(64));
    post(
        &app,
        "/api/auth/logout",
        Call::default().cookie("refresh_token", &forged),
    )
    .await;
    assert!(!refresh_row(&state, &b).await.revoked);
    Ok(())
}

// ── Sessions ─────────────────────────────────────────────────────────

#[tokio::test]
async fn a_mobile_password_change_issues_a_ninety_day_session() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let mail = email("mobile");
    let reg = post(
        &app,
        "/api/auth/register",
        Call::json(json!({ "fullName": "Mobile User", "email": mail, "password": PASSWORD }))
            .mobile(),
    )
    .await;
    assert_eq!(reg.status, StatusCode::OK);
    let access = reg.json["tokens"]["access_token"]
        .as_str()
        .unwrap()
        .to_string();
    let registered_refresh = reg.json["tokens"]["refresh_token"]
        .as_str()
        .unwrap()
        .to_string();
    let ninety_days = chrono::Duration::days(90);
    let lifetime = |row: &refresh_tokens::Model| row.expires_at - row.issued_at;
    assert_eq!(
        lifetime(&refresh_row(&state, &registered_refresh).await),
        ninety_days
    );

    let changed = post(
        &app,
        "/api/auth/password",
        Call::json(json!({ "currentPassword": PASSWORD, "newPassword": "a-brand-new-password" }))
            .bearer(&access)
            .mobile(),
    )
    .await;
    assert_eq!(changed.status, StatusCode::OK, "{:?}", changed.json);
    let new_refresh = changed.json["tokens"]["refresh_token"]
        .as_str()
        .expect("mobile gets the raw tokens");
    let row = refresh_row(&state, new_refresh).await;
    assert_eq!(lifetime(&row), ninety_days, "a 90-day mobile session");
    assert!(
        refresh_row(&state, &registered_refresh).await.revoked,
        "other sessions end"
    );

    // A browser changing its password gets the browser lifetime.
    let browser = post(
        &app,
        "/api/auth/password",
        Call::json(json!({ "currentPassword": "a-brand-new-password", "newPassword": "yet-another-password" }))
            .bearer(changed.json["tokens"]["access_token"].as_str().unwrap()),
    )
    .await;
    assert_eq!(browser.status, StatusCode::OK);
    let browser_row = refresh_row(&state, &browser.cookie("refresh_token").unwrap()).await;
    assert_eq!(lifetime(&browser_row), chrono::Duration::days(7));
    assert!(browser.json.get("tokens").is_none());
    Ok(())
}

#[tokio::test]
async fn a_wrong_current_password_is_a_400_and_the_password_stays() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let mail = email("change");
    let reg = register(&app, "Change User", &mail).await;
    let before = user_row(&state, &mail).await.password_hash;
    let access = reg.cookie("access_token").unwrap();
    let refused = post(
        &app,
        "/api/auth/password",
        Call::json(json!({ "currentPassword": "not-it", "newPassword": "a-brand-new-password" }))
            .bearer(&access),
    )
    .await;
    assert_eq!(refused.status, StatusCode::BAD_REQUEST);
    assert_eq!(user_row(&state, &mail).await.password_hash, before);
    Ok(())
}

#[tokio::test]
async fn a_deleted_users_token_is_a_401_not_a_404() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let reg = register(&app, "Soon Deleted", &email("gone")).await;
    let access = reg.cookie("access_token").unwrap();
    let id: Uuid = reg.json["user"]["id"].as_str().unwrap().parse()?;

    let me = send(
        &app,
        Method::GET,
        "/api/auth/me",
        Call::default().bearer(&access),
    )
    .await;
    assert_eq!(me.status, StatusCode::OK);
    state.users.delete(id).await?;
    for call in [
        Call::default().bearer(&access),
        Call::default().cookie("access_token", &access),
    ] {
        let gone = send(&app, Method::GET, "/api/auth/me", call).await;
        assert_eq!(gone.status, StatusCode::UNAUTHORIZED, "{:?}", gone.json);
    }
    Ok(())
}

#[tokio::test]
async fn a_blocked_account_is_refused_only_to_someone_who_knew_its_password() -> anyhow::Result<()>
{
    let (app, state) = boot().await?;
    let mail = email("blocked");
    register(&app, "Blocked User", &mail).await;
    state
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "UPDATE \"user\" SET status = 'blocked', block_reason = 'chargeback' WHERE email = ?",
            [mail.clone().into()],
        ))
        .await?;
    assert_eq!(
        login(&app, &mail, "wrong").await.status,
        StatusCode::UNAUTHORIZED
    );
    let right = login(&app, &mail, PASSWORD).await;
    assert_eq!(right.status, StatusCode::FORBIDDEN);
    assert!(right.json["message"]
        .as_str()
        .unwrap()
        .contains("chargeback"));
    Ok(())
}

#[tokio::test]
async fn a_customer_at_the_employee_entrance_is_refused_without_a_session() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    // The first human becomes the admin; the second is a plain customer.
    register(&app, "Admin First", &email("admin")).await;
    let mail = email("customer");
    register(&app, "Customer Two", &mail).await;
    let id = user_row(&state, &mail).await.id;
    let before = refresh_tokens::Entity::find()
        .all(state.db.as_ref())
        .await?
        .len();

    let refused = post(
        &app,
        "/api/auth/employee-login",
        Call::json(json!({ "email": mail, "password": PASSWORD })),
    )
    .await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert!(refused.cookie("refresh_token").is_none());
    assert_eq!(
        refresh_tokens::Entity::find()
            .all(state.db.as_ref())
            .await?
            .len(),
        before,
        "no token minted for {id}"
    );
    Ok(())
}

// ── Tokens minted by the Worker ──────────────────────────────────────

/// Insert the fixture's account and its refresh-token row, exactly as the
/// Worker's D1 import would carry them over.
async fn import_worker_session(state: &backend::state::AppState) -> Uuid {
    let fx = fixture();
    let user_id: Uuid = fx["userId"].as_str().unwrap().parse().unwrap();
    let token = fx["refreshToken"].as_str().unwrap();
    let now = chrono::Utc::now();
    state
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "INSERT INTO \"user\" (id, full_name, email, password_hash, role, created_at, updated_at) \
             VALUES (?, 'Worker User', 'worker-user@example.com', ?, 'user', ?, ?)",
            [
                user_id.into(),
                fx["passwordHash"].as_str().unwrap().into(),
                now.into(),
                now.into(),
            ],
        ))
        .await
        .expect("insert worker user");
    state
        .db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "INSERT INTO refresh_tokens (id, user_id, token_hash, issued_at, expires_at, revoked) \
             VALUES (?, ?, ?, ?, ?, 0)",
            [
                refresh_id(token).into(),
                user_id.into(),
                fx["refreshTokenHash"].as_str().unwrap().into(),
                now.into(),
                (now + chrono::Duration::days(7)).into(),
            ],
        ))
        .await
        .expect("insert worker refresh token");
    user_id
}

#[tokio::test]
async fn a_refresh_token_minted_by_the_worker_is_accepted() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let fx = fixture();
    let user_id = import_worker_session(&state).await;
    let token = fx["refreshToken"].as_str().unwrap();

    // A tampered secret is a mismatch, not a session.
    let forged = format!("{}.{}", refresh_id(token), "f".repeat(64));
    let mismatch = post(
        &app,
        "/api/auth/refresh",
        Call::json(json!({ "refresh_token": forged })),
    )
    .await;
    assert_eq!(mismatch.status, StatusCode::UNAUTHORIZED);

    let ok = post(
        &app,
        "/api/auth/refresh",
        Call::json(json!({ "refresh_token": token })).mobile(),
    )
    .await;
    assert_eq!(ok.status, StatusCode::OK, "{:?}", ok.json);
    assert_eq!(ok.json["user"]["id"], user_id.to_string());
    let rotated = ok.json["tokens"]["refresh_token"].as_str().unwrap();
    assert_ne!(rotated, token);
    // The Worker's token is spent; the new one rotates in turn.
    assert!(refresh_row(&state, token).await.revoked);
    let replay = post(
        &app,
        "/api/auth/refresh",
        Call::json(json!({ "refresh_token": token })),
    )
    .await;
    assert_eq!(replay.status, StatusCode::UNAUTHORIZED);
    let next = post(
        &app,
        "/api/auth/refresh",
        Call::json(json!({ "refresh_token": rotated })),
    )
    .await;
    assert_eq!(next.status, StatusCode::OK);
    Ok(())
}

#[tokio::test]
async fn an_access_token_minted_by_the_worker_is_accepted() -> anyhow::Result<()> {
    let (app, state) = boot().await?;
    let fx = fixture();
    let user_id = import_worker_session(&state).await;
    let me = send(
        &app,
        Method::GET,
        "/api/auth/me",
        Call::default().bearer(fx["accessToken"].as_str().unwrap()),
    )
    .await;
    assert_eq!(me.status, StatusCode::OK, "{:?}", me.json);
    assert_eq!(me.json["user"]["id"], user_id.to_string());

    // The Worker's own PBKDF2 hash signs the same account in.
    let signed_in = login(
        &app,
        "worker-user@example.com",
        fx["password"].as_str().unwrap(),
    )
    .await;
    assert_eq!(signed_in.status, StatusCode::OK);
    Ok(())
}

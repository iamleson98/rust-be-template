//! Integration tests for the auth flow + RBAC + CSRF.
//!
//! These tests spin up the full app against an in-memory SQLite DB and
//! exercise the critical paths end-to-end via real HTTP requests.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

/// Helper: build a full AppState against an in-memory SQLite DB.
async fn build_test_state() -> Arc<crate::state::AppState> {
    // Use an in-memory SQLite — each test gets a fresh DB.
    std::env::set_var("DATABASE_URL", "sqlite::memory:");
    std::env::set_var("JWT_SECRET", "test-secret-32-bytes-minimum-length!!");
    std::env::set_var("CACHE_BACKEND", "moka");
    std::env::set_var("WORKER_BACKEND", "redis");
    std::env::set_var("REDIS_URL", "redis://localhost:6379/0");

    let state = crate::server::bootstrap().await.expect("bootstrap");
    // Apply migrations.
    use sea_orm_migration::MigratorTrait;
    crate::migration::Migrator::up(state.db.as_ref(), None)
        .await
        .expect("migrations");
    state
}

/// Helper: send a request to the test app and return (status, body_json).
async fn send(
    state: Arc<crate::state::AppState>,
    method: &str,
    path: &str,
    body: Option<Value>,
    cookies: &mut Vec<String>,
    csrf_header: Option<&str>,
) -> (StatusCode, Value, Vec<String>) {
    let router = crate::routes::build_router(state);

    let mut req = Request::builder().method(method).uri(path);
    req = req.header("content-type", "application/json");
    if let Some(csrf) = csrf_header {
        req = req.header("x-csrf-token", csrf);
    }
    if !cookies.is_empty() {
        req = req.header("cookie", cookies.join("; "));
    }
    let body = body.map(|b| Body::from(b.to_string())).unwrap_or(Body::empty());
    let req = req.body(body).unwrap();

    let resp = router.oneshot(req).await.unwrap();
    let status = resp.status();

    // Extract Set-Cookie headers for subsequent requests.
    let new_cookies: Vec<String> = resp
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok().map(|s| s.split(';').next().unwrap_or("").to_string()))
        .collect();
    for c in &new_cookies {
        if !cookies.iter().any(|existing| {
            let existing_name = existing.split('=').next().unwrap_or("");
            let new_name = c.split('=').next().unwrap_or("");
            existing_name == new_name
        }) {
            cookies.push(c.clone());
        } else {
            // Replace existing cookie with same name.
            let new_name = c.split('=').next().unwrap_or("");
            for slot in cookies.iter_mut() {
                let existing_name = slot.split('=').next().unwrap_or("");
                if existing_name == new_name {
                    *slot = c.clone();
                }
            }
        }
    }

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap_or(Value::Null);
    (status, body_json, new_cookies)
}

/// Extract a cookie value by name from a list of "name=value" strings.
fn get_cookie(cookies: &[String], name: &str) -> Option<String> {
    cookies
        .iter()
        .find(|c| c.starts_with(&format!("{name}=")))
        .and_then(|c| c.split('=').nth(1).map(|v| v.to_string()))
}

#[tokio::test]
#[ignore = "integration test — run with: cargo test --test integration -- --ignored"]
async fn full_auth_flow_with_csrf() {
    let state = build_test_state().await;
    let mut cookies = Vec::new();

    // 1. Register — no CSRF needed (it sets the cookie).
    let (status, body, _) = send(
        state.clone(),
        "POST",
        "/api/auth/register",
        Some(serde_json::json!({
            "email": "alice@test.com",
            "username": "alice",
            "password": "password123"
        })),
        &mut cookies,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "register failed: {body}");
    assert_eq!(body["username"], "alice");

    // 2. Login — sets cookies (access, refresh, csrf).
    let (status, body, set_cookies) = send(
        state.clone(),
        "POST",
        "/api/auth/login",
        Some(serde_json::json!({
            "email": "alice@test.com",
            "password": "password123"
        })),
        &mut cookies,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login failed: {body}");
    assert_eq!(body["username"], "alice");

    // Collect all set cookies.
    for c in &set_cookies {
        cookies.push(c.clone());
    }

    let csrf_token = get_cookie(&cookies, "csrf_token").expect("csrf cookie set");
    println!("CSRF token: {csrf_token}");

    // 3. Create post WITHOUT CSRF header — should be rejected.
    let (status, body, _) = send(
        state.clone(),
        "POST",
        "/api/posts",
        Some(serde_json::json!({"title": "Hello", "body": "World"})),
        &mut cookies,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "expected 400 without CSRF");
    assert!(body["error"].as_str().unwrap().contains("bad_request"));

    // 4. Create post WITH CSRF header — should succeed.
    let (status, body, _) = send(
        state.clone(),
        "POST",
        "/api/posts",
        Some(serde_json::json!({"title": "Hello", "body": "World"})),
        &mut cookies,
        Some(&csrf_token),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "create post failed: {body}");
    assert_eq!(body["title"], "Hello");

    // 5. List posts — public read, no CSRF needed.
    let (status, body, _) = send(
        state.clone(),
        "GET",
        "/api/posts?limit=10",
        None,
        &mut cookies,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"].as_array().unwrap().len(), 1);

    // 6. /me — returns the authenticated user.
    let (status, body, _) = send(
        state.clone(),
        "GET",
        "/api/auth/me",
        None,
        &mut cookies,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["username"], "alice");

    // 7. Logout — invalidates JWT.
    let (status, _, _) = send(
        state.clone(),
        "POST",
        "/api/auth/logout",
        None,
        &mut cookies,
        Some(&csrf_token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // 8. /me after logout — should be 401 (token revoked).
    let (status, body, _) = send(
        state.clone(),
        "GET",
        "/api/auth/me",
        None,
        &mut cookies,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "expected 401 after logout, got {status}: {body}"
    );
}

#[tokio::test]
#[ignore = "integration test"]
async fn health_endpoints_work() {
    let state = build_test_state().await;

    let (status, body, _) = send(state.clone(), "GET", "/health", None, &mut Vec::new(), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");

    let (status, body, _) = send(state.clone(), "GET", "/ready", None, &mut Vec::new(), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
}

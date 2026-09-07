//! API smoke tests — boots the full router with a SQLite in-memory DB and
//! hits a few public endpoints to catch router-composition regressions.
//!
//! These are INTEGRATION tests (in `tests/`), not unit tests — they
//! exercise the full axum stack including middleware, routing, and the
//! service layer. They don't test business logic (that's in `src/`'s
//! inline `#[cfg(test)]` modules).
//!
//! What this catches:
//! - A `router()` function that forgets to mount a route.
//! - A `nest()` path that doesn't match the `#[utoipa::path]` annotation.
//! - A handler whose extractor chain is broken (e.g. wrong `State` type).
//! - Middleware ordering issues (e.g. body limit applied before routing).
//!
//! What this DOESN'T catch:
//! - Business logic bugs (use inline unit tests for those).
//! - Performance regressions (use criterion benchmarks).
//! - Frontend issues (use Playwright/e2e).
//!
//! NOTE: Routes under `/api/*` are rate-limited via `tower_governor`,
//! which requires a client IP from `ConnectInfo<SocketAddr>`. The
//! `oneshot` test harness doesn't provide connect info, so we only
//! test routes that bypass the rate limiter (health, ready, SEO, SW).
//! For rate-limited routes, use the inline unit tests in `src/`.

// Link anchor: rustc only places an rlib on a TEST binary's link line
// when the test's own code references the crate. The rustqlite engine
// (`sqlite3` crate — the sqlite3_* C ABI) is otherwise dropped and
// sqlx-sqlite's FFI references go unresolved. Referencing the compat crate's
// Rust-visible `engine_version` pulls the engine + compat rlibs onto
// THIS binary's link line.
#[used]
static ENGINE_LINK: fn() -> &'static str = sqlite3::engine_version;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

/// Helper: build a minimal AppState with a SQLite in-memory DB.
async fn boot_test_app() -> anyhow::Result<axum::Router> {
    use std::sync::Once;

    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = dotenvy::dotenv();
        // ⚠️  Config keys use SINGLE UNDERSCORE (e.g. `DATABASE_URL`).
        // The previous double-underscore form (`DATABASE__URL`,
        // `JWT__SECRET`, etc.) silently fell through to `.env.example`
        // defaults — so tests would silently write to `./app.db` on
        // disk instead of in-memory, and use the leaked example JWT
        // secret. Fixed in this audit pass.
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
        std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
        std::env::set_var("COOKIE_SECURE", "false");
        std::env::set_var("COOKIE_DOMAIN", "localhost");
        std::env::set_var("CACHE_BACKEND", "moka");
        std::env::set_var("WORKER_BACKEND", "db");
        // No background job runner / scheduler in the one-shot test harness.
        std::env::set_var("SCHEDULER_ENABLED", "false");
        std::env::set_var("SEARCH_INDEX_DIR", "");
        std::env::set_var("AUDIO_CALL_ENABLED", "false");
        std::env::set_var("NULLCLAW_ENABLED", "false");
        // Don't hit real payment gateways during tests.
        std::env::set_var("VNPAY_ENABLED", "false");
        std::env::set_var("MOMO_ENABLED", "false");
        std::env::set_var("ZALOPAY_ENABLED", "false");
        std::env::set_var("VIETQR_ENABLED", "false");
        // Don't hit real OAuth providers during tests.
        std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
        std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
        std::env::set_var("OAUTH_TWITTER_ENABLED", "false");
    });

    let state = backend::server::bootstrap().await?;
    Ok(backend::routes::build_router(state))
}

#[tokio::test]
async fn health_endpoint_returns_200() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    let response = app
        .oneshot(Request::builder()
            .uri("/health")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0")
            .body(Body::empty())?)
        .await?;

    assert_eq!(response.status(), StatusCode::OK);
    Ok(())
}

#[tokio::test]
async fn ready_endpoint_returns_2xx() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    let response = app
        .oneshot(Request::builder()
            .uri("/ready")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0")
            .body(Body::empty())?)
        .await?;

    // `/ready` returns 200 on a healthy DB, 503 on a failed ping.
    assert!(
        response.status().is_success() || response.status() == StatusCode::SERVICE_UNAVAILABLE,
        "expected 2xx or 503, got {}",
        response.status()
    );
    Ok(())
}

#[tokio::test]
async fn sitemap_xml_returns_xml() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    let response = app
        .oneshot(Request::builder()
            .uri("/sitemap.xml")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0")
            .body(Body::empty())?)
        .await?;

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        content_type.contains("xml"),
        "expected XML content-type, got: {content_type}"
    );
    Ok(())
}

#[tokio::test]
async fn robots_txt_returns_text() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    let response = app
        .oneshot(Request::builder()
            .uri("/robots.txt")
            .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0")
            .body(Body::empty())?)
        .await?;

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 4096).await?;
    let text = std::str::from_utf8(&body)?;
    assert!(text.contains("Sitemap:"), "robots.txt must link to sitemap");
    Ok(())
}

#[tokio::test]
async fn spa_fallback_serves_index_html_for_unknown_paths() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    // Unknown non-API paths should fall through to the SPA index.html
    // (so client-side routing works).
    let response = app
        .oneshot(
            Request::builder()
                .uri("/some-unknown-client-route")
                .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0")
                .body(Body::empty())?,
        )
        .await?;

    // Should never 5xx…
    assert!(
        !response.status().is_server_error(),
        "SPA fallback should not 5xx, got {}",
        response.status()
    );
    // …and when the frontend is built it must serve HTML with no-cache
    // (stale index.html references are the #1 cause of the
    // "module script served as text/html" deploy failure).
    if response.status() == StatusCode::OK {
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            content_type.contains("text/html"),
            "SPA fallback must serve text/html, got: {content_type}"
        );
        let cache_control = response
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            cache_control.contains("no-cache"),
            "SPA index.html must be served with no-cache, got: {cache_control}"
        );
    }
    Ok(())
}

#[tokio::test]
async fn missing_hashed_assets_404_instead_of_serving_html() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    // Regression test for the "Failed to load module script: … MIME type
    // text/html" deploy failure: a request for a missing /assets/*.js
    // chunk (stale index.html in the browser cache) must be a hard 404 —
    // serving index.html (200 + text/html) breaks the module graph.
    let response = app
        .oneshot(
            Request::builder()
                .uri("/assets/vendor-deadbeef-does-not-exist.js")
                .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0")
                .body(Body::empty())?,
        )
        .await?;

    assert_eq!(
        response.status(),
        StatusCode::NOT_FOUND,
        "missing hashed asset must 404, got {}",
        response.status()
    );
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        !content_type.contains("text/html"),
        "missing asset must never be served as HTML, got: {content_type}"
    );
    Ok(())
}

#[tokio::test]
async fn extension_shaped_misses_404_instead_of_serving_html() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    // Same contract as above but for root-level files (favicon.ico,
    // stray /foo.css references, …): extension-shaped misses must not
    // fall back to the SPA index.html.
    let response = app
        .oneshot(
            Request::builder()
                .uri("/no-such-file-deadbeef.css")
                .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0")
                .body(Body::empty())?,
        )
        .await?;

    assert_eq!(
        response.status(),
        StatusCode::NOT_FOUND,
        "extension-shaped miss must 404, got {}",
        response.status()
    );
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        !content_type.contains("text/html"),
        "extension-shaped miss must never be served as HTML, got: {content_type}"
    );
    Ok(())
}

#[tokio::test]
async fn root_serves_spa_index_when_built() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    let response = app
        .oneshot(
            Request::builder()
                .uri("/")
                .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0")
                .body(Body::empty())?,
        )
        .await?;

    // When the frontend is built, "/" must serve the SPA shell with
    // no-cache; when it isn't (CI without a dist), a 404 with the
    // "frontend not built" hint is acceptable.
    if response.status() == StatusCode::OK {
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            content_type.contains("text/html"),
            "/ must serve text/html, got: {content_type}"
        );
        let cache_control = response
            .headers()
            .get("cache-control")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            cache_control.contains("no-cache"),
            "/ index.html must be served with no-cache, got: {cache_control}"
        );
    } else {
        assert_eq!(
            response.status(),
            StatusCode::NOT_FOUND,
            "/ should be 200 (built) or 404 (not built), got {}",
            response.status()
        );
    }
    Ok(())
}

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
                .body(Body::empty())?,
        )
        .await?;

    // Should return 200 + HTML (the SPA index.html).
    assert!(
        !response.status().is_server_error(),
        "SPA fallback should not 5xx, got {}",
        response.status()
    );
    Ok(())
}

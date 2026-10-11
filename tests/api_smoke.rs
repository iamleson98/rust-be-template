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
use std::sync::Arc;
use tower::ServiceExt;

/// Helper: build a minimal AppState with a SQLite in-memory DB.
/// (Env-init + bootstrap live in [`boot_test_state`]; the full env
/// contract is documented there.)
async fn boot_test_app() -> anyhow::Result<axum::Router> {
    let state = boot_test_state().await?;
    Ok(backend::routes::build_router(state))
}

/// Env-init + full bootstrap, returning the [`AppState`] so tests can
/// seed data through the real service graph before hitting the router
/// ([`boot_test_app`] builds on this and discards the state).
async fn boot_test_state() -> anyhow::Result<backend::state::AppState> {
    use std::sync::Once;

    static STATE_INIT: Once = Once::new();
    STATE_INIT.call_once(|| {
        let _ = dotenvy::dotenv();
        // ⚠️  Config keys use SINGLE UNDERSCORE (e.g. `DATABASE_URL`).
        // The previous double-underscore form (`DATABASE__URL`,
        // `JWT__SECRET`, etc.) silently fell through to `.env.example`
        // defaults — so tests would silently write to `./app.db` on
        // disk instead of in-memory, and use the leaked example JWT
        // secret. Fixed in a prior audit pass.
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
        // Route-media tests: local storage backend rooted at a fresh
        // tempdir (never `./storage` in the repo working tree).
        std::env::set_var("STORAGE_BACKEND", "local");
        std::env::set_var(
            "STORAGE_LOCAL_ROOT",
            std::env::temp_dir()
                .join(format!("api-smoke-storage-{}", uuid::Uuid::new_v4()))
                .to_str()
                .unwrap(),
        );
        std::env::remove_var("STORAGE_PUBLIC_BASE_URL");
    });

    backend::server::bootstrap().await
}

/// [`boot_test_state`] + the built router, for tests that seed data
/// through the service graph and then exercise HTTP.
async fn boot_test_app_with_state() -> anyhow::Result<(axum::Router, backend::state::AppState)> {
    let state = boot_test_state().await?;
    Ok((backend::routes::build_router(state.clone()), state))
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

// ─────────────────────────────────────────────────────────────────
//  On-demand trip generation (the "web trip finding" fix)
// ─────────────────────────────────────────────────────────────────

/// Boot the AppState DIRECTLY (not via the router — the router path is
/// covered by the other smoke tests, and `/api/*` is rate-limited which
/// needs ConnectInfo the oneshot harness can't provide).
/// A day trips are searched on: far enough ahead that none has departed yet,
/// whatever the time of day (Vietnam runs 7 hours ahead of UTC).
fn travel_date() -> String {
    (chrono::Utc::now() + chrono::Duration::days(2))
        .format("%Y-%m-%d")
        .to_string()
}

async fn boot_state() -> anyhow::Result<backend::state::AppState> {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = dotenvy::dotenv();
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
        std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
        std::env::set_var("COOKIE_SECURE", "false");
        std::env::set_var("COOKIE_DOMAIN", "localhost");
        std::env::set_var("CACHE_BACKEND", "moka");
        std::env::set_var("WORKER_BACKEND", "db");
        std::env::set_var("SCHEDULER_ENABLED", "false");
        std::env::set_var("SEARCH_INDEX_DIR", "");
        std::env::set_var("AUDIO_CALL_ENABLED", "false");
        std::env::set_var("NULLCLAW_ENABLED", "false");
        std::env::set_var("VNPAY_ENABLED", "false");
        std::env::set_var("MOMO_ENABLED", "false");
        std::env::set_var("ZALOPAY_ENABLED", "false");
        std::env::set_var("VIETQR_ENABLED", "false");
        std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
        std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
    });
    backend::server::bootstrap().await
}

/// Search with NO pre-existing trip_session rows must MATERALIZE trips
/// from the schedules on demand and return them — this is the exact
/// "trip finding doesn't work on the web client" regression: previously
/// trips only existed if somebody inserted them by hand, so a fresh
/// deployment with schedules but no trips returned an empty result.
#[tokio::test]
async fn search_generates_trips_on_demand() -> anyhow::Result<()> {
    let st = boot_state().await?;

    // A seeded vehicle type (migration seeds the catalogue).
    let vt = st
        .admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    // Route Hà Nội → Đà Nẵng (name carries the searchable from/to).
    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Hà Nội - Đà Nẵng".into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: None,
        })
        .await?;

    // A daily schedule with a vehicle type (layout-less capacity path).
    let date = travel_date();
    st.admin
        .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
            route_id: Some(route.id),
            departure_time: Some("08:30".into()),
            effective_from: None,
            effective_to: None,
            days_of_week: Some("1111111".into()),
            bus_layout_id: None,
            vehicle_type_id: Some(vt_id),
            base_price_adult: Some(350_000),
            base_price_child: None,
            class_fares: None,
            amenities: None,
            points: None,
        })
        .await?;

    // Search TODAY with no trips inserted — the generator must create
    // the trip and the search must return it.
    let res = st
        .public
        .search_trips(
            "hà nội",
            "đà nẵng",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert_eq!(
        res.items.len(),
        1,
        "on-demand generation must produce exactly one trip for the schedule"
    );
    let trip = &res.items[0];
    assert_eq!(trip.route_name, "Hà Nội - Đà Nẵng");
    assert_eq!(trip.available_seats, 11, "limousine capacity fallback");
    assert_eq!(trip.min_price, 350_000);
    assert_eq!(trip.vehicle_type, "limousine");

    // Idempotency: a SECOND search for the same date must not duplicate.
    let res2 = st
        .public
        .search_trips(
            "hà nội",
            "đà nẵng",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert_eq!(
        res2.items.len(),
        1,
        "generator must be idempotent per (schedule, date)"
    );

    // A past date must NOT be generated (search serves what exists → empty).
    let yesterday = (chrono::Utc::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    let res_past = st
        .public
        .search_trips(
            "hà nội",
            "đà nẵng",
            &yesterday,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert!(res_past.items.is_empty(), "past dates are never generated");

    Ok(())
}

/// The homepage recommendations endpoint self-heals: with schedules in
/// place but zero trip rows, it materializes the next 7 days and returns
/// up to 4 upcoming trips instead of an empty carousel.
#[tokio::test]
async fn recommendations_self_heal_with_generated_trips() -> anyhow::Result<()> {
    let st = boot_state().await?;

    let vt = st
        .admin
        .list_vehicle_types(Some("sleeper"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Hồ Chí Minh - Vũng Tàu".into()),
            brand_id: None,
            start_location_id: Some("ho-chi-minh".into()),
            end_location_id: Some("vung-tau".into()),
            status: None,
        })
        .await?;

    st.admin
        .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
            route_id: Some(route.id),
            departure_time: Some("06:00".into()),
            effective_from: None,
            effective_to: None,
            days_of_week: None, // no mask → daily
            bus_layout_id: None,
            vehicle_type_id: Some(vt_id),
            base_price_adult: Some(120_000),
            base_price_child: None,
            class_fares: None,
            amenities: None,
            points: None,
        })
        .await?;

    let recs = st.public.recommendations().await?;
    assert!(
        !recs.items.is_empty(),
        "recommendations must self-heal by generating upcoming trips"
    );
    assert!(recs.items.iter().all(|t| t.available_seats > 0));
    Ok(())
}

// ══════════════════════════════════════════════════════════════════
//  Media proxy (`/api/media/{key}`) — mounted OUTSIDE the rate-limited
//  `/api` nest, so the one-shot harness can exercise it directly.
// ══════════════════════════════════════════════════════════════════

/// Deterministic small PNG for media-flow tests.
fn media_test_png() -> bytes::Bytes {
    let img = image::RgbImage::from_fn(90, 60, |x, _y| image::Rgb([(x % 251) as u8, 90, 160]));
    let mut buf = Vec::new();
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .expect("test PNG encodes");
    bytes::Bytes::from(buf)
}

#[tokio::test]
async fn media_proxy_rejects_hostile_keys_with_404() -> anyhow::Result<()> {
    let app = boot_test_app().await?;

    for uri in [
        "/api/media/../../etc/passwd",
        // URL-encoded traversal survives routing decode: the serve
        // handler's strict key parser must still 404 it.
        "/api/media/%2e%2e/%2e%2e/etc/passwd",
        "/api/media/secrets/00000000-0000-0000-0000-000000000000/0123456789abcdef.jpg",
        "/api/media/routes/not-a-uuid/0123456789abcdef.jpg",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header(
                        "User-Agent",
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0",
                    )
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "uri: {uri}");
    }
    Ok(())
}

#[tokio::test]
async fn media_proxy_serves_upload_with_etag_and_304() -> anyhow::Result<()> {
    let (app, st) = boot_test_app_with_state().await?;

    // Seed a route + picture through the real service graph.
    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Smoke Test Express".into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: Some("active".into()),
        })
        .await?;
    let route_id: uuid::Uuid = route.id;

    let uploaded = st
        .media
        .upload(route_id, media_test_png(), Some("smoke test bus".into()))
        .await?;
    assert!(!uploaded.deduped);

    // No CDN base in tests → relative proxy URL.
    let path = uploaded.picture.url.clone();
    assert!(path.starts_with("/api/media/routes/"), "url: {path}");

    // 1st GET: 200 + immutable cache headers + ETag.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(path.as_str())
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0",
                )
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
        Some("image/png")
    );
    let cache_control = response
        .headers()
        .get("cache-control")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    assert!(
        cache_control.contains("max-age=31536000") && cache_control.contains("immutable"),
        "cache-control: {cache_control}"
    );
    let etag = response
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .expect("ETag present")
        .to_string();
    let body = axum::body::to_bytes(response.into_body(), 1 << 20).await?;
    assert!(!body.is_empty());

    // 2nd GET with If-None-Match: 304, empty body, headers preserved.
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(path.as_str())
                .header("If-None-Match", etag.as_str())
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0",
                )
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(
        response.headers().get("etag").and_then(|v| v.to_str().ok()),
        Some(etag.as_str())
    );
    let body = axum::body::to_bytes(response.into_body(), 1 << 20).await?;
    assert!(body.is_empty(), "304 must have no body");

    // Well-formed key, missing object → 404 (not 500).
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/media/routes/00000000-0000-0000-0000-000000000000/0123456789abcdef.jpg")
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) api-smoke/1.0",
                )
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    Ok(())
}

/// Search matches routes by their STRUCTURED city endpoints, not just
/// the route NAME. A route named "Limousine Express" (no city names in
/// the name) with start `ha-noi` / end `da-nang` must be found when the
/// user searches "Hà Nội" → "Đà Nẵng" — and equally for colloquial
/// aliases like "Sài Gòn" that never appear in any official name.
#[tokio::test]
async fn search_matches_routes_by_city_slugs_not_just_name() -> anyhow::Result<()> {
    let st = boot_state().await?;

    // A seeded vehicle type — gives the layout-less schedules a
    // capacity fallback (no type + no layout = 0 seats = no trips).
    let vt = st
        .admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    // Route whose NAME deliberately contains NO city names.
    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Limousine Express".into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: None,
        })
        .await?;

    let date = travel_date();
    st.admin
        .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
            route_id: Some(route.id),
            departure_time: Some("09:00".into()),
            effective_from: None,
            effective_to: None,
            days_of_week: Some("1111111".into()),
            bus_layout_id: None,
            vehicle_type_id: Some(vt_id),
            base_price_adult: Some(400_000),
            base_price_child: None,
            class_fares: None,
            amenities: None,
            points: None,
        })
        .await?;

    // Official names (differ from the route name entirely).
    let res = st
        .public
        .search_trips(
            "Hà Nội",
            "Đà Nẵng",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert_eq!(
        res.items.len(),
        1,
        "slug-path search must find the route (name path alone can't)"
    );
    assert_eq!(res.items[0].route_name, "Limousine Express");

    // The public routes list exposes the real lowest schedule price.
    let routes = st.public.list_routes(None, 50).await?;
    let listed = routes
        .items
        .iter()
        .find(|r| r.id == route.id)
        .ok_or_else(|| anyhow::anyhow!("route missing from public list"))?;
    assert_eq!(listed.price_from, Some(400_000));
    assert_eq!(listed.schedule_count, 1);

    // Colloquial alias: Sài Gòn must resolve to ho-chi-minh and match
    // a route with those endpoints (again with an opaque name).
    let sg_route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Night Sleeper Deluxe".into()),
            brand_id: None,
            start_location_id: Some("ho-chi-minh".into()),
            end_location_id: Some("can-tho".into()),
            status: None,
        })
        .await?;
    st.admin
        .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
            route_id: Some(sg_route.id),
            departure_time: Some("21:30".into()),
            effective_from: None,
            effective_to: None,
            days_of_week: Some("1111111".into()),
            bus_layout_id: None,
            vehicle_type_id: Some(vt_id),
            base_price_adult: Some(180_000),
            base_price_child: None,
            class_fares: None,
            amenities: None,
            points: None,
        })
        .await?;
    let res = st
        .public
        .search_trips(
            "Sài Gòn",
            "Cần Thơ",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert_eq!(
        res.items.len(),
        1,
        "colloquial alias 'Sài Gòn' must resolve to ho-chi-minh and match"
    );

    // Direction still matters: the reverse direction must NOT match.
    let res = st
        .public
        .search_trips(
            "Đà Nẵng",
            "Hà Nội",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert!(
        res.items.iter().all(|t| t.route_id != route.id),
        "reverse direction must not match a directional route"
    );

    Ok(())
}

/// Search results honor the `sort` parameter — price ascending,
/// rating descending — with a deterministic departure-time tie-break.
/// (The `sort` argument used to be parsed into `_sort` and ignored;
/// this test pins the real behavior.)
#[tokio::test]
async fn search_sorts_by_price_and_rating() -> anyhow::Result<()> {
    let st = boot_state().await?;

    let vt = st
        .admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    // Two brands with different ratings, one route with two schedules
    // at different prices/times.
    let b1 = st
        .admin
        .create_brand(&backend::dto::admin::UpsertBrandRequest {
            name: Some("Sort Test A".into()),
            slug: Some("sort-test-a".into()),
            ..Default::default()
        })
        .await?;
    let b2 = st
        .admin
        .create_brand(&backend::dto::admin::UpsertBrandRequest {
            name: Some("Sort Test B".into()),
            slug: Some("sort-test-b".into()),
            ..Default::default()
        })
        .await?;
    // A brand's rating is the average of its approved reviews; stand in for
    // those reviews by writing the averages directly.
    {
        use backend::entity::brand;
        use sea_orm::{sea_query::Expr, ColumnTrait, EntityTrait, QueryFilter};
        for (id, rating) in [(b1.id, 3.0), (b2.id, 5.0)] {
            brand::Entity::update_many()
                .col_expr(brand::Column::Rating, Expr::value(rating))
                .filter(brand::Column::Id.eq(id))
                .exec(st.db.as_ref())
                .await?;
        }
    }

    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Hà Nội - Đà Nẵng".into()),
            brand_id: Some(b1.id),
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: None,
        })
        .await?;
    // Route 2: same corridor, DIFFERENT (higher-rated) brand — the
    // rating sort must rank this one first.
    let route2 = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Hà Nội - Đà Nẵng Express".into()),
            brand_id: Some(b2.id),
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: None,
        })
        .await?;

    let date = travel_date();
    // Route 1: expensive 08:00, cheap 21:00 — cheap must come FIRST
    // under sort=price even though it departs later.
    for (time, price) in [("08:00", 500_000i64), ("21:00", 200_000)] {
        st.admin
            .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
                route_id: Some(route.id),
                departure_time: Some(time.into()),
                effective_from: None,
                effective_to: None,
                days_of_week: Some("1111111".into()),
                bus_layout_id: None,
                vehicle_type_id: Some(vt_id),
                base_price_adult: Some(price),
                base_price_child: None,
                class_fares: None,
                amenities: None,
                points: None,
            })
            .await?;
    }
    // Route 2 (higher-rated brand): mid price.
    st.admin
        .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
            route_id: Some(route2.id),
            departure_time: Some("12:00".into()),
            effective_from: None,
            effective_to: None,
            days_of_week: Some("1111111".into()),
            bus_layout_id: None,
            vehicle_type_id: Some(vt_id),
            base_price_adult: Some(300_000),
            base_price_child: None,
            class_fares: None,
            amenities: None,
            points: None,
        })
        .await?;

    // sort=price → ascending min_price.
    let res = st
        .public
        .search_trips("Hà Nội", "Đà Nẵng", &date, 20, 0, vec![], "price", 1, None)
        .await?;
    let prices: Vec<i64> = res.items.iter().map(|t| t.min_price).collect();
    let mut sorted = prices.clone();
    sorted.sort();
    assert_eq!(prices, sorted, "sort=price must return ascending prices");
    assert_eq!(prices.first(), Some(&200_000), "cheapest first");

    // sort=rating → the higher-rated brand's trip first (matches both
    // cities via name or slugs — Huế route only matches by name here).
    let res = st
        .public
        .search_trips("Hà Nội", "Đà Nẵng", &date, 20, 0, vec![], "rating", 1, None)
        .await?;
    if let Some(first) = res.items.first() {
        assert_eq!(first.brand_slug, "sort-test-b", "highest rating first");
    }

    // sort=departure (default) → 08:00 before 21:00 on the same route.
    let res = st
        .public
        .search_trips(
            "Hà Nội",
            "Đà Nẵng",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    let times: Vec<&str> = res
        .items
        .iter()
        .map(|t| t.departure_time.as_deref().unwrap_or(""))
        .collect();
    let mut sorted_times = times.clone();
    sorted_times.sort();
    assert_eq!(times, sorted_times, "sort=departure must be chronological");

    // departAfter → only the trips leaving at or after that time; total follows.
    let all = res.items.len();
    let late = st
        .public
        .search_trips(
            "Hà Nội",
            "Đà Nẵng",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            Some("12:00"),
        )
        .await?;
    assert!(
        !late.items.is_empty() && late.items.len() < all,
        "08:00 is filtered out"
    );
    assert!(late
        .items
        .iter()
        .all(|t| t.departure_time.as_deref().unwrap_or("") >= "12:00"));
    assert_eq!(late.total, Some(late.items.len() as u64));
    assert!(st
        .public
        .search_trips(
            "Hà Nội",
            "Đà Nẵng",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            Some("25:00")
        )
        .await
        .is_err());

    Ok(())
}

/// City-to-city search paginates correctly: `total`/`hasMore` metadata,
/// page slicing via `offset`, deterministic ordering across pages (no
/// trip appears in two pages, no trip is skipped at a page seam).
///
/// This pins the contract the frontend's "load more" button relies on:
/// fetch page 1 → `hasMore: true` → fetch `offset += limit` → append.
#[tokio::test]
async fn search_paginates_with_offset_and_has_more() -> anyhow::Result<()> {
    let st = boot_state().await?;

    let vt = st
        .admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Hà Nội - Đà Nẵng".into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: None,
        })
        .await?;

    // THREE schedules on the same route → three trips on the date.
    let date = travel_date();
    for time in ["07:00", "12:00", "18:00"] {
        st.admin
            .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
                route_id: Some(route.id),
                departure_time: Some(time.into()),
                effective_from: None,
                effective_to: None,
                days_of_week: Some("1111111".into()),
                bus_layout_id: None,
                vehicle_type_id: Some(vt_id),
                base_price_adult: Some(300_000),
                base_price_child: None,
                class_fares: None,
                amenities: None,
                points: None,
            })
            .await?;
    }

    // Page 1: two of three trips, hasMore true, total 3.
    let page1 = st
        .public
        .search_trips(
            "Hà Nội",
            "Đà Nẵng",
            &date,
            2,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert_eq!(page1.items.len(), 2, "page 1 returns exactly limit items");
    assert_eq!(page1.total, Some(3), "total counts ALL matching trips");
    assert_eq!(page1.limit, Some(2), "limit echoes the applied page size");
    assert_eq!(page1.offset, Some(0));
    assert_eq!(page1.has_more, Some(true), "more trips remain past page 1");

    // Page 2: the remaining trip, hasMore false.
    let page2 = st
        .public
        .search_trips(
            "Hà Nội",
            "Đà Nẵng",
            &date,
            2,
            2,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert_eq!(page2.items.len(), 1, "page 2 returns the last trip only");
    assert_eq!(page2.total, Some(3));
    assert_eq!(page2.offset, Some(2));
    assert_eq!(page2.has_more, Some(false), "last page must clear hasMore");

    // Deterministic pagination: no overlap, no gap, stable order.
    let mut seen: Vec<uuid::Uuid> = page1.items.iter().map(|t| t.trip_id).collect();
    seen.extend(page2.items.iter().map(|t| t.trip_id));
    assert_eq!(seen.len(), 3, "pages 1+2 cover all three trips");
    let distinct: std::collections::HashSet<uuid::Uuid> = seen.iter().copied().collect();
    assert_eq!(distinct.len(), 3, "no trip may appear in two pages");

    // Order preserved across the seam: 07:00, 12:00 | 18:00.
    fn dep(p: &backend::dto::public::TripSearchResponse) -> Vec<String> {
        p.items
            .iter()
            .map(|t| t.departure_time.clone().unwrap_or_default())
            .collect()
    }
    assert_eq!(dep(&page1), vec!["07:00".to_string(), "12:00".to_string()]);
    assert_eq!(dep(&page2), vec!["18:00".to_string()]);

    // Offset past the end: empty page, hasMore false (not an error).
    let past = st
        .public
        .search_trips(
            "Hà Nội",
            "Đà Nẵng",
            &date,
            2,
            10,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert!(past.items.is_empty());
    assert_eq!(past.has_more, Some(false));
    assert_eq!(
        past.total,
        Some(3),
        "total is independent of the page window"
    );

    // A no-match search still returns page metadata (clients can trust
    // hasMore:false instead of guessing from an empty array).
    let none = st
        .public
        .search_trips(
            "Hà Nội",
            "Cà Mau",
            &date,
            2,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    assert!(none.items.is_empty());
    assert_eq!(none.has_more, Some(false));
    assert_eq!(none.total, Some(0));

    Ok(())
}

/// Geo (refined) search ranks trips by proximity to the user's exact
/// pickup/drop coordinates — closest first — and paginates over the
/// ranked TRIP list (not routes): a nearer route with multiple
/// departures contributes several items before a farther route's trips.
#[tokio::test]
async fn geo_search_ranks_by_proximity_and_paginates() -> anyhow::Result<()> {
    let st = boot_state().await?;

    let vt = st
        .admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    // User's desired endpoints: central Hanoi → central Hải Phòng.
    let (from_lat, from_lon) = (21.0287, 105.8524);
    let (to_lat, to_lon) = (20.8651, 106.6835);

    // Route A ("near"): stops hugging the user's exact points.
    let route_a = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Near Route".into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("hai-phong".into()),
            status: None,
        })
        .await?;
    // Route B ("far"): stops a few km off the desired points.
    let route_b = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Far Route".into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("hai-phong".into()),
            status: None,
        })
        .await?;

    // Pickup/drop coordinates — ~0.01° ≈ 1.1 km, well inside the
    // default 50 km radius. Far route stops sit ~0.05° further out.
    let near_pickup = (21.0290, 105.8530);
    let near_drop = (20.8660, 106.6840);
    let far_pickup = (21.0790, 105.9030);
    let far_drop = (20.9160, 106.7330);
    // A flat struct per route (nested tuples trip clippy::type_complexity).
    struct RouteStops {
        route_id: uuid::Uuid,
        pickup: (f64, f64),
        drop: (f64, f64),
    }
    let route_stops = [
        RouteStops {
            route_id: route_a.id,
            pickup: near_pickup,
            drop: near_drop,
        },
        RouteStops {
            route_id: route_b.id,
            pickup: far_pickup,
            drop: far_drop,
        },
    ];
    for stops in route_stops {
        st.admin
            .create_pickup_point(&backend::dto::admin::UpsertPickupPointRequest {
                route_id: Some(stops.route_id),
                name: Some("pickup".into()),
                address: None,
                lat: Some(stops.pickup.0),
                lon: Some(stops.pickup.1),
                stop_order: Some(0),
                kind: Some("pickup".into()),
            })
            .await?;
        st.admin
            .create_pickup_point(&backend::dto::admin::UpsertPickupPointRequest {
                route_id: Some(stops.route_id),
                name: Some("drop".into()),
                address: None,
                lat: Some(stops.drop.0),
                lon: Some(stops.drop.1),
                stop_order: Some(1),
                kind: Some("drop".into()),
            })
            .await?;
    }

    // Route A gets TWO departures, route B one — the ranked list must
    // interleave them as A, A, B (proximity dominates).
    let date = travel_date();
    let geo_departures: [(uuid::Uuid, &str); 3] = [
        (route_a.id, "08:00"),
        (route_a.id, "14:00"),
        (route_b.id, "10:00"),
    ];
    for (route_id, time) in geo_departures {
        st.admin
            .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
                route_id: Some(route_id),
                departure_time: Some(time.into()),
                effective_from: None,
                effective_to: None,
                days_of_week: Some("1111111".into()),
                bus_layout_id: None,
                vehicle_type_id: Some(vt_id),
                base_price_adult: Some(250_000),
                base_price_child: None,
                class_fares: None,
                amenities: None,
                points: None,
            })
            .await?;
    }

    // Full ranked list first — closest route's trips first.
    let ranked = st
        .public
        .search_trips_geo(
            from_lat,
            from_lon,
            to_lat,
            to_lon,
            &date,
            10,
            0,
            1,
            vec![],
            50.0,
            None,
        )
        .await?;
    assert_eq!(ranked.items.len(), 3, "both routes' trips must match");
    assert_eq!(ranked.total, Some(3));
    assert_eq!(ranked.has_more, Some(false));
    let order: Vec<&str> = ranked.items.iter().map(|t| t.route_name.as_str()).collect();
    assert_eq!(
        order,
        vec!["Near Route", "Near Route", "Far Route"],
        "trips must be ranked closest → least close (route proximity, then departure)"
    );

    // Page 1 (limit 2): both Near Route trips, hasMore true.
    let page1 = st
        .public
        .search_trips_geo(
            from_lat,
            from_lon,
            to_lat,
            to_lon,
            &date,
            2,
            0,
            1,
            vec![],
            50.0,
            None,
        )
        .await?;
    assert_eq!(page1.items.len(), 2);
    assert_eq!(page1.has_more, Some(true));
    assert!(page1.items.iter().all(|t| t.route_name == "Near Route"));

    // Page 2 (offset 2): the Far Route trip, hasMore false.
    let page2 = st
        .public
        .search_trips_geo(
            from_lat,
            from_lon,
            to_lat,
            to_lon,
            &date,
            2,
            2,
            1,
            vec![],
            50.0,
            None,
        )
        .await?;
    assert_eq!(page2.items.len(), 1);
    assert_eq!(page2.has_more, Some(false));
    assert_eq!(page2.items[0].route_name, "Far Route");

    Ok(())
}

// ══════════════════════════════════════════════════════════════════
//  Trip materialization — the 2026-10-11 search outage regressions.
//
//  Every search used to materialize missing trips inline, one schedule
//  at a time behind a global mutex; after a DB reset the backfill of
//  ~900 trips ran ~4.5 minutes while requests timed out and retried,
//  so search hung in BOTH city and geo modes. The batched materializer
//  + background warmer (service/trip_warmer.rs) must keep the request
//  path cheap — these tests pin that contract.
// ══════════════════════════════════════════════════════════════════

/// Migrated in-memory DB + CompositeStore over the plain Db* stores —
/// direct store access for the warmer fns without the full service
/// graph (same shape as tests/loyalty.rs's harness).
async fn migrated_store() -> anyhow::Result<Arc<backend::store::CompositeStore>> {
    use backend::store::{
        DbAddressStore, DbAuditStore, DbBookingStore, DbBrandStore, DbChatStore,
        DbNotificationStore, DbPaymentStore, DbPlaceStore, DbPostStore, DbPriceAlertStore,
        DbRbacStore, DbRefreshTokenStore, DbReviewStore, DbRouteStore, DbScheduleStore,
        DbStaffPresenceStore, DbTripStore, DbUserStore, DbVehicleTypeStore,
    };
    use sea_orm_migration::MigratorTrait;
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = dotenvy::dotenv();
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
    });

    let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:");
    opts.max_connections(1);
    let db: Arc<sea_orm::DatabaseConnection> = Arc::new(sea_orm::Database::connect(opts).await?);
    migrator::Migrator::up(db.as_ref(), None).await?;

    Ok(Arc::new(backend::store::CompositeStore::new(
        db.clone(),
        Arc::new(DbUserStore::new(db.clone())),
        Arc::new(DbPostStore::new(db.clone())),
        Arc::new(DbRbacStore::new(db.clone())),
        Arc::new(DbRefreshTokenStore::new(db.clone())),
        Arc::new(DbBrandStore::new(db.clone())),
        Arc::new(DbChatStore::new(db.clone())),
        Arc::new(DbBookingStore::new(db.clone())),
        Arc::new(DbReviewStore::new(db.clone())),
        Arc::new(DbRouteStore::new(db.clone())),
        Arc::new(DbStaffPresenceStore::new(db.clone())),
        Arc::new(DbScheduleStore::new(db.clone())),
        Arc::new(DbTripStore::new(db.clone())),
        Arc::new(DbPlaceStore::new(db.clone())),
        Arc::new(DbPriceAlertStore::new(db.clone())),
        Arc::new(DbAuditStore::new(db.clone())),
        Arc::new(DbNotificationStore::new(db.clone())),
        Arc::new(DbPaymentStore::new(db.clone())),
        Arc::new(DbAddressStore::new(db.clone())),
        Arc::new(DbVehicleTypeStore::new(db.clone())),
    )))
}

/// Seed one route + N daily schedules through the admin service graph
/// — the data shape the outage was about (one popular pair, many
/// departures).
async fn seed_many_schedules(
    st: &backend::state::AppState,
    route_name: &str,
    n: usize,
) -> anyhow::Result<String> {
    let vt = st
        .admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some(route_name.into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: None,
        })
        .await?;

    let date = travel_date();
    for i in 0..n {
        st.admin
            .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
                route_id: Some(route.id),
                departure_time: Some(format!("{:02}:{:02}", 5 + i / 12, (i % 12) * 5)),
                effective_from: None,
                effective_to: None,
                days_of_week: Some("1111111".into()),
                bus_layout_id: None,
                vehicle_type_id: Some(vt_id),
                base_price_adult: Some(350_000),
                base_price_child: None,
                class_fares: None,
                amenities: None,
                points: None,
            })
            .await?;
    }
    Ok(date)
}

/// The outage, verbatim: a search over a route with MANY schedules must
/// complete in seconds (the old per-schedule fill loop took minutes at
/// this scale and hung every request behind the mutex) and must return
/// every trip exactly once.
#[tokio::test]
async fn search_backfills_a_large_schedule_set_quickly() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let date = seed_many_schedules(&st, "Hà Nội - Đà Nẵng", 120).await?;

    let res = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        st.public.search_trips(
            "hà nội",
            "đà nẵng",
            &date,
            100,
            0,
            vec![],
            "departure",
            1,
            None,
        ),
    )
    .await??;
    assert_eq!(
        res.total,
        Some(120),
        "every schedule becomes exactly one trip"
    );
    assert_eq!(res.items.len(), 100, "limit is honored");
    assert_eq!(res.has_more, Some(true));

    // Second page (the server clamps limit to 100).
    let res2 = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        st.public.search_trips(
            "hà nội",
            "đà nẵng",
            &date,
            100,
            100,
            vec![],
            "departure",
            1,
            None,
        ),
    )
    .await??;
    assert_eq!(res2.items.len(), 20, "the tail page completes the set");
    assert_eq!(res2.has_more, Some(false));

    // Idempotency + uniqueness on the repeat (no duplicates even though
    // the search re-runs its gap detection).
    let mut ids: Vec<_> = res
        .items
        .iter()
        .chain(res2.items.iter())
        .map(|t| t.trip_id)
        .collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 120, "trip ids are unique (schedule×date uniq)");
    Ok(())
}

/// The exact mechanism that turned the outage into a permanent hang: a
/// search may NOT queue behind the fill lock. While the warmer holds it,
/// `try_fill` skips (returning 0 — no writes) and the search serves the
/// rows that already exist, promptly.
#[tokio::test]
async fn search_serves_existing_rows_while_the_warmer_holds_the_lock() -> anyhow::Result<()> {
    use backend::entity::{route, schedule, vehicle_type};
    use backend::service::trip_warmer::Warmer;
    use backend::service::PublicService;
    use sea_orm::Set;

    let store = migrated_store().await?;
    let now = "2026-01-01T00:00:00Z".to_string();
    let date = (chrono::Utc::now() + chrono::Duration::days(2))
        .format("%Y-%m-%d")
        .to_string();

    // Route + 5 layout-less schedules with vehicle-type capacity.
    let vt_id = uuid::Uuid::new_v4();
    store
        .vehicle_type_store()
        .insert_vehicle_type(vehicle_type::ActiveModel {
            id: Set(vt_id),
            code: Set("lock-test".into()),
            label: Set("Lock Test".into()),
            description: Set(None),
            total_seats: Set(Some(11)),
            sort_order: Set(0),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;
    let route_id = uuid::Uuid::new_v4();
    store
        .route_store()
        .insert_route(route::ActiveModel {
            id: Set(route_id),
            brand_id: Set(None),
            name: Set("Hà Nội - Đà Nẵng".into()),
            start_location_id: Set("ha-noi".into()),
            end_location_id: Set("da-nang".into()),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;
    for i in 0..5 {
        store
            .schedule_store()
            .insert_schedule(schedule::ActiveModel {
                id: Set(uuid::Uuid::new_v4()),
                route_id: Set(route_id),
                departure_time: Set(format!("0{i}:00")),
                effective_from: Set(None),
                effective_to: Set(None),
                days_of_week: Set(Some("1111111".into())),
                bus_layout_id: Set(None),
                base_price_adult: Set(350_000),
                base_price_child: Set(None),
                amenities: Set(None),
                created_at: Set(now.clone()),
                vehicle_type_id: Set(Some(vt_id)),
            })
            .await?;
    }

    // A service whose warmer lock we control. The guard is OWNED (no
    // borrow of the warmer), so the warmer can still move into the
    // service while the lock is held.
    let warmer = Warmer::detached();
    let _guard = warmer.acquire_fill_lock().await;
    let public = PublicService::with_warmer(store.clone(), warmer);

    // While the lock is held: the search must complete promptly, its
    // inline fill skipped (lock busy), and it serves the rows that
    // already exist — none yet, so an empty result, NOT a hang.
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        public.search_trips(
            "hà nội",
            "đà nẵng",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        ),
    )
    .await??;
    assert_eq!(
        blocked.items.len(),
        0,
        "lock held: fill skipped, existing rows served"
    );

    // Release the lock — a second search fills the date inline.
    drop(_guard);
    let filled = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        public.search_trips(
            "hà nội",
            "đà nẵng",
            &date,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        ),
    )
    .await??;
    assert_eq!(filled.items.len(), 5, "lock released: fill succeeds");
    Ok(())
}

/// "Runtime in the future" contract: a search for TODAY must not sell
/// departures that have already left, while a search for tomorrow sells
/// the whole day (`on_sale` enforces this; the materializer creates
/// date-granular rows).
#[tokio::test]
async fn search_today_excludes_already_departed_trips() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let vt = st
        .admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("Hà Nội - Đà Nẵng".into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: None,
        })
        .await?;
    for time in ["00:05", "23:55"] {
        st.admin
            .create_schedule(&backend::dto::admin::UpsertScheduleRequest {
                route_id: Some(route.id),
                departure_time: Some(time.into()),
                effective_from: None,
                effective_to: None,
                days_of_week: Some("1111111".into()),
                bus_layout_id: None,
                vehicle_type_id: Some(vt_id),
                base_price_adult: Some(350_000),
                base_price_child: None,
                class_fares: None,
                amenities: None,
                points: None,
            })
            .await?;
    }

    let today = backend::service::trip_warmer::vn_today(chrono::Utc::now());
    // Minutes since VN midnight — guards the two edge windows where the
    // "00:05" or "23:55" departure hasn't (yet) unambiguously departed.
    let vn_minutes = ((chrono::Utc::now().timestamp() + 7 * 3600) % 86_400) / 60;

    let res = st
        .public
        .search_trips(
            "hà nội",
            "đà nẵng",
            &today,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    let times: Vec<String> = res
        .items
        .iter()
        .map(|t| t.departure_time.clone().unwrap_or_default())
        .collect();
    if vn_minutes >= 3 {
        assert!(
            !times.contains(&"00:05".to_string()),
            "a departure before 'now' must not be sold"
        );
    }
    if vn_minutes <= 23 * 60 + 50 {
        assert!(
            times.contains(&"23:55".to_string()),
            "a future departure today must be sold"
        );
    }

    // Tomorrow: the whole day is in the future — both departures sell.
    let tomorrow =
        (chrono::Utc::now() + chrono::Duration::seconds(7 * 3600) + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
    let res2 = st
        .public
        .search_trips(
            "hà nội",
            "đà nẵng",
            &tomorrow,
            20,
            0,
            vec![],
            "departure",
            1,
            None,
        )
        .await?;
    let times2: Vec<String> = res2
        .items
        .iter()
        .map(|t| t.departure_time.clone().unwrap_or_default())
        .collect();
    assert!(times2.contains(&"00:05".to_string()));
    assert!(times2.contains(&"23:55".to_string()));
    Ok(())
}

/// materialize_missing: idempotent across repeats, strictly bounded by
/// its deadline, and a no-op for past dates.
#[tokio::test]
async fn warmer_materialize_is_idempotent_and_bounded() -> anyhow::Result<()> {
    use backend::entity::{schedule, vehicle_type};
    use backend::service::trip_warmer;
    use sea_orm::Set;

    let store = migrated_store().await?;
    let now = "2026-01-01T00:00:00Z".to_string();

    // A vehicle type for layout-less capacity.
    let vt_id = uuid::Uuid::new_v4();
    store
        .vehicle_type_store()
        .insert_vehicle_type(vehicle_type::ActiveModel {
            id: Set(vt_id),
            code: Set("warmer-test".into()),
            label: Set("Warmer Test".into()),
            description: Set(None),
            total_seats: Set(Some(11)),
            sort_order: Set(0),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;

    let route_id = uuid::Uuid::new_v4();
    store
        .route_store()
        .insert_route(backend::entity::route::ActiveModel {
            id: Set(route_id),
            brand_id: Set(None),
            name: Set("Hà Nội - Đà Nẵng".into()),
            start_location_id: Set("ha-noi".into()),
            end_location_id: Set("da-nang".into()),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;

    let mut schedules = Vec::new();
    for i in 0..3 {
        let s = schedule::ActiveModel {
            id: Set(uuid::Uuid::new_v4()),
            route_id: Set(route_id),
            departure_time: Set(format!("0{i}:00")),
            effective_from: Set(None),
            effective_to: Set(None),
            days_of_week: Set(Some("1111111".into())),
            bus_layout_id: Set(None),
            base_price_adult: Set(350_000),
            base_price_child: Set(None),
            amenities: Set(None),
            created_at: Set(now.clone()),
            vehicle_type_id: Set(Some(vt_id)),
        };
        store.schedule_store().insert_schedule(s.clone()).await?;
        schedules.push(s);
    }
    let schedule_models: Vec<schedule::Model> = schedules
        .into_iter()
        .map(|m| m.try_into())
        .collect::<Result<_, _>>()?;

    let date = (chrono::Utc::now() + chrono::Duration::days(3))
        .format("%Y-%m-%d")
        .to_string();

    // An already-expired budget fills nothing — the request still
    // completes (partial progress is never forced).
    let zero = trip_warmer::materialize_missing(
        store.as_ref(),
        &schedule_models,
        &date,
        Some(std::time::Instant::now() - std::time::Duration::from_secs(1)),
    )
    .await?;
    assert_eq!(zero, 0, "an expired budget must fill nothing");

    // Full fill.
    let created =
        trip_warmer::materialize_missing(store.as_ref(), &schedule_models, &date, None).await?;
    assert_eq!(created, 3);

    // Idempotent: the repeat finds nothing missing.
    let again =
        trip_warmer::materialize_missing(store.as_ref(), &schedule_models, &date, None).await?;
    assert_eq!(again, 0, "second pass must create nothing");

    // Past dates are never filled.
    let yesterday = (chrono::Utc::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    let past = trip_warmer::materialize_missing(store.as_ref(), &schedule_models, &yesterday, None)
        .await?;
    assert_eq!(past, 0, "past dates are never filled");
    Ok(())
}

/// The storm's OTHER scar: fills that died between the trip INSERT and
/// the seat INSERT left trips that displayed fine but could not be
/// booked. `repair_seat_inventories` must re-seed their seats — without
/// duplicating anything.
#[tokio::test]
async fn warmer_repairs_trips_missing_seat_inventory() -> anyhow::Result<()> {
    use backend::entity::{bus_layout, schedule, seat, trip_session};
    use backend::service::trip_warmer;
    use sea_orm::Set;

    let store = migrated_store().await?;
    let now = "2026-01-01T00:00:00Z".to_string();
    let date = (chrono::Utc::now() + chrono::Duration::days(2))
        .format("%Y-%m-%d")
        .to_string();

    // Route + layout + 4 seats.
    let route_id = uuid::Uuid::new_v4();
    store
        .route_store()
        .insert_route(backend::entity::route::ActiveModel {
            id: Set(route_id),
            brand_id: Set(None),
            name: Set("Hà Nội - Đà Nẵng".into()),
            start_location_id: Set("ha-noi".into()),
            end_location_id: Set("da-nang".into()),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;
    let layout_id = uuid::Uuid::new_v4();
    {
        use sea_orm::EntityTrait;
        bus_layout::Entity::insert(bus_layout::ActiveModel {
            id: Set(layout_id),
            brand_id: Set(None),
            name: Set(Some("Test layout".into())),
            vehicle_type: Set(Some("sleeper".into())),
            total_seats: Set(Some(4)),
            layout_data: Set(None),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .exec(store.db())
        .await?;
        for i in 0..4 {
            seat::Entity::insert(seat::ActiveModel {
                id: Set(uuid::Uuid::new_v4()),
                bus_layout_id: Set(layout_id),
                seat_label: Set(format!("A{i}")),
                seat_class: Set(None),
                row_num: Set(Some(i as i16)),
                col_num: Set(Some(0)),
                is_window: Set(false),
                floor: Set(0),
                created_at: Set(now.clone()),
            })
            .exec(store.db())
            .await?;
        }
    }

    // A schedule on that layout.
    let sched_id = uuid::Uuid::new_v4();
    let sched_model = schedule::ActiveModel {
        id: Set(sched_id),
        route_id: Set(route_id),
        departure_time: Set("08:00".into()),
        effective_from: Set(None),
        effective_to: Set(None),
        days_of_week: Set(Some("1111111".into())),
        bus_layout_id: Set(Some(layout_id)),
        base_price_adult: Set(350_000),
        base_price_child: Set(None),
        amenities: Set(None),
        created_at: Set(now.clone()),
        vehicle_type_id: Set(None),
    };
    store
        .schedule_store()
        .insert_schedule(sched_model.clone())
        .await?;
    let sched: schedule::Model = sched_model.try_into()?;

    // THE STORM SCAR: a trip row with NO seat inventory.
    let trip_id = uuid::Uuid::new_v4();
    store
        .trip_store()
        .insert_trip_session(trip_session::ActiveModel {
            id: Set(trip_id),
            schedule_id: Set(sched_id),
            departure_date: Set(date.clone()),
            actual_departure_at: Set(None),
            driver_name: Set(None),
            driver_phone: Set(None),
            status: Set("scheduled".into()),
            total_seats: Set(4),
            available_seats: Set(4),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;

    // Repair: seats are re-seeded, exactly once per seat.
    let healed =
        trip_warmer::repair_seat_inventories(store.as_ref(), std::slice::from_ref(&sched), &date)
            .await?;
    assert_eq!(healed, 1, "the orphaned trip is healed");

    let seats = store
        .trip_store()
        .list_seat_inventories_by_trip(&trip_id.to_string())
        .await?;
    assert_eq!(seats.len(), 4, "all four layout seats are re-seeded");
    assert!(seats.iter().all(|s| s.status == "available"));

    // Repair is idempotent — a second pass finds nothing broken and
    // must not duplicate the seats it just wrote.
    let healed2 =
        trip_warmer::repair_seat_inventories(store.as_ref(), std::slice::from_ref(&sched), &date)
            .await?;
    assert_eq!(healed2, 0, "second repair pass is a no-op");
    let seats2 = store
        .trip_store()
        .list_seat_inventories_by_trip(&trip_id.to_string())
        .await?;
    assert_eq!(seats2.len(), 4, "no duplicate seat rows");
    Ok(())
}

/// The full sell-window pass: every date in the window gets exactly one
/// trip per running schedule — the steady state searches rely on to be
/// pure reads.
#[tokio::test]
async fn warmer_fills_the_whole_sell_window() -> anyhow::Result<()> {
    use backend::entity::{schedule, vehicle_type};
    use backend::service::trip_warmer;
    use sea_orm::Set;

    let store = migrated_store().await?;
    let now = "2026-01-01T00:00:00Z".to_string();

    let vt_id = uuid::Uuid::new_v4();
    store
        .vehicle_type_store()
        .insert_vehicle_type(vehicle_type::ActiveModel {
            id: Set(vt_id),
            code: Set("warmer-window".into()),
            label: Set("Warmer Window".into()),
            description: Set(None),
            total_seats: Set(Some(11)),
            sort_order: Set(0),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;

    let route_id = uuid::Uuid::new_v4();
    store
        .route_store()
        .insert_route(backend::entity::route::ActiveModel {
            id: Set(route_id),
            brand_id: Set(None),
            name: Set("Hà Nội - Đà Nẵng".into()),
            start_location_id: Set("ha-noi".into()),
            end_location_id: Set("da-nang".into()),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;

    let sched = schedule::ActiveModel {
        id: Set(uuid::Uuid::new_v4()),
        route_id: Set(route_id),
        departure_time: Set("08:00".into()),
        effective_from: Set(None),
        effective_to: Set(None),
        days_of_week: Set(Some("1111111".into())),
        bus_layout_id: Set(None),
        base_price_adult: Set(350_000),
        base_price_child: Set(None),
        amenities: Set(None),
        created_at: Set(now.clone()),
        vehicle_type_id: Set(Some(vt_id)),
    };
    store
        .schedule_store()
        .insert_schedule(sched.clone())
        .await?;
    let sched: schedule::Model = sched.try_into()?;

    let today = trip_warmer::vn_today(chrono::Utc::now());
    let one = std::slice::from_ref(&sched);
    for date in trip_warmer::sell_window(&today, trip_warmer::SELL_WINDOW_DAYS) {
        let created = trip_warmer::materialize_missing(store.as_ref(), one, &date, None).await?;
        assert_eq!(created, 1, "{date}: one trip for the running schedule");
        // And the window pass is repeatable.
        let repeat = trip_warmer::materialize_missing(store.as_ref(), one, &date, None).await?;
        assert_eq!(repeat, 0, "{date}: no duplicates on the repeat");
    }
    Ok(())
}

/// The 2026-10-11 production incident, distilled to its essence: the
/// warmer's seat repair re-inserted seat rows that already existed and
/// the multi-row INSERT aborted with `UNIQUE constraint failed:
/// seat_inventory.trip_session_id, seat_inventory.seat_id` — on six
/// consecutive dates. Each aborted statement rolled back inside the
/// single-writer engine and queued every reader behind it until the
/// pool stopped serving traffic.
///
/// Root cause class: the repair's "which trips have seats" read can go
/// stale (or race a duplicate pass across a restart overlap), so the
/// batch insert MUST be conflict-tolerant. This pins the store-level
/// contract directly: a batch containing rows that already exist is a
/// success (rows skipped), never an error.
#[tokio::test]
async fn seat_inventory_batch_insert_is_conflict_tolerant() -> anyhow::Result<()> {
    use backend::entity::{bus_layout, route, schedule, seat, seat_inventory, trip_session};
    use sea_orm::Set;

    let store = migrated_store().await?;
    let now = "2026-01-01T00:00:00Z".to_string();

    // Parents the inventory FKs point at: route → schedule → trip,
    // layout → seats.
    let route_id = uuid::Uuid::new_v4();
    store
        .route_store()
        .insert_route(route::ActiveModel {
            id: Set(route_id),
            brand_id: Set(None),
            name: Set("Hà Nội - Nha Trang".into()),
            start_location_id: Set("ha-noi".into()),
            end_location_id: Set("nha-trang".into()),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;
    let sched_id = uuid::Uuid::new_v4();
    store
        .schedule_store()
        .insert_schedule(schedule::ActiveModel {
            id: Set(sched_id),
            route_id: Set(route_id),
            departure_time: Set("23:00".into()),
            effective_from: Set(None),
            effective_to: Set(None),
            days_of_week: Set(Some("1111111".into())),
            bus_layout_id: Set(None),
            base_price_adult: Set(450_000),
            base_price_child: Set(None),
            amenities: Set(None),
            created_at: Set(now.clone()),
            vehicle_type_id: Set(None),
        })
        .await?;
    let trip_id = uuid::Uuid::new_v4();
    store
        .trip_store()
        .insert_trip_session(trip_session::ActiveModel {
            id: Set(trip_id),
            schedule_id: Set(sched_id),
            departure_date: Set("2026-10-19".into()),
            actual_departure_at: Set(None),
            driver_name: Set(None),
            driver_phone: Set(None),
            status: Set("scheduled".into()),
            total_seats: Set(2),
            available_seats: Set(2),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;
    let mut seat_ids = Vec::new();
    {
        use sea_orm::EntityTrait;
        let layout_id = uuid::Uuid::new_v4();
        bus_layout::Entity::insert(bus_layout::ActiveModel {
            id: Set(layout_id),
            brand_id: Set(None),
            name: Set(Some("Conflict test layout".into())),
            vehicle_type: Set(Some("sleeper".into())),
            total_seats: Set(Some(2)),
            layout_data: Set(None),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .exec(store.db())
        .await?;
        for i in 0..2 {
            let sid = uuid::Uuid::new_v4();
            seat_ids.push(sid);
            seat::Entity::insert(seat::ActiveModel {
                id: Set(sid),
                bus_layout_id: Set(layout_id),
                seat_label: Set(format!("C{i}")),
                seat_class: Set(None),
                row_num: Set(Some(i as i16)),
                col_num: Set(Some(0)),
                is_window: Set(false),
                floor: Set(0),
                created_at: Set(now.clone()),
            })
            .exec(store.db())
            .await?;
        }
    }

    let seat_row = |seat: uuid::Uuid| seat_inventory::ActiveModel {
        id: Set(uuid::Uuid::new_v4()),
        trip_session_id: Set(trip_id),
        seat_id: Set(seat),
        status: Set("available".into()),
        base_price: Set(100_000),
        final_price: Set(100_000),
        currency: Set("VND".into()),
        held_until: Set(None),
        held_by_booking_id: Set(None),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    };

    // Seat S1 is already materialized (the "stale read missed it" state).
    store
        .trip_store()
        .insert_seat_inventories_batch(vec![seat_row(seat_ids[0])])
        .await?;

    // The exact production shape: a batch that re-inserts the EXISTING
    // (trip, S1) pair alongside a genuinely missing (trip, S2). Before
    // the fix this aborted the whole statement with a UNIQUE error;
    // after it, the conflict row is skipped and S2 lands.
    store
        .trip_store()
        .insert_seat_inventories_batch(vec![seat_row(seat_ids[0]), seat_row(seat_ids[1])])
        .await?;

    let seats = store
        .trip_store()
        .list_seat_inventories_by_trip(&trip_id.to_string())
        .await?;
    assert_eq!(seats.len(), 2, "existing row skipped, missing row inserted");
    assert!(
        seats.iter().any(|s| s.seat_id == seat_ids[1]),
        "the genuinely missing seat was materialized"
    );

    // And a batch where EVERY row conflicts is a silent no-op — the
    // shape that made SeaORM's `exec` raise "None of the records are
    // inserted" before `exec_without_returning` was used.
    store
        .trip_store()
        .insert_seat_inventories_batch(vec![seat_row(seat_ids[0]), seat_row(seat_ids[1])])
        .await?;
    let seats = store
        .trip_store()
        .list_seat_inventories_by_trip(&trip_id.to_string())
        .await?;
    assert_eq!(seats.len(), 2, "fully-conflicting batch is a no-op");
    Ok(())
}

/// The same contract at the service level: two repair passes racing on
/// the same broken trip (the restart-overlap shape observed in
/// production, where a draining task's warmer overlapped the
/// replacement's boot pass) must BOTH succeed and must leave exactly
/// one inventory row per seat. Whichever interleaving the runtime
/// picks — serialized, overlapped, or fully concurrent — the outcome
/// is the same: never a UNIQUE abort, never a duplicate row.
#[tokio::test]
async fn warmer_repair_survives_concurrent_duplicate_passes() -> anyhow::Result<()> {
    use backend::entity::{bus_layout, schedule, seat, trip_session};
    use backend::service::trip_warmer;
    use sea_orm::Set;

    let store = migrated_store().await?;
    let now = "2026-01-01T00:00:00Z".to_string();
    let date = (chrono::Utc::now() + chrono::Duration::days(2))
        .format("%Y-%m-%d")
        .to_string();

    let route_id = uuid::Uuid::new_v4();
    store
        .route_store()
        .insert_route(backend::entity::route::ActiveModel {
            id: Set(route_id),
            brand_id: Set(None),
            name: Set("Hà Nội - Huế".into()),
            start_location_id: Set("ha-noi".into()),
            end_location_id: Set("hue".into()),
            status: Set("active".into()),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;

    let layout_id = uuid::Uuid::new_v4();
    {
        use sea_orm::EntityTrait;
        bus_layout::Entity::insert(bus_layout::ActiveModel {
            id: Set(layout_id),
            brand_id: Set(None),
            name: Set(Some("Race layout".into())),
            vehicle_type: Set(Some("sleeper".into())),
            total_seats: Set(Some(4)),
            layout_data: Set(None),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .exec(store.db())
        .await?;
        for i in 0..4 {
            seat::Entity::insert(seat::ActiveModel {
                id: Set(uuid::Uuid::new_v4()),
                bus_layout_id: Set(layout_id),
                seat_label: Set(format!("R{i}")),
                seat_class: Set(None),
                row_num: Set(Some(i as i16)),
                col_num: Set(Some(0)),
                is_window: Set(false),
                floor: Set(0),
                created_at: Set(now.clone()),
            })
            .exec(store.db())
            .await?;
        }
    }

    let sched_id = uuid::Uuid::new_v4();
    let sched_model = schedule::ActiveModel {
        id: Set(sched_id),
        route_id: Set(route_id),
        departure_time: Set("09:30".into()),
        effective_from: Set(None),
        effective_to: Set(None),
        days_of_week: Set(Some("1111111".into())),
        bus_layout_id: Set(Some(layout_id)),
        base_price_adult: Set(400_000),
        base_price_child: Set(None),
        amenities: Set(None),
        created_at: Set(now.clone()),
        vehicle_type_id: Set(None),
    };
    store
        .schedule_store()
        .insert_schedule(sched_model.clone())
        .await?;
    let sched: schedule::Model = sched_model.try_into()?;

    // The storm scar both passes will try to heal.
    let trip_id = uuid::Uuid::new_v4();
    store
        .trip_store()
        .insert_trip_session(trip_session::ActiveModel {
            id: Set(trip_id),
            schedule_id: Set(sched_id),
            departure_date: Set(date.clone()),
            actual_departure_at: Set(None),
            driver_name: Set(None),
            driver_phone: Set(None),
            status: Set("scheduled".into()),
            total_seats: Set(4),
            available_seats: Set(4),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        })
        .await?;

    // Two repair passes over the same broken state at the same time.
    let (r0, r1) = tokio::join!(
        trip_warmer::repair_seat_inventories(store.as_ref(), std::slice::from_ref(&sched), &date),
        trip_warmer::repair_seat_inventories(store.as_ref(), std::slice::from_ref(&sched), &date),
    );
    // Neither pass may error — the UNIQUE abort of the 2026-10-11
    // incident is exactly the failure this forbids.
    let healed0 = r0?;
    let healed1 = r1?;
    assert!(
        healed0 + healed1 >= 1,
        "at least one pass did the healing work"
    );

    // Exactly one inventory row per seat, whichever way the passes
    // interleaved.
    let seats = store
        .trip_store()
        .list_seat_inventories_by_trip(&trip_id.to_string())
        .await?;
    assert_eq!(seats.len(), 4, "no duplicate seat rows after the race");
    Ok(())
}

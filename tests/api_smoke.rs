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
        std::env::set_var("OAUTH_TWITTER_ENABLED", "false");
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
        std::env::set_var("OAUTH_TWITTER_ENABLED", "false");
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
        .search_trips("hà nội", "đà nẵng", &date, 20, 0, vec![], "departure", 1)
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
        .search_trips("hà nội", "đà nẵng", &date, 20, 0, vec![], "departure", 1)
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
        .search_trips("Hà Nội", "Đà Nẵng", &date, 20, 0, vec![], "departure", 1)
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
        .search_trips("Sài Gòn", "Cần Thơ", &date, 20, 0, vec![], "departure", 1)
        .await?;
    assert_eq!(
        res.items.len(),
        1,
        "colloquial alias 'Sài Gòn' must resolve to ho-chi-minh and match"
    );

    // Direction still matters: the reverse direction must NOT match.
    let res = st
        .public
        .search_trips("Đà Nẵng", "Hà Nội", &date, 20, 0, vec![], "departure", 1)
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
            rating: Some(3.0),
            ..Default::default()
        })
        .await?;
    let b2 = st
        .admin
        .create_brand(&backend::dto::admin::UpsertBrandRequest {
            name: Some("Sort Test B".into()),
            slug: Some("sort-test-b".into()),
            rating: Some(5.0),
            ..Default::default()
        })
        .await?;

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
        .search_trips("Hà Nội", "Đà Nẵng", &date, 20, 0, vec![], "price", 1)
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
        .search_trips("Hà Nội", "Đà Nẵng", &date, 20, 0, vec![], "rating", 1)
        .await?;
    if let Some(first) = res.items.first() {
        assert_eq!(first.brand_slug, "sort-test-b", "highest rating first");
    }

    // sort=departure (default) → 08:00 before 21:00 on the same route.
    let res = st
        .public
        .search_trips("Hà Nội", "Đà Nẵng", &date, 20, 0, vec![], "departure", 1)
        .await?;
    let times: Vec<&str> = res
        .items
        .iter()
        .map(|t| t.departure_time.as_deref().unwrap_or(""))
        .collect();
    let mut sorted_times = times.clone();
    sorted_times.sort();
    assert_eq!(times, sorted_times, "sort=departure must be chronological");

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
        .search_trips("Hà Nội", "Đà Nẵng", &date, 2, 0, vec![], "departure", 1)
        .await?;
    assert_eq!(page1.items.len(), 2, "page 1 returns exactly limit items");
    assert_eq!(page1.total, Some(3), "total counts ALL matching trips");
    assert_eq!(page1.limit, Some(2), "limit echoes the applied page size");
    assert_eq!(page1.offset, Some(0));
    assert_eq!(page1.has_more, Some(true), "more trips remain past page 1");

    // Page 2: the remaining trip, hasMore false.
    let page2 = st
        .public
        .search_trips("Hà Nội", "Đà Nẵng", &date, 2, 2, vec![], "departure", 1)
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
        .search_trips("Hà Nội", "Đà Nẵng", &date, 2, 10, vec![], "departure", 1)
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
        .search_trips("Hà Nội", "Cà Mau", &date, 2, 0, vec![], "departure", 1)
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
        )
        .await?;
    assert_eq!(page2.items.len(), 1);
    assert_eq!(page2.has_more, Some(false));
    assert_eq!(page2.items[0].route_name, "Far Route");

    Ok(())
}

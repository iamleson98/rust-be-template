//! WP5 — media over HTTP on the full router: route pictures re-encoded to
//! WebP with a thumbnail, the brand-logo upload, and the headers every
//! stored upload is served with.
//!
//! Boots the real stack (in-memory SQLite, local storage in a tempdir).
//! `/api` is rate limited by client IP, which the one-shot harness has no
//! socket for, so every request names its client in `X-Forwarded-For`.

use std::io::Cursor;
use std::sync::Once;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::response::Response;
use axum::Router;
use backend::service::auth_service::{RegisterInput, SessionContext, SessionKind};
use backend::state::AppState;
use image::{DynamicImage, ImageFormat, RgbImage};
use tower::ServiceExt;
use uuid::Uuid;

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) wp5/1.0";
const CLIENT_IP: &str = "203.0.113.7";
const ORIGIN: &str = "http://localhost:8080";
const CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const BOUNDARY: &str = "wp5-boundary";

// ────────────────────────────────────────────────────────────────
//  Harness
// ────────────────────────────────────────────────────────────────

static INIT: Once = Once::new();

fn storage_root() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("STORAGE_LOCAL_ROOT").expect("set by boot"))
}

async fn boot() -> anyhow::Result<(Router, AppState)> {
    INIT.call_once(|| {
        let _ = dotenvy::dotenv();
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
        std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
        std::env::set_var("COOKIE_SECURE", "false");
        std::env::set_var("COOKIE_DOMAIN", "localhost");
        std::env::set_var("CACHE_BACKEND", "moka");
        std::env::set_var("WORKER_BACKEND", "db");
        std::env::set_var("SCHEDULER_ENABLED", "false");
        std::env::set_var("AUDIO_CALL_ENABLED", "false");
        std::env::set_var("NULLCLAW_ENABLED", "false");
        std::env::set_var("VNPAY_ENABLED", "false");
        std::env::set_var("MOMO_ENABLED", "false");
        std::env::set_var("ZALOPAY_ENABLED", "false");
        std::env::set_var("VIETQR_ENABLED", "false");
        std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
        std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
        std::env::set_var("CORS_ORIGINS", ORIGIN);
        std::env::set_var("STORAGE_BACKEND", "local");
        std::env::set_var(
            "STORAGE_LOCAL_ROOT",
            std::env::temp_dir().join(format!("wp5-storage-{}", Uuid::new_v4())),
        );
        std::env::remove_var("STORAGE_PUBLIC_BASE_URL");
    });
    let state = backend::server::bootstrap().await?;
    Ok((backend::routes::build_router(state.clone()), state))
}

/// A signed-in user; the first one registered is the admin.
async fn sign_in(st: &AppState, name: &str) -> anyhow::Result<String> {
    let user = st
        .auth
        .register(RegisterInput {
            full_name: name.into(),
            email: Some(format!("{name}@example.com")),
            phone: None,
            password: "password123".into(),
            locale: None,
        })
        .await?;
    let ctx = SessionContext {
        kind: SessionKind::Browser,
        user_agent: None,
        ip: None,
    };
    Ok(st.auth.issue_session(user, ctx).await?.access_token)
}

fn multipart(parts: &[(&str, Option<&str>, &[u8])]) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, filename, data) in parts {
        body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
        let disposition = match filename {
            Some(f) => {
                format!("Content-Disposition: form-data; name=\"{name}\"; filename=\"{f}\"\r\n")
            }
            None => format!("Content-Disposition: form-data; name=\"{name}\"\r\n"),
        };
        body.extend_from_slice(disposition.as_bytes());
        body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
        body.extend_from_slice(data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    body
}

async fn post(app: &Router, uri: &str, token: Option<&str>, body: Vec<u8>) -> Response {
    let mut req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::USER_AGENT, UA)
        .header(header::ORIGIN, ORIGIN)
        .header("x-forwarded-for", CLIENT_IP)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        );
    if let Some(t) = token {
        req = req.header(header::AUTHORIZATION, format!("Bearer {t}"));
    }
    app.clone()
        .oneshot(req.body(Body::from(body)).unwrap())
        .await
        .unwrap()
}

async fn get(app: &Router, uri: &str) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header(header::USER_AGENT, UA)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn bytes_of(resp: Response) -> Vec<u8> {
    axum::body::to_bytes(resp.into_body(), 32 << 20)
        .await
        .unwrap()
        .to_vec()
}

async fn json_of(resp: Response) -> serde_json::Value {
    serde_json::from_slice(&bytes_of(resp).await).unwrap()
}

fn header_of<'a>(resp: &'a Response, name: &str) -> &'a str {
    resp.headers()
        .get(name)
        .unwrap_or_else(|| panic!("missing header {name}"))
        .to_str()
        .unwrap()
}

// ────────────────────────────────────────────────────────────────
//  Image fixtures
// ────────────────────────────────────────────────────────────────

fn encode(img: &DynamicImage, format: ImageFormat) -> Vec<u8> {
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), format).unwrap();
    buf
}

fn gradient(w: u32, h: u32) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, y| {
        image::Rgb([(x % 251) as u8, (y % 241) as u8, 150])
    }))
}

fn png(w: u32, h: u32) -> Vec<u8> {
    encode(&gradient(w, h), ImageFormat::Png)
}

const GPS_MARKER: &[u8] = b"GPSLatitude=21.0285";

/// A JPEG whose EXIF block (orientation 1) carries a GPS-looking payload.
fn jpeg_with_gps(w: u32, h: u32) -> Vec<u8> {
    let jpeg = encode(&gradient(w, h), ImageFormat::Jpeg);
    let mut segment = b"Exif\0\0II*\0\x08\0\0\0".to_vec();
    segment.extend_from_slice(&[1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    segment.extend_from_slice(GPS_MARKER);
    let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
    out.extend_from_slice(&((segment.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(&segment);
    out.extend_from_slice(&jpeg[2..]);
    out
}

fn has(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

fn dims(bytes: &[u8]) -> (u32, u32) {
    let img = image::load_from_memory(bytes).expect("served bytes decode");
    (img.width(), img.height())
}

fn is_logo_key(key: &str, ext: &str) -> bool {
    key.strip_prefix("brands/logos/")
        .and_then(|k| k.strip_suffix(&format!(".{ext}")))
        .is_some_and(|h| h.len() == 16 && h.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')))
}

/// Assert the headers every served upload carries.
fn assert_upload_headers(resp: &Response, content_type: &str) {
    assert_eq!(header_of(resp, "content-type"), content_type);
    assert_eq!(header_of(resp, "content-security-policy"), CSP);
    assert_eq!(header_of(resp, "x-content-type-options"), "nosniff");
    assert_eq!(
        header_of(resp, "cache-control"),
        "public, max-age=31536000, immutable"
    );
}

// ────────────────────────────────────────────────────────────────
//  POST /api/uploads/brand-logo
// ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn brand_logo_upload_needs_a_staff_member() -> anyhow::Result<()> {
    let (app, st) = boot().await?;
    let admin = sign_in(&st, "admin").await?;
    let user = sign_in(&st, "plainuser").await?;
    let body = multipart(&[("file", Some("logo.png"), &png(20, 20))]);

    let anonymous = post(&app, "/api/uploads/brand-logo", None, body.clone()).await;
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    let plain = post(&app, "/api/uploads/brand-logo", Some(&user), body.clone()).await;
    assert_eq!(plain.status(), StatusCode::FORBIDDEN);
    let admin = post(&app, "/api/uploads/brand-logo", Some(&admin), body).await;
    assert_eq!(admin.status(), StatusCode::CREATED);
    Ok(())
}

#[tokio::test]
async fn raster_logo_is_stored_as_512px_webp_without_exif() -> anyhow::Result<()> {
    let (app, st) = boot().await?;
    let admin = sign_in(&st, "admin").await?;
    let upload = jpeg_with_gps(2000, 1000);
    assert!(has(&upload, GPS_MARKER));

    let resp = post(
        &app,
        "/api/uploads/brand-logo",
        Some(&admin),
        multipart(&[("file", Some("logo.jpg"), &upload)]),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let out = json_of(resp).await;
    let key = out["key"].as_str().unwrap().to_string();
    assert!(is_logo_key(&key, "webp"), "key: {key}");
    assert_eq!(out["url"], format!("/api/media/{key}"));

    let served = get(&app, out["url"].as_str().unwrap()).await;
    assert_eq!(served.status(), StatusCode::OK);
    assert_upload_headers(&served, "image/webp");
    let bytes = bytes_of(served).await;
    assert!(is_webp(&bytes));
    assert_eq!(dims(&bytes), (512, 256));
    assert!(!has(&bytes, GPS_MARKER) && !has(&bytes, b"Exif"));

    // Same logo again → same content-addressed key.
    let again = post(
        &app,
        "/api/uploads/brand-logo",
        Some(&admin),
        multipart(&[("file", Some("again.jpg"), &upload)]),
    )
    .await;
    assert_eq!(json_of(again).await["key"], key);
    Ok(())
}

#[tokio::test]
async fn svg_logo_is_kept_as_uploaded_and_served_sandboxed() -> anyhow::Result<()> {
    let (app, st) = boot().await?;
    let admin = sign_in(&st, "admin").await?;
    let svg = b"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4'><rect width='4' height='4'/></svg>";

    let resp = post(
        &app,
        "/api/uploads/brand-logo",
        Some(&admin),
        // A wrong declared type must not matter: the content decides.
        multipart(&[("file", Some("logo.png"), svg)]),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let key = json_of(resp).await["key"].as_str().unwrap().to_string();
    assert!(is_logo_key(&key, "svg"), "key: {key}");

    let served = get(&app, &format!("/api/media/{key}")).await;
    assert_eq!(served.status(), StatusCode::OK);
    assert_upload_headers(&served, "image/svg+xml");
    assert_eq!(bytes_of(served).await, svg);
    Ok(())
}

#[tokio::test]
async fn unsafe_svg_unsupported_and_corrupt_logos_are_refused() -> anyhow::Result<()> {
    let (app, st) = boot().await?;
    let admin = sign_in(&st, "admin").await?;
    let truncated_png = {
        let p = png(64, 64);
        p[..p.len() / 2].to_vec()
    };
    let jpeg_polyglot = {
        let mut v = vec![0xFF, 0xD8, 0xFF, 0xE0];
        v.extend_from_slice(b"<html><script>alert(1)</script></html>");
        v
    };
    let too_big = vec![b' '; 5 * 1024 * 1024 + 1];

    let cases: Vec<(&str, Vec<u8>)> = vec![
        (
            "script",
            b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".to_vec(),
        ),
        (
            "onload",
            b"<svg onload='alert(1)' xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
        ),
        ("html", b"<html><body>hi</body></html>".to_vec()),
        ("gif", b"GIF89a\x01\x00\x01\x00".to_vec()),
        ("truncated png", truncated_png),
        ("jpeg-magic polyglot", jpeg_polyglot),
        ("over 5 MiB", too_big),
    ];
    for (name, data) in cases {
        let resp = post(
            &app,
            "/api/uploads/brand-logo",
            Some(&admin),
            multipart(&[("file", Some("logo"), &data)]),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{name}");
    }

    let no_file = post(
        &app,
        "/api/uploads/brand-logo",
        Some(&admin),
        multipart(&[("other", None, b"x")]),
    )
    .await;
    assert_eq!(no_file.status(), StatusCode::BAD_REQUEST);
    Ok(())
}

#[tokio::test]
async fn png_with_trailing_html_is_stored_as_pure_webp() -> anyhow::Result<()> {
    let (app, st) = boot().await?;
    let admin = sign_in(&st, "admin").await?;
    let mut polyglot = png(32, 32);
    polyglot.extend_from_slice(b"<script>alert(1)</script>");

    let resp = post(
        &app,
        "/api/uploads/brand-logo",
        Some(&admin),
        multipart(&[("file", Some("logo.png"), &polyglot)]),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let key = json_of(resp).await["key"].as_str().unwrap().to_string();
    let bytes = bytes_of(get(&app, &format!("/api/media/{key}")).await).await;
    assert!(is_webp(&bytes) && !has(&bytes, b"<script>"));
    Ok(())
}

// ────────────────────────────────────────────────────────────────
//  Route pictures
// ────────────────────────────────────────────────────────────────

async fn make_route(st: &AppState) -> anyhow::Result<Uuid> {
    let route = st
        .admin
        .create_route(&backend::dto::admin::UpsertRouteRequest {
            name: Some("WP5 Express".into()),
            brand_id: None,
            start_location_id: Some("ha-noi".into()),
            end_location_id: Some("da-nang".into()),
            status: Some("active".into()),
        })
        .await?;
    Ok(route.id)
}

#[tokio::test]
async fn route_picture_is_stored_as_webp_with_a_thumbnail() -> anyhow::Result<()> {
    let (app, st) = boot().await?;
    let admin = sign_in(&st, "admin").await?;
    let route_id = make_route(&st).await?;
    let upload = jpeg_with_gps(3000, 2000);
    let uri = format!("/api/admin/routes/{route_id}/pictures");

    let resp = post(
        &app,
        &uri,
        Some(&admin),
        multipart(&[
            ("file", Some("bus.jpg"), &upload),
            ("alt_text", None, b"Front"),
        ]),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let out = json_of(resp).await;
    let picture = &out["picture"];
    assert_eq!(picture["mimeType"], "image/webp");
    assert_eq!(
        (picture["width"].as_i64(), picture["height"].as_i64()),
        (Some(1920), Some(1280))
    );

    let url = picture["url"].as_str().unwrap();
    let thumb_url = picture["thumbUrl"].as_str().unwrap();
    let prefix = format!("/api/media/routes/{route_id}/");
    let hash = url
        .strip_prefix(&prefix)
        .and_then(|f| f.strip_suffix(".webp"))
        .unwrap_or_else(|| panic!("url: {url}"));
    assert_eq!(hash.len(), 16);
    assert_eq!(thumb_url, format!("{prefix}t{hash}.webp"));

    for (uri, expected) in [(url, (1920, 1280)), (thumb_url, (640, 427))] {
        let served = get(&app, uri).await;
        assert_eq!(served.status(), StatusCode::OK, "{uri}");
        assert_upload_headers(&served, "image/webp");
        assert_eq!(header_of(&served, "etag"), format!("\"{hash}\""));
        let bytes = bytes_of(served).await;
        assert!(is_webp(&bytes));
        assert_eq!(dims(&bytes), expected, "{uri}");
        assert!(!has(&bytes, GPS_MARKER), "EXIF must not survive: {uri}");
    }

    // A conditional request is answered 304 with the same headers.
    let revalidated = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(url)
                .header(header::USER_AGENT, UA)
                .header(header::IF_NONE_MATCH, format!("W/\"{hash}\""))
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(revalidated.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(header_of(&revalidated, "content-security-policy"), CSP);
    Ok(())
}

#[tokio::test]
async fn route_picture_upload_refuses_corrupt_files_and_the_eleventh_picture() -> anyhow::Result<()>
{
    let (app, st) = boot().await?;
    let admin = sign_in(&st, "admin").await?;
    let route_id = make_route(&st).await?;
    let uri = format!("/api/admin/routes/{route_id}/pictures");

    let corrupt = {
        let mut v = vec![0xFF, 0xD8, 0xFF, 0xE0];
        v.extend_from_slice(&[0u8; 64]);
        v
    };
    let bad = post(
        &app,
        &uri,
        Some(&admin),
        multipart(&[("file", Some("x.jpg"), &corrupt)]),
    )
    .await;
    assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    let html = post(
        &app,
        &uri,
        Some(&admin),
        multipart(&[("file", Some("x.jpg"), b"<html>")]),
    )
    .await;
    assert_eq!(html.status(), StatusCode::BAD_REQUEST);

    for i in 0..10u32 {
        st.media
            .upload(route_id, png(16 + i, 16).into(), None)
            .await?;
    }
    let eleventh = post(
        &app,
        &uri,
        Some(&admin),
        multipart(&[("file", Some("x.png"), &png(99, 9))]),
    )
    .await;
    assert_eq!(eleventh.status(), StatusCode::BAD_REQUEST);
    let list = st.media.list(route_id).await?;
    assert_eq!(list.items.len(), 10);
    Ok(())
}

// ────────────────────────────────────────────────────────────────
//  Objects written before WebP stay readable
// ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn pre_webp_objects_are_still_served() -> anyhow::Result<()> {
    let (app, _st) = boot().await?;
    let route = Uuid::new_v4();
    let jpeg = encode(&gradient(32, 24), ImageFormat::Jpeg);
    let old_png = png(32, 24);
    let files: [(String, &[u8], &str); 4] = [
        (
            format!("routes/{route}/0123456789abcdef.jpg"),
            &jpeg,
            "image/jpeg",
        ),
        (
            format!("routes/{route}/0123456789abcde0.png"),
            &old_png,
            "image/png",
        ),
        (
            format!("routes/{route}/t0123456789abcdef.jpg"),
            &jpeg,
            "image/jpeg",
        ),
        (
            "brands/logos/0123456789abcdef.png".to_string(),
            &old_png,
            "image/png",
        ),
    ];
    for (key, data, content_type) in files {
        let path = storage_root().join(&key);
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, data)?;
        let served = get(&app, &format!("/api/media/{key}")).await;
        assert_eq!(served.status(), StatusCode::OK, "{key}");
        assert_upload_headers(&served, content_type);
        assert_eq!(bytes_of(served).await, data, "{key}");
    }
    Ok(())
}

#[tokio::test]
async fn media_proxy_404s_unknown_logo_shapes() -> anyhow::Result<()> {
    let (app, _st) = boot().await?;
    for uri in [
        "/api/media/brands/logos/0123456789abcdef.gif",
        "/api/media/brands/logos/0123456789abcdef.webp",
        "/api/media/brands/other/0123456789abcdef.webp",
        "/api/media/brands/logos/zzzzzzzzzzzzzzzz.webp",
        "/api/media/brands/logos/%2e%2e/%2e%2e/etc/passwd",
    ] {
        assert_eq!(
            get(&app, uri).await.status(),
            StatusCode::NOT_FOUND,
            "{uri}"
        );
    }
    Ok(())
}

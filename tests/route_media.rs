//! Route-media integration tests — full pipeline on the real stack:
//! in-memory rust-sql DB + LocalStorage (tempdir) + RouteMediaService.
//!
//! What this exercises (service level, no HTTP):
//! - upload validation: non-image rejection, size/format gates
//! - content-addressed dedupe (identical bytes → same row, deduped=true)
//! - thumbnail generation (JPEG, long-edge capped) + immutable cache
//!   headers on stored objects
//! - picture-count cap
//! - list / patch (reorder + alt_text) / delete (row + objects)
//! - purge-on-route-delete GC (objects gone even after row cascade)
//! - covers_for batch resolution
//! - serve (proxy path) with ETag + content type
//! - URL resolution: relative proxy URLs without CDN base, absolute
//!   with.
//!
//! HTTP-level behavior of the `/api/media` serve endpoint (404s on
//! hostile keys, 304 on If-None-Match) lives in tests/api_smoke.rs —
//! that endpoint is mounted outside the rate-limited `/api` nest
//! precisely so it is testable in the one-shot harness.

// Link anchor: rustc only places an rlib on a TEST binary's link line
// when the test's own code references the crate. The rustqlite engine
// (`sqlite3` crate — the sqlite3_* C ABI) is otherwise dropped and
// sqlx-sqlite's FFI references go unresolved. Referencing the compat
// crate's Rust-visible `engine_version` pulls the engine + compat
// rlibs onto THIS binary's link line.
#[used]
static ENGINE_LINK: fn() -> &'static str = sqlite3::engine_version;

use std::sync::Arc;

use sea_orm::{ActiveModelTrait, Database, DatabaseConnection, Set};
use sea_orm_migration::MigratorTrait;
use uuid::Uuid;

use backend::entity::route;
use backend::service::route_media_service::{RouteMediaService, MAX_PICTURES_PER_ROUTE};
use backend::storage::LocalStorage;
use backend::store::{DbRoutePictureStore, DbRouteStore, RoutePictureStore, RouteStore};

// ────────────────────────────────────────────────────────────────
//  Harness
// ────────────────────────────────────────────────────────────────

struct Ctx {
    db: Arc<DatabaseConnection>,
    service: Arc<RouteMediaService>,
    storage_root: std::path::PathBuf,
}

async fn boot() -> anyhow::Result<Ctx> {
    // Single connection: `sqlite::memory:` is private per connection,
    // so the pool MUST be one connection wide or migrations/queries
    // would hit different in-memory databases.
    let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
    opts.max_connections(1)
        .connect_timeout(std::time::Duration::from_secs(10));
    let db = Arc::new(Database::connect(opts).await?);
    backend::Migrator::up(db.as_ref(), None).await?;

    let pictures: Arc<dyn RoutePictureStore> = Arc::new(DbRoutePictureStore::new(db.clone()));
    let routes: Arc<dyn RouteStore> = Arc::new(DbRouteStore::new(db.clone()));

    let storage_root = std::env::temp_dir().join(format!("route-media-test-{}", Uuid::new_v4()));
    let storage = Arc::new(LocalStorage::new(storage_root.clone()).await?);

    // No public base URL → URLs point at the backend proxy path.
    let service = Arc::new(RouteMediaService::new(
        pictures,
        routes,
        storage,
        None,
        "test-bucket".into(),
    ));
    Ok(Ctx {
        db,
        service,
        storage_root,
    })
}

async fn insert_route(db: &DatabaseConnection, name: &str) -> anyhow::Result<Uuid> {
    let now = chrono::Utc::now().to_rfc3339();
    let am = route::ActiveModel {
        id: Set(Uuid::new_v4()),
        brand_id: Set(None),
        name: Set(name.into()),
        start_location_id: Set("ha-noi".into()),
        end_location_id: Set("da-nang".into()),
        status: Set("active".into()),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    };
    let m = am.insert(db).await?;
    Ok(m.id)
}

/// Deterministic small PNG (a horizontal gradient) for upload tests.
fn test_png(w: u32, h: u32) -> bytes::Bytes {
    let img = image::RgbImage::from_fn(w, h, |x, _y| image::Rgb([(x % 251) as u8, 100, 150]));
    let mut buf = Vec::new();
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .expect("test PNG encodes");
    bytes::Bytes::from(buf)
}

/// JPEG with a valid magic prefix but garbage body — proves the FULL
/// decode gate (not just magic bytes) rejects broken files.
fn corrupt_jpeg() -> bytes::Bytes {
    let mut v = vec![0xFF, 0xD8, 0xFF, 0xE0];
    v.extend_from_slice(&[0u8; 64]);
    bytes::Bytes::from(v)
}

fn object_exists(root: &std::path::Path, key: &str) -> bool {
    root.join(key).exists()
}

// ────────────────────────────────────────────────────────────────
//  Tests
// ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn upload_rejects_garbage_and_corrupt_files() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let route_id = insert_route(&ctx.db, "r1").await?;

    // Not an image at all.
    let err = ctx
        .service
        .upload(
            route_id,
            bytes::Bytes::from_static(b"<html>not an image</html>"),
            None,
        )
        .await
        .unwrap_err();
    assert!(
        err.to_string().contains("unsupported image format"),
        "got: {err}"
    );

    // JPEG magic bytes but truncated body — the full-decode gate must
    // catch what the magic-byte sniff lets through.
    let err = ctx
        .service
        .upload(route_id, corrupt_jpeg(), None)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("decode"), "got: {err}");

    // Unknown route → 404, nothing written.
    let err = ctx
        .service
        .upload(Uuid::new_v4(), test_png(8, 8), None)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("not found"), "got: {err}");
    Ok(())
}

#[tokio::test]
async fn upload_creates_picture_thumb_and_immutable_objects() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let route_id = insert_route(&ctx.db, "r2").await?;

    let resp = ctx
        .service
        .upload(
            route_id,
            test_png(1200, 800),
            Some("  Sleeper bus interior  ".into()),
        )
        .await?;
    assert!(!resp.deduped);

    let p = &resp.picture;
    assert_eq!(p.route_id, route_id);
    assert_eq!(p.sort_order, 0);
    assert_eq!(p.width, 1200);
    assert_eq!(p.height, 800);
    assert_eq!(p.mime_type, "image/png");
    assert_eq!(p.alt_text.as_deref(), Some("Sleeper bus interior"));
    // Dev mode (no CDN base) → backend-relative proxy URLs.
    assert!(p.url.starts_with("/api/media/routes/"), "url: {}", p.url);
    assert!(
        p.thumb_url.starts_with("/api/media/routes/"),
        "thumb: {}",
        p.thumb_url
    );

    // The URL is the key behind the proxy path.
    let key = p.url.trim_start_matches("/api/media/");
    let thumb_key = p.thumb_url.trim_start_matches("/api/media/");
    assert!(object_exists(&ctx.storage_root, key), "full object stored");
    assert!(object_exists(&ctx.storage_root, thumb_key), "thumb stored");

    // Serve round-trip: bytes, content type, ETag.
    let served = ctx.service.serve(key).await?;
    assert_eq!(served.content_type, "image/png");
    assert!(served.etag.starts_with('"') && served.etag.ends_with('"'));
    assert!(!served.bytes.is_empty());

    let thumb_served = ctx.service.serve(thumb_key).await?;
    assert_eq!(thumb_served.content_type, "image/jpeg");
    // Thumbnail long edge ≤ 640 for a 1200x800 original.
    let t = image::load_from_memory(&thumb_served.bytes)?;
    assert!(
        t.width().max(t.height()) <= 640,
        "thumb {}x{}",
        t.width(),
        t.height()
    );
    Ok(())
}

#[tokio::test]
async fn upload_dedupes_identical_content() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let route_id = insert_route(&ctx.db, "r3").await?;

    let data = test_png(64, 64);
    let first = ctx.service.upload(route_id, data.clone(), None).await?;
    let second = ctx.service.upload(route_id, data.clone(), None).await?;

    assert!(!first.deduped);
    assert!(second.deduped);
    assert_eq!(first.picture.id, second.picture.id);

    // Still exactly one row.
    let list = ctx.service.list(route_id).await?;
    assert_eq!(list.items.len(), 1);
    Ok(())
}

#[tokio::test]
async fn picture_count_cap_is_enforced() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let route_id = insert_route(&ctx.db, "r4").await?;

    // Different bytes each time (dedupe would collapse identical ones).
    for i in 0..MAX_PICTURES_PER_ROUTE as u32 {
        let data = test_png(16 + i, 16);
        ctx.service.upload(route_id, data, None).await?;
    }
    let list = ctx.service.list(route_id).await?;
    assert_eq!(list.items.len(), MAX_PICTURES_PER_ROUTE);

    // Sort orders are append-sequence 0..n-1.
    let mut orders: Vec<i64> = list.items.iter().map(|p| p.sort_order).collect();
    orders.sort();
    assert_eq!(
        orders,
        (0..MAX_PICTURES_PER_ROUTE as i64).collect::<Vec<_>>()
    );

    let err = ctx
        .service
        .upload(route_id, test_png(999, 9), None)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("max"), "got: {err}");
    Ok(())
}

#[tokio::test]
async fn patch_reorders_and_updates_alt_text() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let route_id = insert_route(&ctx.db, "r5").await?;

    let a = ctx.service.upload(route_id, test_png(10, 10), None).await?;
    let b = ctx.service.upload(route_id, test_png(20, 10), None).await?;
    let c = ctx.service.upload(route_id, test_png(30, 10), None).await?;
    assert_eq!(
        (
            a.picture.sort_order,
            b.picture.sort_order,
            c.picture.sort_order
        ),
        (0, 1, 2)
    );

    // Make C the cover.
    let moved = ctx
        .service
        .patch(
            route_id,
            c.picture.id,
            Some(0),
            Some("front of the bus".into()),
        )
        .await?;
    assert_eq!(moved.sort_order, 0);
    assert_eq!(moved.alt_text.as_deref(), Some("front of the bus"));

    // Negative sort order rejected.
    let err = ctx
        .service
        .patch(route_id, a.picture.id, Some(-1), None)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("sort_order"), "got: {err}");

    // Picture from another route → 404 (cross-route tampering).
    let other_route = insert_route(&ctx.db, "r5b").await?;
    let err = ctx
        .service
        .patch(other_route, a.picture.id, Some(0), None)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("not on route"), "got: {err}");

    // Clear alt text via empty string.
    let cleared = ctx
        .service
        .patch(route_id, c.picture.id, None, Some(String::new()))
        .await?;
    assert!(cleared.alt_text.is_none());

    let list = ctx.service.list(route_id).await?;
    // Move-to-position semantics: c is the cover; a and b shifted to
    // 1 and 2 (positions stay dense).
    assert_eq!(list.items[0].id, c.picture.id);
    assert_eq!(list.items[1].id, a.picture.id);
    assert_eq!(list.items[2].id, b.picture.id);
    assert_eq!(
        list.items.iter().map(|p| p.sort_order).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    Ok(())
}

#[tokio::test]
async fn delete_removes_row_and_backing_objects() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let route_id = insert_route(&ctx.db, "r6").await?;

    let resp = ctx.service.upload(route_id, test_png(40, 40), None).await?;
    let key = resp
        .picture
        .url
        .trim_start_matches("/api/media/")
        .to_string();
    let thumb_key = resp
        .picture
        .thumb_url
        .trim_start_matches("/api/media/")
        .to_string();
    assert!(object_exists(&ctx.storage_root, &key));

    ctx.service.delete(route_id, resp.picture.id).await?;

    assert!(!object_exists(&ctx.storage_root, &key), "full object GCed");
    assert!(!object_exists(&ctx.storage_root, &thumb_key), "thumb GCed");
    let list = ctx.service.list(route_id).await?;
    assert!(list.items.is_empty());

    // Deleting again → 404.
    let err = ctx
        .service
        .delete(route_id, resp.picture.id)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("not on route"), "got: {err}");
    Ok(())
}

#[tokio::test]
async fn purging_a_route_deletes_all_pictures_and_objects() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let route_id = insert_route(&ctx.db, "r7").await?;

    let mut keys = Vec::new();
    for i in 0..3u32 {
        let resp = ctx
            .service
            .upload(route_id, test_png(40 + i, 40), None)
            .await?;
        keys.push(
            resp.picture
                .url
                .trim_start_matches("/api/media/")
                .to_string(),
        );
        keys.push(
            resp.picture
                .thumb_url
                .trim_start_matches("/api/media/")
                .to_string(),
        );
    }

    // Simulate the admin route-delete flow: purge BEFORE the row
    // cascade (which the route-delete handler does).
    let deleted = ctx.service.delete_all(route_id).await?;
    assert_eq!(deleted.deleted, 3);
    for k in &keys {
        assert!(!object_exists(&ctx.storage_root, k), "object {k} GCed");
    }

    let list = ctx.service.list(route_id).await?;
    assert!(list.items.is_empty());

    // Purge is idempotent on an empty gallery.
    let again = ctx.service.delete_all(route_id).await?;
    assert_eq!(again.deleted, 0);
    Ok(())
}

#[tokio::test]
async fn covers_for_resolves_one_cover_per_route() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let r1 = insert_route(&ctx.db, "c1").await?;
    let r2 = insert_route(&ctx.db, "c2").await?;
    let r3 = insert_route(&ctx.db, "c3-no-pictures").await?;

    ctx.service.upload(r1, test_png(10, 10), None).await?;
    ctx.service.upload(r1, test_png(20, 10), None).await?;
    ctx.service.upload(r2, test_png(30, 10), None).await?;

    let covers = ctx
        .service
        .covers_for(&[r1, r2, r3, Uuid::new_v4()])
        .await?;
    assert_eq!(covers.len(), 2, "one cover per pictured route only");
    assert_eq!(covers[&r1].sort_order, 0, "cover = lowest sort_order");
    assert!(covers.contains_key(&r2));
    assert!(!covers.contains_key(&r3));
    Ok(())
}

#[tokio::test]
async fn cdn_base_url_makes_absolute_urls() -> anyhow::Result<()> {
    let db = {
        let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        Arc::new(Database::connect(opts).await?)
    };
    backend::Migrator::up(db.as_ref(), None).await?;

    let pictures: Arc<dyn RoutePictureStore> = Arc::new(DbRoutePictureStore::new(db.clone()));
    let routes: Arc<dyn RouteStore> = Arc::new(DbRouteStore::new(db.clone()));
    let root = std::env::temp_dir().join(format!("route-media-test-{}", Uuid::new_v4()));
    let storage = Arc::new(LocalStorage::new(root.clone()).await?);

    let service = RouteMediaService::new(
        pictures,
        routes,
        storage,
        Some("https://media.example.com/".into()), // trailing slash normalized away
        "datxevui-media".into(),
    );
    let route_id = insert_route(&db, "cdn").await?;
    let resp = service.upload(route_id, test_png(10, 10), None).await?;

    assert_eq!(
        resp.picture.url,
        format!(
            "https://media.example.com/datxevui-media/routes/{}/{}",
            route_id,
            resp.picture.url.rsplit('/').next().unwrap()
        )
    );
    Ok(())
}

#[tokio::test]
async fn serve_rejects_hostile_and_unknown_keys() -> anyhow::Result<()> {
    let ctx = boot().await?;

    // Traversal, foreign prefix, junk — all 404 (NotFound), never 500,
    // and never touch the storage root.
    for key in [
        "../../etc/passwd",
        "routes/../../etc/passwd",
        "secrets/00000000-0000-0000-0000-000000000000/0123456789abcdef.jpg",
        "routes/not-a-uuid/0123456789abcdef.jpg",
        "routes/00000000-0000-0000-0000-000000000000/zzzzzzzzzzzzzzzz.jpg",
    ] {
        let err = ctx.service.serve(key).await.unwrap_err();
        assert!(
            matches!(err, backend::error::AppError::NotFound(_)),
            "{key} -> {err}"
        );
    }

    // Well-formed but nonexistent object → NotFound (not an internal
    // storage error surfaced as 500).
    let err = ctx
        .service
        .serve("routes/00000000-0000-0000-0000-000000000000/0123456789abcdef.jpg")
        .await
        .unwrap_err();
    assert!(
        matches!(err, backend::error::AppError::NotFound(_)),
        "got: {err}"
    );
    Ok(())
}

#[tokio::test]
async fn size_cap_rejects_oversized_uploads() -> anyhow::Result<()> {
    let ctx = boot().await?;
    let route_id = insert_route(&ctx.db, "r8").await?;

    // > 10 MiB of PNG-prefixed bytes (decode would also fail, but the
    // size gate fires FIRST — before any CPU is spent).
    let mut huge = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    huge.resize(10 * 1024 * 1024 + 1, 0);
    let err = ctx
        .service
        .upload(route_id, bytes::Bytes::from(huge), None)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("limit"), "got: {err}");
    Ok(())
}

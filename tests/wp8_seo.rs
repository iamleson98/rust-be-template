//! WP8: the web app's delivery through the full router: per-page head
//! (against the frontend's golden file), 404s and redirects, the live sitemap
//! and robots, static caching, `/_next/static`, and the header floor.
//!
//! The pure head logic is also checked without a server in the first test.

use std::path::PathBuf;
use std::sync::OnceLock;

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use backend::web::seo::{page_seo, trailing_slash_target, BrandFacts, PageFacts, Query, Strings};
use sea_orm::{ActiveModelTrait, Set};
use serde::Deserialize;
use tower::ServiceExt;

const BROWSER: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) wp8-test/1.0";

#[derive(Deserialize)]
struct GoldenEntry {
    path: String,
    search: String,
    /// `null` = the brand is unknown; `{}` = nothing to add.
    facts: Option<GoldenFacts>,
    expect: Option<GoldenSeo>,
}

#[derive(Deserialize)]
struct GoldenFacts {
    brand: Option<GoldenBrand>,
}

#[derive(Deserialize)]
struct GoldenBrand {
    name: String,
    description: Option<String>,
}

#[derive(Deserialize, Debug, PartialEq)]
struct GoldenSeo {
    title: String,
    description: String,
    canonical: Option<String>,
    robots: String,
}

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn golden() -> Vec<GoldenEntry> {
    let entries: Vec<GoldenEntry> = serde_json::from_str(&fixture("seo-golden.json")).unwrap();
    assert!(entries.len() >= 40, "the golden file shrank");
    entries
}

fn strings() -> Strings {
    Strings::parse(&fixture("seo-strings.json")).expect("seo-strings.json is complete")
}

fn page_facts(facts: &GoldenFacts) -> PageFacts {
    PageFacts {
        brand: facts.brand.as_ref().map(|b| BrandFacts {
            name: b.name.clone(),
            description: b.description.clone(),
        }),
    }
}

fn as_golden(seo: backend::web::seo::PageSeo) -> GoldenSeo {
    GoldenSeo {
        title: seo.title,
        description: seo.description,
        canonical: seo.canonical,
        robots: seo.robots.to_owned(),
    }
}

/// The head logic against the file the frontend generated from its own.
#[test]
fn head_logic_matches_the_golden_file() {
    let strings = strings();
    for entry in golden() {
        let ctx = format!("{} ? {}", entry.path, entry.search);
        // A slash-terminated path is redirected before any head is built.
        if entry.path.len() > 1 && entry.path.ends_with('/') {
            assert!(trailing_slash_target(&entry.path, None).is_some(), "{ctx}");
            assert!(entry.expect.is_none(), "{ctx}");
            continue;
        }
        let Some(facts) = &entry.facts else {
            // An unknown brand is a 404 whatever the head logic would say.
            assert!(entry.expect.is_none(), "{ctx}");
            continue;
        };
        let got = page_seo(
            &entry.path,
            &Query::parse(&entry.search),
            &strings,
            &page_facts(facts),
        )
        .map(as_golden);
        assert_eq!(got, entry.expect, "{ctx}");
    }
}

// ── The full router ──────────────────────────────────────────────────

struct Site {
    dist: tempfile::TempDir,
    legacy: tempfile::TempDir,
}

fn write(dir: &std::path::Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

const SHELL: &str = "<!doctype html><html lang=\"vi\"><head><meta charset=\"UTF-8\" />\n    <!--app-head-->\n  </head><body><div id=\"root\"><!--app-html--></div></body></html>";

fn site() -> &'static Site {
    static SITE: OnceLock<Site> = OnceLock::new();
    SITE.get_or_init(|| {
        let site = Site {
            dist: tempfile::tempdir().unwrap(),
            legacy: tempfile::tempdir().unwrap(),
        };
        let d = site.dist.path();
        write(d, "index.html", SHELL);
        write(
            d,
            "privacy.html",
            &SHELL.replace("<!--app-html-->", "<h1>Chính sách bảo mật</h1>"),
        );
        write(d, "seo-strings.json", &fixture("seo-strings.json"));
        write(d, "sw.js", "// worker");
        write(d, "fonts/geist.css", "@font-face{}");
        write(d, "icons/icon-192.png", "png");
        write(d, "hero-vietnam-bus.webp", "webp");
        write(d, "logo.svg", "<svg/>");
        write(d, "ads.txt", "google.com, pub-1, DIRECT");
        write(d, "offline.html", "<p>offline</p>");
        write(d, "assets/app-abc123.js", "export {}");
        write(site.legacy.path(), "chunks/main-9f.js", "legacy");
        site
    })
}

async fn boot() -> (axum::Router, backend::state::AppState) {
    use std::sync::Once;
    static ENV: Once = Once::new();
    ENV.call_once(|| {
        let site = site();
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
        std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
        std::env::set_var("COOKIE_SECURE", "false");
        std::env::set_var("CACHE_BACKEND", "moka");
        std::env::set_var("WORKER_BACKEND", "db");
        std::env::set_var("SCHEDULER_ENABLED", "false");
        std::env::set_var("AUDIO_CALL_ENABLED", "false");
        std::env::set_var("NULLCLAW_ENABLED", "false");
        for gateway in ["VNPAY", "MOMO", "ZALOPAY", "VIETQR"] {
            std::env::set_var(format!("{gateway}_ENABLED"), "false");
        }
        std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
        std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
        std::env::set_var("STORAGE_BACKEND", "local");
        std::env::set_var(
            "STORAGE_LOCAL_ROOT",
            std::env::temp_dir().join(format!("wp8-seo-storage-{}", uuid::Uuid::new_v4())),
        );
        std::env::remove_var("STORAGE_PUBLIC_BASE_URL");
        std::env::set_var("STATIC_FILES_DIR", site.dist.path());
        std::env::set_var("LEGACY_NEXT_DIR", site.legacy.path());
        std::env::set_var("PAYMENT_PUBLIC_BASE_URL", "https://datxevui.com/");
    });
    let state = backend::server::bootstrap().await.expect("bootstrap");
    (backend::routes::build_router(state.clone()), state)
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: String,
}

impl Reply {
    fn header(&self, name: &str) -> &str {
        self.headers
            .get(name)
            .map(|v| v.to_str().unwrap())
            .unwrap_or("")
    }
}

async fn get_as(app: &axum::Router, uri: &str, user_agent: &str) -> Reply {
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .header(header::USER_AGENT, user_agent)
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let (parts, body) = resp.into_parts();
    let bytes = axum::body::to_bytes(body, 8 << 20).await.unwrap();
    Reply {
        status: parts.status,
        headers: parts.headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    }
}

async fn get(app: &axum::Router, uri: &str) -> Reply {
    get_as(app, uri, BROWSER).await
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&amp;", "&")
}

/// `<tag ... attr="value" ...>` for the first tag containing `marker`.
fn attr(html: &str, marker: &str, attr: &str) -> Option<String> {
    let tag_start = html.find(marker)?;
    let tag_end = html[tag_start..].find("/>")? + tag_start;
    let tag = &html[tag_start..tag_end];
    let key = format!("{attr}=\"");
    let from = tag.find(&key)? + key.len();
    let len = tag[from..].find('"')?;
    Some(unescape(&tag[from..from + len]))
}

fn head_of(html: &str) -> GoldenSeo {
    let title = {
        let from = html.find("<title>").expect("a <title>") + "<title>".len();
        let len = html[from..].find("</title>").unwrap();
        unescape(&html[from..from + len])
    };
    GoldenSeo {
        title,
        description: attr(html, "<meta name=\"description\"", "content").unwrap_or_default(),
        canonical: attr(html, "<link rel=\"canonical\"", "href"),
        robots: attr(html, "<meta name=\"robots\"", "content").expect("a robots meta"),
    }
}

/// Every golden entry served over HTTP: the redirect, the 404 or the head.
#[tokio::test]
async fn pages_answer_what_the_golden_file_says() {
    let (app, _) = boot().await;
    let mut checked = 0;
    for entry in golden() {
        // Brand pages with database facts are covered by the brand test.
        if entry.path.starts_with("/brands/")
            && entry
                .facts
                .as_ref()
                .is_some_and(|f| f.brand.is_some() || entry.expect.is_some())
        {
            continue;
        }
        let uri = if entry.search.is_empty() {
            entry.path.clone()
        } else {
            format!("{}?{}", entry.path, entry.search)
        };
        let ctx = uri.clone();
        let reply = get(&app, &uri).await;
        if entry.path.len() > 1 && entry.path.ends_with('/') {
            assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT, "{ctx}");
            let expected = trailing_slash_target(
                &entry.path,
                (!entry.search.is_empty()).then_some(entry.search.as_str()),
            )
            .unwrap();
            assert_eq!(reply.header("location"), expected, "{ctx}");
            assert!(reply.body.is_empty(), "{ctx}");
            continue;
        }
        match &entry.expect {
            Some(expect) => {
                assert_eq!(reply.status, StatusCode::OK, "{ctx}");
                assert_eq!(&head_of(&reply.body), expect, "{ctx}");
            }
            None => assert_eq!(reply.status, StatusCode::NOT_FOUND, "{ctx}"),
        }
        checked += 1;
    }
    assert!(checked >= 30, "only {checked} entries checked");
}

#[tokio::test]
async fn an_unknown_path_is_a_404_with_the_spa_body() {
    let (app, _) = boot().await;
    for uri in ["/does-not-exist", "/SEARCH", "/brands", "/trips/a/b"] {
        let reply = get(&app, uri).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{uri}");
        assert!(reply.body.contains("<div id=\"root\">"), "{uri}");
        assert_eq!(reply.header("content-type"), "text/html; charset=utf-8");
        assert_eq!(reply.header("cache-control"), "no-cache, must-revalidate");
        let head = head_of(&reply.body);
        assert_eq!(head.title, "Không tìm thấy trang — DatXeVui");
        assert_eq!(head.robots, "noindex, follow");
        assert_eq!(head.canonical, None, "{uri}");
        assert!(!reply.body.contains("<!--app-head-->"));
    }
}

#[tokio::test]
async fn file_shaped_misses_and_raw_shells_are_not_pages() {
    let (app, _) = boot().await;
    for uri in [
        "/index.html",
        "/privacy.html",
        "/no-such-file.css",
        "/assets/missing-deadbeef.js",
        "/seo-strings.json.map",
    ] {
        let reply = get(&app, uri).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{uri}");
        assert!(!reply.header("content-type").contains("html"), "{uri}");
        assert!(!reply.body.contains("app-head"), "{uri}");
    }
    // An unknown API route is an API 404, not the shell.
    let reply = get(&app, "/api/no-such-route").await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND);
    assert!(reply.header("content-type").contains("json"));
}

#[tokio::test]
async fn slash_terminated_paths_redirect_permanently_keeping_the_query() {
    let (app, _) = boot().await;
    let reply = get(&app, "/search/?from=A&to=B").await;
    assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(reply.header("location"), "/search?from=A&to=B");
    let reply = get(&app, "/brands/x//").await;
    assert_eq!(reply.header("location"), "/brands/x");
}

#[tokio::test]
async fn only_the_home_page_carries_the_faq_and_the_hero_preload() {
    let (app, _) = boot().await;
    let home = get(&app, "/").await;
    assert!(home.body.contains("\"@type\":\"FAQPage\""));
    assert!(home
        .body
        .contains("rel=\"preload\" as=\"image\" href=\"/hero-vietnam-bus.avif\""));
    for uri in ["/search", "/privacy", "/login", "/does-not-exist"] {
        let page = get(&app, uri).await;
        assert!(!page.body.contains("FAQPage"), "{uri}");
        assert!(!page.body.contains("rel=\"preload\""), "{uri}");
    }
    for uri in ["/", "/search", "/login", "/does-not-exist"] {
        let page = get(&app, uri).await;
        assert!(page.body.contains("\"@type\":\"WebSite\""), "{uri}");
        assert!(page.body.contains("\"@type\":\"Organization\""), "{uri}");
    }
}

#[tokio::test]
async fn private_pages_are_noindex_without_canonical_or_previews() {
    let (app, _) = boot().await;
    for uri in ["/login", "/admin/brands", "/account", "/bookings/DXV-1"] {
        let page = get(&app, uri).await;
        let head = head_of(&page.body);
        assert_eq!(head.robots, "noindex, nofollow", "{uri}");
        assert_eq!(head.canonical, None, "{uri}");
        assert!(!page.body.contains("og:title"), "{uri}");
    }
    let trip = get(&app, "/trips/3f2c8c1e").await;
    assert_eq!(head_of(&trip.body).robots, "noindex, follow");
}

#[tokio::test]
async fn corridor_searches_are_pages_of_their_own() {
    let (app, _) = boot().await;
    let page = get(
        &app,
        "/search?from=H%C3%A0+N%E1%BB%99i&to=%C4%90%C3%A0+N%E1%BA%B5ng&date=2026-12-01",
    )
    .await;
    let head = head_of(&page.body);
    assert_eq!(
        head.title,
        "Vé xe Hà Nội đi Đà Nẵng — Đặt vé online | DatXeVui"
    );
    assert_eq!(
        head.canonical.as_deref(),
        Some("https://datxevui.com/search?from=H%C3%A0+N%E1%BB%99i&to=%C4%90%C3%A0+N%E1%BA%B5ng")
    );
    assert!(page.body.contains("property=\"og:url\""));
}

#[tokio::test]
async fn prerendered_pages_keep_their_text_and_get_their_head() {
    let (app, _) = boot().await;
    let page = get(&app, "/privacy").await;
    assert_eq!(page.status, StatusCode::OK);
    assert!(page.body.contains("<h1>Chính sách bảo mật</h1>"));
    assert_eq!(head_of(&page.body).title, "Chính sách bảo mật — DatXeVui");
}

async fn insert_brand(
    state: &backend::state::AppState,
    slug: &str,
    name: &str,
    description: Option<&str>,
    status: &str,
) {
    use backend::entity::brand;
    let now = "2026-11-15T00:00:00.000Z".to_owned();
    brand::ActiveModel {
        id: Set(uuid::Uuid::new_v4()),
        slug: Set(slug.to_owned()),
        name: Set(name.to_owned()),
        description: Set(description.map(str::to_owned)),
        status: Set(status.to_owned()),
        total_trips: Set(0),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(state.db.as_ref())
    .await
    .expect("insert brand");
}

#[tokio::test]
async fn brand_pages_take_their_head_from_the_database() {
    let (app, state) = boot().await;
    insert_brand(
        &state,
        "phuong-trang",
        "Phương Trang",
        Some("  Xe giường nằm, limousine.  "),
        "active",
    )
    .await;
    insert_brand(
        &state,
        "thanh-buoi",
        "Thành Bưởi & Co \"Express\"",
        None,
        "active",
    )
    .await;
    insert_brand(&state, "blank", "Blank", Some("   "), "active").await;
    insert_brand(&state, "retired", "Retired", None, "inactive").await;

    let page = get(&app, "/brands/phuong-trang").await;
    assert_eq!(page.status, StatusCode::OK);
    let head = head_of(&page.body);
    assert_eq!(
        head.title,
        "Phương Trang — Đặt vé xe Phương Trang online | DatXeVui"
    );
    assert_eq!(head.description, "Xe giường nằm, limousine.");
    assert_eq!(
        head.canonical.as_deref(),
        Some("https://datxevui.com/brands/phuong-trang")
    );
    assert_eq!(head.robots, "index, follow");

    // No description of its own: the generic one, with the brand's name. Its
    // quotes and ampersand never break out of the markup.
    let page = get(&app, "/brands/thanh-buoi").await;
    let head = head_of(&page.body);
    assert_eq!(
        head.title,
        "Thành Bưởi & Co \"Express\" — Đặt vé xe Thành Bưởi & Co \"Express\" online | DatXeVui"
    );
    assert!(page
        .body
        .contains("Thành Bưởi &amp; Co &quot;Express&quot;"));
    assert_eq!(
        head.description,
        "Đặt vé xe Thành Bưởi & Co \"Express\" trực tuyến: các tuyến đang chạy, giờ đi, giá vé và đánh giá của hành khách."
    );
    let blank = head_of(&get(&app, "/brands/blank").await.body);
    assert!(blank.description.starts_with("Đặt vé xe Blank trực tuyến"));

    // Unknown and inactive brands are 404s, with the not-found head.
    for uri in ["/brands/khong-co", "/brands/retired"] {
        let page = get(&app, uri).await;
        assert_eq!(page.status, StatusCode::NOT_FOUND, "{uri}");
        assert_eq!(head_of(&page.body).title, "Không tìm thấy trang — DatXeVui");
    }
}

#[tokio::test]
async fn the_sitemap_lists_static_pages_active_brands_and_corridors() {
    use backend::entity::route;
    let (app, state) = boot().await;
    insert_brand(&state, "phuong-trang", "Phương Trang", None, "active").await;
    insert_brand(&state, "retired", "Retired", None, "inactive").await;
    let now = "2026-11-15T00:00:00.000Z";
    for (from, to, status) in [
        ("ha-noi", "da-nang", "active"),
        ("ha-noi", "da-nang", "active"), // another brand's route, same corridor
        ("da-nang", "ha-noi", "active"),
        ("ha-noi", "hue", "inactive"),
    ] {
        route::ActiveModel {
            id: Set(uuid::Uuid::new_v4()),
            name: Set(format!("{from}-{to}")),
            start_location_id: Set(from.into()),
            end_location_id: Set(to.into()),
            status: Set(status.into()),
            created_at: Set(now.into()),
            updated_at: Set(now.into()),
            ..Default::default()
        }
        .insert(state.db.as_ref())
        .await
        .expect("insert route");
    }

    let reply = get(&app, "/sitemap.xml").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(
        reply.header("content-type"),
        "application/xml; charset=utf-8"
    );
    assert_eq!(reply.header("cache-control"), "public, max-age=3600");
    let xml = reply.body;
    for loc in [
        "https://datxevui.com/",
        "https://datxevui.com/search",
        "https://datxevui.com/compare",
        "https://datxevui.com/privacy",
        "https://datxevui.com/terms",
        "https://datxevui.com/brands/phuong-trang",
        "https://datxevui.com/search?from=H%C3%A0+N%E1%BB%99i&amp;to=%C4%90%C3%A0+N%E1%BA%B5ng",
        "https://datxevui.com/search?from=%C4%90%C3%A0+N%E1%BA%B5ng&amp;to=H%C3%A0+N%E1%BB%99i",
    ] {
        assert_eq!(
            xml.matches(&format!("<loc>{loc}</loc>")).count(),
            1,
            "{loc}\n{xml}"
        );
    }
    assert_eq!(xml.matches("<url>").count(), 8, "{xml}");
    for absent in ["/login", "/brands/retired", "to=Hu"] {
        assert!(!xml.contains(absent), "{absent}\n{xml}");
    }
}

#[tokio::test]
async fn robots_points_at_the_sitemap_and_hides_the_private_areas() {
    let (app, _) = boot().await;
    let reply = get(&app, "/robots.txt").await;
    assert_eq!(reply.status, StatusCode::OK);
    for line in [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /admin/",
        "Disallow: /bookings/",
        "Disallow: /payments/",
        "Crawl-delay: 1",
    ] {
        assert!(reply.body.lines().any(|l| l == line), "{line}");
    }
    assert!(reply
        .body
        .lines()
        .any(|l| l == "Sitemap: https://datxevui.com/sitemap.xml"));
}

#[tokio::test]
async fn static_files_are_cached_as_the_worker_did() {
    let (app, _) = boot().await;
    let day = "public, max-age=86400, stale-while-revalidate=604800";
    for uri in [
        "/fonts/geist.css",
        "/icons/icon-192.png",
        "/hero-vietnam-bus.webp",
        "/logo.svg",
    ] {
        let reply = get(&app, uri).await;
        assert_eq!(reply.status, StatusCode::OK, "{uri}");
        assert_eq!(reply.header("cache-control"), day, "{uri}");
    }
    assert_eq!(
        get(&app, "/sw.js").await.header("cache-control"),
        "no-cache"
    );
    assert_eq!(
        get(&app, "/assets/app-abc123.js")
            .await
            .header("cache-control"),
        "public, max-age=31536000, immutable"
    );
    assert_eq!(
        get(&app, "/").await.header("cache-control"),
        "no-cache, must-revalidate"
    );
    // Files with no rule of their own keep the configured default; a plain
    // `.html` file that is not a shell is still a file.
    let ads = get(&app, "/ads.txt").await;
    assert_eq!(ads.status, StatusCode::OK);
    assert!(ads.header("cache-control").starts_with("public, max-age="));
    let offline = get(&app, "/offline.html").await;
    assert_eq!(offline.status, StatusCode::OK);
    assert_eq!(offline.body, "<p>offline</p>");
}

#[tokio::test]
async fn the_retired_builds_chunks_are_served_for_30_days() {
    let (app, _) = boot().await;
    let reply = get(&app, "/_next/static/chunks/main-9f.js").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body, "legacy");
    assert_eq!(
        reply.header("cache-control"),
        "public, max-age=2592000, immutable"
    );
    let missing = get(&app, "/_next/static/chunks/gone.js").await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
    assert!(!missing.header("content-type").contains("html"));
    // The traversal attempt stays inside the directory.
    let escape = get(&app, "/_next/static/../index.html").await;
    assert_ne!(escape.body, SHELL);
}

/// The CSP floor and Permissions-Policy are on every response, whoever
/// produced it: pages, files, 404s, API errors, the media sandbox.
#[tokio::test]
async fn every_response_carries_the_security_floor() {
    let (app, _) = boot().await;
    let mut seen = Vec::new();
    for uri in [
        "/",
        "/does-not-exist",
        "/search/",
        "/health",
        "/sitemap.xml",
        "/robots.txt",
        "/fonts/geist.css",
        "/assets/missing.js",
        "/api/no-such-route",
        "/api/brands",
    ] {
        seen.push((uri, get(&app, uri).await));
    }
    // Blocked by anti-scraping before any handler runs.
    seen.push((
        "blocked UA",
        get_as(&app, "/api/brands", "curl/8.4.0").await,
    ));
    for (uri, reply) in &seen {
        assert_eq!(
            reply.header("content-security-policy"),
            "base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
            "{uri}"
        );
        assert_eq!(
            reply.header("permissions-policy"),
            "camera=(), microphone=(self), geolocation=(self), payment=(), usb=()",
            "{uri}"
        );
        assert_eq!(reply.header("x-content-type-options"), "nosniff", "{uri}");
        assert_eq!(reply.header("x-frame-options"), "DENY", "{uri}");
    }
    assert_eq!(seen.last().unwrap().1.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn media_is_served_under_a_sandboxing_csp() {
    let (app, _) = boot().await;
    for uri in ["/api/media/routes/not-a-key", "/api/media/x"] {
        let reply = get(&app, uri).await;
        assert_eq!(
            reply.header("content-security-policy"),
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "{uri}"
        );
        assert!(!reply.header("permissions-policy").is_empty(), "{uri}");
    }
}

//! The web app's delivery: static files, the SPA shell and its per-page head.
//!
//! Every path that is not an API route, a socket or an SEO file lands in
//! [`Web::serve`]:
//!
//! * `/foo/` answers 308 to `/foo` (one URL per page, query kept);
//! * `/assets/*` (content-hashed build output) is immutable for a year and a
//!   plain 404 when missing, never HTML: a stale shell asking for a retired
//!   chunk must fail loudly, not receive a page it parses as a module;
//! * `/_next/static/*` comes from the previous (Next.js) build, kept for 30
//!   days so shells cached before the cutover still find their chunks;
//! * a file in the build directory is served with the cache policy of the old
//!   `_headers` (fonts, icons, hero and logo images: a day plus a week of
//!   stale-while-revalidate; `sw.js`: always revalidated);
//! * everything else is a client-side route: the shell comes back with that
//!   page's own `<head>` ([`head`], from [`seo`]), status 404 when no page has
//!   the path or the brand it names does not exist.

pub mod head;
pub mod seo;

use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QuerySelect};
use tower::service_fn;
use tower::ServiceExt;
use tower_http::services::ServeDir;

use crate::config::StaticFilesConfig;
use crate::entity::brand;
use crate::error::AppError;
use head::Head;
use seo::{BrandFacts, PageFacts, Query, Strings};

/// Fonts, icons and images are not content-hashed: a day in the browser, then
/// a week of stale-while-revalidate, not a revalidation per visit.
const DAY_THEN_REVALIDATE: &str = "public, max-age=86400, stale-while-revalidate=604800";
const IMMUTABLE_YEAR: &str = "public, max-age=31536000, immutable";
/// Content-hashed files of the retired build: 30 days, then gone.
const LEGACY_NEXT_CACHE: &str = "public, max-age=2592000, immutable";
const SHELL_CACHE: &str = "no-cache, must-revalidate";

/// How long a brand's name and description are reused for its page head.
const BRAND_TTL: Duration = Duration::from_secs(60);
const BRAND_CACHE_ENTRIES: u64 = 2048;

/// What the database says about the brand a page names.
enum BrandLookup {
    Found(BrandFacts),
    /// No active brand has the slug.
    Missing,
    /// The database could not be read; the page still renders, generically.
    Unavailable,
}

/// The built SPA and the state its head needs.
pub struct Web {
    dist: PathBuf,
    default_cache_age: u64,
    files: ServeDir,
    legacy_next: Option<ServeDir>,
    strings: tokio::sync::OnceCell<Strings>,
    brands: moka::future::Cache<String, Option<BrandFacts>>,
    db: Arc<DatabaseConnection>,
}

/// The catch-all service for every path no other route took.
pub fn router<S>(config: &StaticFilesConfig, db: Arc<DatabaseConnection>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let web = Arc::new(Web::new(config, db));
    let service = service_fn(move |req: Request<Body>| {
        let web = web.clone();
        async move { Ok::<_, Infallible>(web.serve(req).await) }
    });
    Router::new()
        .route_service("/", service.clone())
        .route_service("/{*path}", service)
}

impl Web {
    fn new(config: &StaticFilesConfig, db: Arc<DatabaseConnection>) -> Self {
        let files = |dir: &Path| ServeDir::new(dir).precompressed_gzip().precompressed_br();
        Self {
            dist: config.dir.clone(),
            default_cache_age: config.cache_max_age,
            files: files(&config.dir),
            legacy_next: config.legacy_next_dir.as_deref().map(files),
            strings: tokio::sync::OnceCell::new(),
            brands: moka::future::Cache::builder()
                .max_capacity(BRAND_CACHE_ENTRIES)
                .time_to_live(BRAND_TTL)
                .build(),
            db,
        }
    }

    async fn serve(&self, req: Request<Body>) -> Response {
        if !matches!(*req.method(), Method::GET | Method::HEAD) {
            let mut resp = StatusCode::METHOD_NOT_ALLOWED.into_response();
            resp.headers_mut()
                .insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
            return resp;
        }
        let path = req.uri().path().to_owned();
        let query = req.uri().query().map(str::to_owned);

        // An unknown API path is an API answer, never a page.
        if path == "/api" || path.starts_with("/api/") {
            return AppError::NotFound("no such API route".into()).into_response();
        }
        if let Some(target) = seo::trailing_slash_target(&path, query.as_deref()) {
            return permanent_redirect(&target);
        }
        if path.starts_with("/assets/") {
            return self.file(&self.files, req, IMMUTABLE_YEAR).await;
        }
        if let (Some(legacy), Some(rest)) = (&self.legacy_next, path.strip_prefix("/_next/static/"))
        {
            let uri = format!("/{rest}");
            let (mut parts, body) = req.into_parts();
            parts.uri = uri.parse().unwrap_or(parts.uri);
            let req = Request::from_parts(parts, body);
            return self.file(legacy, req, LEGACY_NEXT_CACHE).await;
        }
        if path == "/" || self.is_shell_file(&path).await {
            return self.spa(&path, query.as_deref()).await;
        }

        let resp = serve_dir(&self.files, req).await;
        if resp.status() == StatusCode::NOT_FOUND {
            return self.spa(&path, query.as_deref()).await;
        }
        let cache = static_cache_control(&path)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("public, max-age={}", self.default_cache_age));
        with_cache_control(resp, &cache)
    }

    /// A file of `dir` that must exist: a miss is a plain 404, not the shell.
    async fn file(&self, dir: &ServeDir, req: Request<Body>, cache: &str) -> Response {
        let resp = serve_dir(dir, req).await;
        if resp.status() == StatusCode::NOT_FOUND {
            return plain_not_found("asset not found");
        }
        with_cache_control(resp, cache)
    }

    /// Whether `path` names a shell template (`/index.html`, a prerendered
    /// `/privacy.html`): serving one raw would hand out the unfilled
    /// placeholder as a page. Other `.html` files (`offline.html`) are plain
    /// static files.
    async fn is_shell_file(&self, path: &str) -> bool {
        let Some(name) = path.strip_prefix('/').filter(|n| n.ends_with(".html")) else {
            return false;
        };
        if name.contains('/') {
            return false;
        }
        tokio::fs::read_to_string(self.dist.join(name))
            .await
            .is_ok_and(|html| html.contains(head::PLACEHOLDER))
    }

    async fn seo_strings(&self) -> Result<&Strings, String> {
        self.strings
            .get_or_try_init(|| async {
                let file = self.dist.join("seo-strings.json");
                let json = tokio::fs::read_to_string(&file)
                    .await
                    .map_err(|e| format!("{}: {e}", file.display()))?;
                Strings::parse(&json).map_err(|e| format!("{}: {e}", file.display()))
            })
            .await
    }

    async fn brand(&self, encoded_slug: &str) -> BrandLookup {
        let Ok(slug) = urlencoding::decode(encoded_slug) else {
            return BrandLookup::Missing;
        };
        let db = self.db.clone();
        let key = slug.clone().into_owned();
        let lookup = self
            .brands
            .try_get_with(key, async move {
                let row = brand::Entity::find()
                    .filter(brand::Column::Slug.eq(slug.as_ref()))
                    .filter(brand::Column::Status.eq("active"))
                    .select_only()
                    .column(brand::Column::Name)
                    .column(brand::Column::Description)
                    .into_tuple::<(String, Option<String>)>()
                    .one(db.as_ref())
                    .await?;
                Ok::<_, sea_orm::DbErr>(
                    row.map(|(name, description)| BrandFacts { name, description }),
                )
            })
            .await;
        match lookup {
            Ok(Some(facts)) => BrandLookup::Found(facts),
            Ok(None) => BrandLookup::Missing,
            Err(e) => {
                tracing::warn!(error = %e, "brand lookup for the page head failed");
                BrandLookup::Unavailable
            }
        }
    }

    /// A client-side route: the shell with the page's head.
    async fn spa(&self, path: &str, query: Option<&str>) -> Response {
        // A path that names a file (`/vendor-dead.js`) is a missing file.
        if path.rsplit('/').next().is_some_and(|s| s.contains('.')) {
            return plain_not_found("not found");
        }
        let template = match self.template(path).await {
            Ok(html) => html,
            Err(e) => {
                tracing::warn!(error = %e, "the SPA shell is missing; is the frontend built?");
                return plain_not_found("frontend not built (dist/index.html missing)");
            }
        };

        let facts = match seo::brand_slug(path) {
            Some(slug) if seo::match_page(path).is_some() => match self.brand(slug).await {
                BrandLookup::Found(brand) => Some(PageFacts { brand: Some(brand) }),
                BrandLookup::Missing => None,
                BrandLookup::Unavailable => Some(PageFacts::default()),
            },
            _ => Some(PageFacts::default()),
        };
        let known = facts.is_some() && seo::match_page(path).is_some();
        let status = if known {
            StatusCode::OK
        } else {
            StatusCode::NOT_FOUND
        };

        // A shell with no placeholder (a stand-in `static/index.html`) takes
        // no head; every real build does, and then needs its strings.
        let html = if template.contains(head::PLACEHOLDER) {
            let strings = match self.seo_strings().await {
                Ok(strings) => strings,
                Err(e) => {
                    tracing::error!(error = %e, "the SEO strings are unusable; the frontend build is incomplete");
                    return (
                        StatusCode::SERVICE_UNAVAILABLE,
                        [(header::CACHE_CONTROL, "no-store")],
                        "frontend build incomplete (dist/seo-strings.json)",
                    )
                        .into_response();
                }
            };
            let query = Query::parse(query.unwrap_or(""));
            let page = facts.and_then(|facts| seo::page_seo(path, &query, strings, &facts));
            let not_found_title;
            let head = match &page {
                Some(page) => Head {
                    title: &page.title,
                    description: Some(&page.description),
                    canonical: page.canonical.as_deref(),
                    robots: page.robots,
                    home: path == "/",
                },
                None => {
                    not_found_title = strings.t("seo.notFound.title", &[]);
                    Head {
                        title: &not_found_title,
                        description: None,
                        canonical: None,
                        robots: seo::NOT_FOUND_ROBOTS,
                        home: false,
                    }
                }
            };
            template.replacen(head::PLACEHOLDER, &head.render(), 1)
        } else {
            template
        };
        let mut resp = (status, Body::from(html)).into_response();
        let headers = resp.headers_mut();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(SHELL_CACHE));
        resp
    }

    /// The shell for `path`: `/privacy` and `/terms` have prerendered pages
    /// (their text, for crawlers and provider reviewers), every other route
    /// shares `index.html`.
    async fn template(&self, path: &str) -> std::io::Result<String> {
        if let Some(page) = prerendered_page(&self.dist, path) {
            if let Ok(html) = tokio::fs::read_to_string(&page).await {
                return Ok(html);
            }
        }
        tokio::fs::read_to_string(self.dist.join("index.html")).await
    }
}

async fn serve_dir(dir: &ServeDir, req: Request<Body>) -> Response {
    match dir.clone().oneshot(req).await {
        Ok(resp) => resp.map(Body::new),
        Err(never) => match never {},
    }
}

/// Sets `Cache-Control` on a served file (not on an error answer).
fn with_cache_control(mut resp: Response, value: &str) -> Response {
    if resp.status().is_success() || resp.status() == StatusCode::NOT_MODIFIED {
        if let Ok(value) = HeaderValue::from_str(value) {
            resp.headers_mut()
                .entry(header::CACHE_CONTROL)
                .or_insert(value);
        }
    }
    resp
}

/// The cache policy of a static file by path, matching the Worker's
/// `_headers`; `None` for files with no rule of their own.
fn static_cache_control(path: &str) -> Option<&'static str> {
    // The service worker must always be revalidated or updates never ship.
    if path == "/sw.js" {
        return Some("no-cache");
    }
    let day = path.starts_with("/fonts/")
        || path.starts_with("/icons/")
        || path.starts_with("/hero-")
        || path.starts_with("/logo")
        || matches!(
            path,
            "/og-image.png" | "/favicon.ico" | "/manifest.webmanifest"
        );
    day.then_some(DAY_THEN_REVALIDATE)
}

fn permanent_redirect(target: &str) -> Response {
    let mut resp = StatusCode::PERMANENT_REDIRECT.into_response();
    if let Ok(location) = HeaderValue::from_str(target) {
        resp.headers_mut().insert(header::LOCATION, location);
    }
    resp
}

fn plain_not_found(text: &'static str) -> Response {
    (
        StatusCode::NOT_FOUND,
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        text,
    )
        .into_response()
}

/// `dist/<name>.html` beside `index.html` for a one-segment path such as
/// `/privacy`. Only lowercase letters, digits and dashes qualify, so a
/// request can never name a file outside the build directory.
fn prerendered_page(dist: &Path, path: &str) -> Option<PathBuf> {
    let name = path.strip_prefix('/')?;
    let safe = !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    safe.then(|| dist.join(format!("{name}.html")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_safe_one_segment_paths_map_to_prerendered_pages() {
        let dist = Path::new("/srv/dist");
        assert_eq!(
            prerendered_page(dist, "/privacy"),
            Some(PathBuf::from("/srv/dist/privacy.html"))
        );
        for path in [
            "/",
            "/admin/brands",
            "/../etc/passwd",
            "/Privacy",
            "/a.b",
            "/x%2e",
        ] {
            assert_eq!(prerendered_page(dist, path), None, "{path}");
        }
    }

    #[test]
    fn static_files_follow_the_worker_cache_rules() {
        for path in [
            "/fonts/geist.css",
            "/icons/icon-192.png",
            "/hero-vietnam-bus.avif",
            "/logo.svg",
            "/logo-mask.svg",
            "/og-image.png",
            "/favicon.ico",
            "/manifest.webmanifest",
        ] {
            assert_eq!(
                static_cache_control(path),
                Some(DAY_THEN_REVALIDATE),
                "{path}"
            );
        }
        assert_eq!(static_cache_control("/sw.js"), Some("no-cache"));
        for path in ["/ads.txt", "/offline.html", "/heroes.png", "/fontsx/a"] {
            assert_eq!(static_cache_control(path), None, "{path}");
        }
    }
}

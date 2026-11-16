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
//!   page's own `<head>` ([`head`], from [`seo`]) and, for the public pages,
//!   the page's text inside the app's root ([`content`]) so a crawler reads it
//!   without running a script; status 404 when no page has the path or the
//!   brand it names does not exist.
//!
//! A public page is the same for every visitor, so it is sent for the edge to
//! keep (`s-maxage`, with an `ETag`); a private page and an error never are.
//! What the pages read from the database is kept in memory for five minutes.

pub mod content;
pub mod head;
mod hints;
pub mod seo;

use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use sha2::{Digest, Sha256};
use tower::service_fn;
use tower::ServiceExt;
use tower_http::services::ServeDir;

use crate::config::StaticFilesConfig;
use crate::dto::public::BrandProfile;
use crate::error::AppError;
use crate::service::trip_search::{Filters, Options, Sort};
use crate::service::trip_time;
use crate::service::PublicService;
use content::{Content, CorridorData, CorridorDay, HomeData};
use head::Head;
use seo::{BrandFacts, Corridor, Page, PageFacts, PageKind, Query, Strings};

/// Fonts, icons and images are not content-hashed: a day in the browser, then
/// a week of stale-while-revalidate, not a revalidation per visit.
const DAY_THEN_REVALIDATE: &str = "public, max-age=86400, stale-while-revalidate=604800";
const IMMUTABLE_YEAR: &str = "public, max-age=31536000, immutable";
/// Content-hashed files of the retired build: 30 days, then gone.
const LEGACY_NEXT_CACHE: &str = "public, max-age=2592000, immutable";
const SHELL_CACHE: &str = "no-cache, must-revalidate";

/// A public page is the same for everyone: the edge keeps it five minutes, may
/// serve it an hour longer while it fetches a fresh one (a page names the hashed
/// files of its release, and `update.sh` keeps those for three releases), and a
/// day longer if the origin is down; browsers always ask.
const PUBLIC_PAGE_CACHE: &str =
    "public, max-age=0, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400";

/// How long what a page reads from the database is reused.
const PAGE_DATA_TTL: Duration = Duration::from_secs(300);
const PAGE_CACHE_ENTRIES: u64 = 2048;

/// What the database says about the brand a page names.
enum BrandLookup {
    Found(Arc<BrandProfile>),
    /// No active brand has the slug.
    Missing,
    /// The database could not be read; the page still renders, generically.
    Unavailable,
}

/// The built SPA and the state its pages need.
pub struct Web {
    dist: PathBuf,
    default_cache_age: u64,
    files: ServeDir,
    legacy_next: Option<ServeDir>,
    strings: tokio::sync::OnceCell<Strings>,
    public: Arc<PublicService>,
    home: moka::future::Cache<(), Arc<HomeData>>,
    brands: moka::future::Cache<String, Option<Arc<BrandProfile>>>,
    /// Keyed by the two cities' slugs, never by the text of the request.
    corridors: moka::future::Cache<(&'static str, &'static str), Arc<CorridorData>>,
}

/// The catch-all service for every path no other route took.
pub fn router<S>(config: &StaticFilesConfig, public: Arc<PublicService>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let web = Arc::new(Web::new(config, public));
    let service = service_fn(move |req: Request<Body>| {
        let web = web.clone();
        async move { Ok::<_, Infallible>(web.serve(req).await) }
    });
    Router::new()
        .route_service("/", service.clone())
        .route_service("/{*path}", service)
}

impl Web {
    fn new(config: &StaticFilesConfig, public: Arc<PublicService>) -> Self {
        let files = |dir: &Path| ServeDir::new(dir).precompressed_gzip().precompressed_br();
        fn cache<K, V>() -> moka::future::Cache<K, V>
        where
            K: std::hash::Hash + Eq + Send + Sync + 'static,
            V: Clone + Send + Sync + 'static,
        {
            moka::future::Cache::builder()
                .max_capacity(PAGE_CACHE_ENTRIES)
                .time_to_live(PAGE_DATA_TTL)
                .build()
        }
        Self {
            dist: config.dir.clone(),
            default_cache_age: config.cache_max_age,
            files: files(&config.dir),
            legacy_next: config.legacy_next_dir.as_deref().map(files),
            strings: tokio::sync::OnceCell::new(),
            public,
            home: cache(),
            brands: cache(),
            corridors: cache(),
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
        let if_none_match = req.headers().get(header::IF_NONE_MATCH).cloned();

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
            return self
                .spa(&path, query.as_deref(), if_none_match.as_ref())
                .await;
        }

        let resp = serve_dir(&self.files, req).await;
        if resp.status() == StatusCode::NOT_FOUND {
            return self
                .spa(&path, query.as_deref(), if_none_match.as_ref())
                .await;
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
        let public = self.public.clone();
        let key = slug.clone().into_owned();
        let lookup = self
            .brands
            .try_get_with(key, async move {
                match public.brand_profile(&slug).await {
                    Ok(profile) => Ok(Some(Arc::new(profile))),
                    Err(AppError::NotFound(_)) => Ok(None),
                    Err(e) => Err(e),
                }
            })
            .await;
        match lookup {
            Ok(Some(profile)) => BrandLookup::Found(profile),
            Ok(None) => BrandLookup::Missing,
            Err(e) => {
                tracing::warn!(error = %e, "brand lookup for the page failed");
                BrandLookup::Unavailable
            }
        }
    }

    /// What the home page shows; the parts the database could not give are
    /// absent. `None` only when it gave nothing at all.
    async fn home_data(&self) -> Option<Arc<HomeData>> {
        let public = self.public.clone();
        let loaded = self
            .home
            .try_get_with((), async move {
                let (routes, brands, stats, recommendations) = tokio::join!(
                    public.list_routes(None, 50),
                    public.list_brands(20),
                    public.stats(),
                    public.recommendations(),
                );
                let data = HomeData {
                    routes: routes.map_err(log_unavailable).ok(),
                    brands: brands.map_err(log_unavailable).ok(),
                    stats: stats.map_err(log_unavailable).ok(),
                    recommendations: recommendations.map_err(log_unavailable).ok(),
                    generated_at_ms: chrono::Utc::now().timestamp_millis(),
                };
                if data.routes.is_none() && data.brands.is_none() {
                    return Err("neither the routes nor the brands could be read");
                }
                Ok(Arc::new(data))
            })
            .await;
        match loaded {
            Ok(data) => Some(data),
            Err(e) => {
                tracing::warn!(error = %e, "home page data unavailable");
                None
            }
        }
    }

    /// Today's and tomorrow's departures on `corridor`; an error when the
    /// database could not be read. One entry per pair of cities, however many
    /// ways a request spells them.
    async fn corridor_data(&self, corridor: &Corridor) -> Result<Arc<CorridorData>, ()> {
        let public = self.public.clone();
        let key = (corridor.from_slug, corridor.to_slug);
        let loaded = self
            .corridors
            .try_get_with(key, async move {
                let (from, to) = (
                    crate::cities::name_for_slug(key.0),
                    crate::cities::name_for_slug(key.1),
                );
                let today = trip_time::local_today();
                let tomorrow = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d")
                    .map(|d| {
                        (d + chrono::Duration::days(1))
                            .format("%Y-%m-%d")
                            .to_string()
                    })
                    .map_err(|e| e.to_string())?;
                let mut days = Vec::new();
                for date in [today.clone(), tomorrow] {
                    let options = Options::new(
                        &date,
                        Some(content::CORRIDOR_TRIPS_PER_DAY as u64),
                        None,
                        Sort::Departure,
                        None,
                        None,
                        Filters::default(),
                    )
                    .map_err(|e| e.to_string())?;
                    let found = public
                        .search_trips(&from, &to, &options)
                        .await
                        .map_err(|e| e.to_string())?;
                    days.push(CorridorDay {
                        date,
                        trips: found.items,
                    });
                }
                Ok::<_, String>(Arc::new(CorridorData { today, days }))
            })
            .await;
        match loaded {
            Ok(data) => Ok(data),
            Err(e) => {
                tracing::warn!(error = %e, "corridor page data unavailable");
                Err(())
            }
        }
    }

    /// The text of the page: `None` when it has none to add (a private page,
    /// a prerendered one). `degraded` is set when the database could not give
    /// what the page shows, so the page is not worth keeping.
    async fn page_content(
        &self,
        page: Page,
        query: &Query,
        strings: &Strings,
        brand: Option<&BrandProfile>,
        corridor: Option<&Corridor>,
        degraded: &mut bool,
    ) -> Option<Content> {
        let today = trip_time::local_today();
        match (page.key, seo::search_route(query)) {
            ("home", _) | ("search", None) => {
                let data = self.home_data().await;
                *degraded |= data.is_none();
                let empty = HomeData::default();
                let data = data.as_deref().unwrap_or(&empty);
                Some(if page.key == "home" {
                    content::home(strings, data, &today)
                } else {
                    content::search(strings, data, &today)
                })
            }
            ("search", Some(_)) => match self.corridor_data(corridor?).await {
                Ok(data) => Some(content::corridor(
                    strings,
                    &corridor?.from,
                    &corridor?.to,
                    &data,
                )),
                Err(()) => {
                    *degraded = true;
                    None
                }
            },
            ("compare", _) => Some(content::plain(strings, page.key)),
            ("brandDetail", _) => brand.map(|p| content::brand(strings, p, &today)),
            _ => None,
        }
    }

    /// A client-side route: the shell with the page's head and text.
    async fn spa(
        &self,
        path: &str,
        query: Option<&str>,
        if_none_match: Option<&HeaderValue>,
    ) -> Response {
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

        let page = seo::match_page(path);
        let mut brand = None;
        let mut degraded = false;
        let mut unlisted = false;
        let facts = match (seo::brand_slug(path), page) {
            (Some(slug), Some(_)) => match self.brand(slug).await {
                BrandLookup::Found(profile) => {
                    let facts = PageFacts {
                        brand: Some(BrandFacts {
                            name: profile.brand.name.clone(),
                            description: profile.brand.description.clone(),
                        }),
                    };
                    brand = Some(profile);
                    Some(facts)
                }
                BrandLookup::Missing => None,
                BrandLookup::Unavailable => {
                    degraded = true;
                    Some(PageFacts::default())
                }
            },
            _ => Some(PageFacts::default()),
        };
        let known = facts.is_some() && page.is_some();
        let status = if known {
            StatusCode::OK
        } else {
            StatusCode::NOT_FOUND
        };

        let hints = hints::links(&template, known && path == "/");
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
            let mut query = Query::parse(query.unwrap_or(""));
            // A corridor is named the same way everywhere on the page: the head,
            // the canonical URL, the heading and the breadcrumb.
            let searched = page
                .filter(|p| p.key == "search")
                .and_then(|_| seo::search_route(&query))
                .map(|(from, to)| (seo::resolve_corridor(from, to), true));
            let (corridor, named_ends) = searched.unwrap_or((None, false));
            if let Some(c) = &corridor {
                query = Query::with_route(&c.from, &c.to);
            }
            let mut page_seo = facts.and_then(|facts| seo::page_seo(path, &query, strings, &facts));
            // A search between names the catalogue does not know (or that name
            // several cities) has nothing to list: it is for the app to answer,
            // not for a search engine to keep, and not for the edge to keep.
            if let (Some(seo), true, None) = (page_seo.as_mut(), named_ends, &corridor) {
                seo.robots = PageKind::Noindex.robots();
                seo.canonical = None;
                unlisted = true;
            }
            let content = match (page, &page_seo) {
                (Some(page), Some(_)) => {
                    self.page_content(
                        page,
                        &query,
                        strings,
                        brand.as_deref(),
                        corridor.as_ref(),
                        &mut degraded,
                    )
                    .await
                }
                _ => None,
            }
            .unwrap_or_default();
            let not_found_title;
            let head = match &page_seo {
                Some(page) => Head {
                    title: &page.title,
                    description: Some(&page.description),
                    canonical: page.canonical.as_deref(),
                    robots: page.robots,
                    home: path == "/",
                    structured: &content.structured,
                },
                None => {
                    not_found_title = strings.t("seo.notFound.title", &[]);
                    Head {
                        title: &not_found_title,
                        description: None,
                        canonical: None,
                        robots: seo::NOT_FOUND_ROBOTS,
                        home: false,
                        structured: &[],
                    }
                }
            };
            template
                .replacen(head::PLACEHOLDER, &head.render(), 1)
                .replacen(head::APP_HTML, &content.html, 1)
        } else {
            template
        };

        let shared = known
            && !degraded
            && !unlisted
            && matches!(
                page.map(|p| p.kind),
                Some(PageKind::Public | PageKind::Noindex)
            );
        let mut resp = if shared {
            page_response(status, html, if_none_match)
        } else {
            let mut resp = (status, Body::from(html)).into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static(SHELL_CACHE));
            resp
        };
        let headers = resp.headers_mut();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        for link in hints {
            if let Ok(link) = HeaderValue::from_str(&link) {
                headers.append(header::LINK, link);
            }
        }
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

/// A public page for the edge to keep: the same bytes for everyone, with a
/// validator, so a revalidation costs no body.
fn page_response(
    status: StatusCode,
    html: String,
    if_none_match: Option<&HeaderValue>,
) -> Response {
    let etag = format!(
        "W/\"{}\"",
        &hex::encode(Sha256::digest(html.as_bytes()))[..32]
    );
    let unchanged = status == StatusCode::OK
        && if_none_match
            .and_then(|v| v.to_str().ok())
            .is_some_and(|tags| {
                tags.split(',')
                    .map(|t| t.trim().trim_start_matches("W/"))
                    .any(|t| t == "*" || t == &etag[2..])
            });
    let mut resp = if unchanged {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        (status, Body::from(html)).into_response()
    };
    let headers = resp.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(PUBLIC_PAGE_CACHE),
    );
    if let Ok(etag) = HeaderValue::from_str(&etag) {
        headers.insert(header::ETAG, etag);
    }
    resp
}

fn log_unavailable(e: AppError) {
    tracing::warn!(error = %e, "home page data unavailable");
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

//! Anti-scraping middleware — blocks known scrapers, bots, and automated tools.
//!
//! ## Layers
//!
//! 1. **User-Agent blocklist** — blocks requests from known scraping tools
//!    (curl, wget, python-requests, scrapy, selenium, puppeteer, headless
//!    chrome, etc.). Legitimate browsers always send a UA string.
//!
//! 2. **Missing Referer/Origin check on mutations** — POST/PATCH/PUT/DELETE
//!    to `/api/*` must have a `Referer` or `Origin` header matching our
//!    allowed origins. This prevents cross-site form submissions + API
//!    calls from scripts (which don't set Referer).
//!
//! 3. **HEAD/OPTIONS bypass** — allowed through for health checks + CORS
//!    preflight.
//!
//! ## What this does NOT do
//!
//! - Block Googlebot (we WANT Google to crawl our site for SEO).
//! - Block all bots — that would break sitemap submission, health checks,
//!   and any legitimate API integration.
//! - Prevent determined scrapers — a sophisticated scraper can fake any
//!   header. This raises the bar (blocks casual scraping) but is not
//!   a silver bullet.
//!
//! ## Console/DevTools
//!
//! Browser-side console protection is handled separately in the frontend
//! entry point (`entry-client.tsx`) — it's a soft deterrent (detection +
//! warning), not a hard block. Hard blocks are impossible (the browser
//! runs user code).

use axum::http::{Method, Request};
use axum::middleware::Next;
use axum::response::Response;

use crate::error::AppError;

/// User-Agent substrings that indicate an automated tool, not a browser.
/// Checked case-insensitively. Googlebot/Bingbot are NOT in this list —
/// we WANT search engines to crawl us.
const BLOCKED_UA_SUBSTRINGS: &[&str] = &[
    // CLI HTTP tools
    "curl/",
    "wget/",
    "httpie/",
    "postmanruntime/",
    "insomnia/",
    // Programming-language HTTP libraries
    "python-requests/",
    "python-urllib/",
    "python-httpx/",
    "go-http-client/",
    "java/",
    "okhttp/",
    "node-fetch/",
    "axios/",
    "got/",
    // Scraping frameworks
    "scrapy",
    "mechanize",
    "httpx.rs",
    "reqwest/", // our own backend uses this — but only server-to-server,
    // never from the browser. If a request arrives with this
    // UA, it's a scraper pretending to be our backend.
    // Headless browsers used for scraping
    "headless",
    "phantomjs",
    "selenium",
    "puppeteer",
    "playwright",
    "webdriver",
    "nightmare",
    // Other bots
    "scrapybot",
    "spider",
    "crawl",
    // Empty UA — browsers always send one
    "",
];

/// Allowed Referer/Origin prefixes for mutation requests (POST/PATCH/PUT/DELETE).
/// The Referer/Origin must start with one of these to be accepted.
/// In dev, localhost origins are allowed; in production, the configured
/// CORS origins are used.
fn is_allowed_referer(referer: Option<&str>, allowed_origins: &[String]) -> bool {
    let referer = match referer {
        Some(r) => r,
        None => return false,
    };
    // Allow requests with no path (just origin) or with path.
    allowed_origins
        .iter()
        .any(|origin| referer.starts_with(origin.as_str()))
}

/// Check if a User-Agent looks like a real browser.
/// Real browsers include "Mozilla/5.0" and a rendering engine token.
fn is_browser_ua(ua: &str) -> bool {
    ua.contains("Mozilla/5.0")
        && (ua.contains("AppleWebKit") || ua.contains("Gecko") || ua.contains("KHTML"))
}

/// Check if a User-Agent is a known search engine bot (allowed to crawl).
fn is_search_engine_bot(ua: &str) -> bool {
    let ua_lower = ua.to_lowercase();
    ua_lower.contains("googlebot")
        || ua_lower.contains("bingbot")
        || ua_lower.contains("slurp")       // Yahoo
        || ua_lower.contains("baiduspider")
        || ua_lower.contains("yandexbot")
        || ua_lower.contains("facebookexternalhit")
        || ua_lower.contains("twitterbot")
        || ua_lower.contains("linkedinbot")
        || ua_lower.contains("whatsapp")
        || ua_lower.contains("zalo")
}

/// Check if a User-Agent is blocked (scraping tool, empty, etc.).
fn is_blocked_ua(ua: &str) -> bool {
    // Empty UA is always blocked (browsers always send one).
    if ua.trim().is_empty() {
        return true;
    }
    let ua_lower = ua.to_lowercase();
    for blocked in BLOCKED_UA_SUBSTRINGS {
        if !blocked.is_empty() && ua_lower.contains(blocked) {
            return true;
        }
    }
    false
}

/// Infra/health paths that are always exempt from every check in this
/// middleware. Docker HEALTHCHECK, CD deploy gates, and uptime monitors
/// probe these with CLI tools (curl/wget) — blocking them restart-loops
/// perfectly healthy containers.
fn is_infra_path(path: &str) -> bool {
    matches!(path, "/health" | "/ready")
}

/// Anti-scraping middleware.
///
/// Applied to all `/api/*` routes. Does NOT apply to:
///   - Static files (served directly, no API access)
///   - `/health` and `/ready` (uptime monitors need access)
///   - `/sitemap.xml` and `/robots.txt` (crawlers need access)
///   - WebSocket endpoints (`/ws`, `/ws-call`) — they have their own auth
pub async fn anti_scraping(
    req: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, AppError> {
    let headers = req.headers();
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    // ── 0. Infra paths are ALWAYS exempt ────────────────────────
    // Matches the module docs ("Does NOT apply to /health and /ready").
    if is_infra_path(path.as_str()) {
        return Ok(next.run(req).await);
    }

    // ── 1. User-Agent check ────────────────────────────────────
    let ua = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if is_blocked_ua(ua) {
        tracing::warn!(
            ua = %ua,
            path = %path,
            method = %method,
            "blocked request: blocked User-Agent"
        );
        return Err(AppError::Forbidden(
            "Access denied: automated tools are not allowed. Please use a web browser.".into(),
        ));
    }

    // ── 2. Referer/Origin check on mutations ──────────────────
    // POST/PATCH/PUT/DELETE to /api/* must have a Referer or Origin
    // header. This prevents cross-site form submissions + scripts that
    // don't set headers.
    if matches!(
        method,
        Method::POST | Method::PATCH | Method::PUT | Method::DELETE
    ) && path.starts_with("/api/")
    {
        // IPN webhook endpoints are exempt — payment gateways send POSTs
        // without Referer/Origin headers.
        if path.contains("/ipn/") || path.contains("/vitals") {
            // Payment webhooks + vitals beacon — no Referer check.
        } else {
            let referer = headers
                .get(axum::http::header::REFERER)
                .and_then(|v| v.to_str().ok());
            let origin = headers
                .get(axum::http::header::ORIGIN)
                .and_then(|v| v.to_str().ok());

            // Accept either Referer or Origin.
            let referer_or_origin = referer.or(origin);

            if !is_allowed_referer(
                referer_or_origin,
                ALLOWED_ORIGINS.get().map(|v| v.as_slice()).unwrap_or(&[]),
            ) {
                tracing::warn!(
                    referer = ?referer,
                    origin = ?origin,
                    path = %path,
                    method = %method,
                    "blocked request: missing or invalid Referer/Origin on mutation"
                );
                return Err(AppError::Forbidden(
                    "Access denied: invalid request origin.".into(),
                ));
            }
        }
    }

    // ── 3. API path check for non-browser UAs ──────────────────
    // If the UA isn't a browser AND isn't a search engine bot, block
    // access to /api/* (but allow static files + sitemap + robots).
    if path.starts_with("/api/")
        && !is_browser_ua(ua)
        && !is_search_engine_bot(ua)
        && !ua.contains("axios")
    {
        // Allow known monitoring tools (uptime checkers) that send a
        // proper User-Agent but aren't browsers.
        if !ua_lower_contains(ua, &["uptimerobot", "statuscake", "pingdom", "newrelic"]) {
            tracing::warn!(
                ua = %ua,
                path = %path,
                "blocked request: non-browser UA accessing API"
            );
            return Err(AppError::Forbidden(
                "Access denied: please use a web browser to access this resource.".into(),
            ));
        }
    }

    Ok(next.run(req).await)
}

fn ua_lower_contains(ua: &str, substrings: &[&str]) -> bool {
    let ua_lower = ua.to_lowercase();
    substrings.iter().any(|s| ua_lower.contains(s))
}

/// Allowed origins — initialized at startup from config.
/// Stored in a static OnceLock so the middleware can access it without
/// passing state through every request.
static ALLOWED_ORIGINS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

/// Initialize the allowed origins list. Called once at startup from
/// `build_router`.
pub fn init_allowed_origins(origins: Vec<String>) {
    let _ = ALLOWED_ORIGINS.set(origins);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_infra_path_exempt() {
        // Health endpoints must never be UA-blocked: Docker HEALTHCHECK
        // and CD gates probe them with curl (regression: 2026-09-07 the
        // layer wrapped the whole router and restart-looped the task).
        assert!(is_infra_path("/health"));
        assert!(is_infra_path("/ready"));
        assert!(!is_infra_path("/api/health"));
        assert!(!is_infra_path("/"));
        assert!(!is_infra_path("/api/public/routes"));
    }

    #[test]
    fn test_is_blocked_ua_curl() {
        assert!(is_blocked_ua("curl/7.81.0"));
    }

    #[test]
    fn test_is_blocked_ua_python_requests() {
        assert!(is_blocked_ua("python-requests/2.28.1"));
    }

    #[test]
    fn test_is_blocked_ua_empty() {
        assert!(is_blocked_ua(""));
    }

    #[test]
    fn test_is_blocked_ua_headless_chrome() {
        assert!(is_blocked_ua("HeadlessChrome/91.0.4472.114"));
    }

    #[test]
    fn test_is_blocked_ua_selenium() {
        assert!(is_blocked_ua("selenium/4.1.0"));
    }

    #[test]
    fn test_is_not_blocked_ua_chrome() {
        assert!(!is_blocked_ua(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        ));
    }

    #[test]
    fn test_is_not_blocked_ua_firefox() {
        assert!(!is_blocked_ua(
            "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0"
        ));
    }

    #[test]
    fn test_is_not_blocked_ua_googlebot() {
        assert!(!is_blocked_ua(
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
        ));
    }

    #[test]
    fn test_is_search_engine_bot_googlebot() {
        assert!(is_search_engine_bot("Googlebot/2.1"));
    }

    #[test]
    fn test_is_search_engine_bot_bingbot() {
        assert!(is_search_engine_bot("bingbot/2.0"));
    }

    #[test]
    fn test_is_browser_ua_chrome() {
        assert!(is_browser_ua(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0 Safari/537.36"
        ));
    }

    #[test]
    fn test_is_browser_ua_not_curl() {
        assert!(!is_browser_ua("curl/7.81.0"));
    }

    #[test]
    fn test_is_allowed_referer_matching() {
        assert!(is_allowed_referer(
            Some("http://localhost:5173/search"),
            &["http://localhost:5173".to_string()],
        ));
    }

    #[test]
    fn test_is_allowed_referer_non_matching() {
        assert!(!is_allowed_referer(
            Some("https://evil.com/api/steal"),
            &["http://localhost:5173".to_string()],
        ));
    }

    #[test]
    fn test_is_allowed_referer_none() {
        assert!(!is_allowed_referer(
            None,
            &["http://localhost:5173".to_string()]
        ));
    }
}

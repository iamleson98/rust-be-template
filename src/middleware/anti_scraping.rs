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
//! ## Exemptions
//!
//! * `/health`, `/ready`: uptime probes use curl.
//! * `/ws`, `/ws-call`: the socket hubs check every upgrade themselves
//!   (`ws::handler::check_ws_origin` plus the token/cookie), as the Worker
//!   does; a native client's WebSocket stack has its own User-Agent.
//! * Machine callers that authenticate by signature, not by browser
//!   headers: `/api/payments/ipn/*` (payment gateways) and
//!   `/api/webhooks/*` (Telegram, Zalo, Messenger, Discord). They are exempt
//!   from BOTH the User-Agent rules and the Origin/Referer rule; a gateway's
//!   UA is whatever its HTTP library sends and its POSTs carry no Origin.
//! * `/api/vitals`: the browser beacon sends no Referer.
//! * `X-Client: mobile` (the native app): exempt from the Origin/Referer
//!   rule only, as in the Worker (`edge-guard.ts`): a native client has no
//!   Origin. The header alone is NOT a pass for the User-Agent blocklist, so
//!   `curl -H 'X-Client: mobile'` is still blocked; the app's HTTP stack is
//!   not a browser, so it is also not held to the browser-UA rule below.
//!   The header is client-supplied: it only relaxes what a native client
//!   cannot satisfy, and per-IP rate limits apply to every request.
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

use axum::http::{HeaderMap, Method, Request};
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

/// Whether a mutation request's Referer/Origin belongs to one of the allowed
/// origins. Both sides are parsed and compared as scheme + host + port, so a
/// look-alike (`https://site.com.evil.com`) or another port never passes; a
/// Referer may carry a path, an Origin never does. In dev, localhost origins
/// are allowed; in production, the configured CORS origins are used.
fn is_allowed_referer(referer: Option<&str>, allowed_origins: &[String]) -> bool {
    let Some(source) = referer.and_then(|r| url::Url::parse(r).ok()) else {
        return false;
    };
    let source = source.origin();
    source.is_tuple()
        && allowed_origins
            .iter()
            .filter_map(|allowed| url::Url::parse(allowed).ok())
            .any(|allowed| allowed.origin() == source)
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

/// Check if a request explicitly identifies the native mobile client.
fn is_mobile_client(headers: &HeaderMap) -> bool {
    headers
        .get("x-client")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().eq_ignore_ascii_case("mobile"))
        .unwrap_or(false)
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

/// Machine callers that sign their requests instead of sending browser
/// headers: payment-gateway callbacks and chat-platform webhooks.
fn is_gateway_path(path: &str) -> bool {
    path.starts_with("/api/payments/ipn/") || path.starts_with("/api/webhooks/")
}

/// The two socket hubs: they authenticate every upgrade themselves (a token,
/// or a cookie from an allowed `Origin`), and a native client's HTTP stack
/// sends whatever User-Agent it likes.
fn is_socket_path(path: &str) -> bool {
    matches!(path, "/ws" | "/ws-call")
}

/// Anti-scraping middleware.
///
/// The User-Agent blocklist and the Origin/Referer rule apply to every path
/// (the browser-UA rule to `/api/*` only), except:
///   - `/health` and `/ready` (uptime monitors need access)
///   - payment-gateway callbacks and chat-platform webhooks
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
    if is_infra_path(path.as_str())
        || is_gateway_path(path.as_str())
        || is_socket_path(path.as_str())
    {
        return Ok(next.run(req).await);
    }

    // ── 1. User-Agent check ────────────────────────────────────
    let ua = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let is_mobile_client = is_mobile_client(headers);

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
        if path == "/api/vitals" || is_mobile_client {
            // The vitals beacon and the native mobile app do not have
            // browser Referer/Origin headers.
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
        && !is_mobile_client
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
    fn test_is_mobile_client_header() {
        let mut headers = HeaderMap::new();
        headers.insert("x-client", " mobile ".parse().unwrap());

        assert!(is_mobile_client(&headers));
    }

    #[test]
    fn test_is_mobile_client_header_case_insensitive() {
        let mut headers = HeaderMap::new();
        headers.insert("x-client", "Mobile".parse().unwrap());

        assert!(is_mobile_client(&headers));
    }

    #[test]
    fn test_is_mobile_client_header_rejects_other_clients() {
        let mut headers = HeaderMap::new();
        headers.insert("x-client", "web".parse().unwrap());

        assert!(!is_mobile_client(&headers));
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
    fn allowed_referer_compares_the_exact_origin() {
        let site = vec![
            "https://datxevui.com".to_string(),
            "http://localhost:5173".to_string(),
        ];
        for ok in [
            "https://datxevui.com",
            "https://datxevui.com/",
            "https://datxevui.com/search?from=a",
            "https://datxevui.com:443/x",
            "http://localhost:5173/search",
        ] {
            assert!(is_allowed_referer(Some(ok), &site), "{ok} must pass");
        }
        for bad in [
            "https://datxevui.com.evil.com",
            "https://datxevui.com.evil.com/path",
            "https://datxevui.com:8443",
            "http://datxevui.com",
            "https://evil.com/https://datxevui.com",
            "https://datxevui.com@evil.com",
            "http://localhost:51730",
            "null",
            "",
        ] {
            assert!(!is_allowed_referer(Some(bad), &site), "{bad} must fail");
        }
    }

    #[test]
    fn test_is_allowed_referer_none() {
        assert!(!is_allowed_referer(
            None,
            &["http://localhost:5173".to_string()]
        ));
    }

    mod layered {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use axum::routing::any;
        use axum::Router;
        use tower::ServiceExt;

        const BROWSER: &str =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
        const SITE: &str = "https://datxevui.com";

        async fn status(method: &str, path: &str, headers: &[(&str, &str)]) -> StatusCode {
            super::init_allowed_origins(vec![SITE.to_string()]);
            let app = Router::new()
                .route("/{*p}", any(|| async { "ok" }))
                .layer(axum::middleware::from_fn(super::anti_scraping));
            let mut req = Request::builder().method(method).uri(path);
            for (k, v) in headers {
                req = req.header(*k, *v);
            }
            app.oneshot(req.body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status()
        }

        #[tokio::test]
        async fn gateways_and_chat_platforms_pass_without_browser_headers() {
            for (method, path) in [
                ("POST", "/api/payments/ipn/momo"),
                ("GET", "/api/payments/ipn/vnpay"),
                ("POST", "/api/webhooks/telegram"),
                ("POST", "/api/webhooks/zalo"),
                ("POST", "/api/webhooks/messenger"),
                ("POST", "/api/webhooks/discord"),
            ] {
                for ua in ["curl/8.4.0", "Go-http-client/2.0", "node-fetch/1.0", ""] {
                    assert_eq!(
                        status(method, path, &[("user-agent", ua)]).await,
                        StatusCode::OK,
                        "{method} {path} as {ua:?}"
                    );
                }
            }
        }

        #[tokio::test]
        async fn the_socket_hubs_check_upgrades_themselves() {
            for path in ["/ws", "/ws-call"] {
                for ua in ["okhttp/4.12.0", "Dart/3.4 (dart:io)", "curl/8.4.0", ""] {
                    assert_eq!(
                        status("GET", path, &[("user-agent", ua)]).await,
                        StatusCode::OK,
                        "{path} as {ua:?}"
                    );
                }
            }
            for path in ["/ws/x", "/api/ws", "/ws-calls"] {
                assert_eq!(
                    status("GET", path, &[("user-agent", "curl/8.4.0")]).await,
                    StatusCode::FORBIDDEN,
                    "{path}"
                );
            }
        }

        #[tokio::test]
        async fn lookalike_paths_get_no_gateway_pass() {
            for path in ["/api/foo/ipn/x", "/api/webhooksx", "/api/vitals/x"] {
                assert_eq!(
                    status("POST", path, &[("user-agent", "curl/8.4.0")]).await,
                    StatusCode::FORBIDDEN,
                    "{path}"
                );
                assert_eq!(
                    status("POST", path, &[("user-agent", BROWSER)]).await,
                    StatusCode::FORBIDDEN,
                    "{path} without Origin"
                );
            }
        }

        #[tokio::test]
        async fn the_mobile_header_alone_is_no_pass_for_scraping_tools() {
            for ua in [
                "curl/8.4.0",
                "python-requests/2.31",
                "HeadlessChrome/120",
                "",
            ] {
                let headers = [("user-agent", ua), ("x-client", "mobile")];
                assert_eq!(
                    status("GET", "/api/brands", &headers).await,
                    StatusCode::FORBIDDEN,
                    "{ua:?}"
                );
                assert_eq!(
                    status("POST", "/api/bookings", &headers).await,
                    StatusCode::FORBIDDEN,
                    "{ua:?}"
                );
            }
        }

        #[tokio::test]
        async fn the_native_app_needs_no_origin() {
            let app = [("user-agent", "Dart/3.5 (dart:io)"), ("x-client", "mobile")];
            assert_eq!(status("POST", "/api/bookings", &app).await, StatusCode::OK);
            assert_eq!(status("GET", "/api/brands", &app).await, StatusCode::OK);
            // Without the header the same client is a non-browser.
            let bare = [("user-agent", "Dart/3.5 (dart:io)")];
            assert_eq!(
                status("GET", "/api/brands", &bare).await,
                StatusCode::FORBIDDEN
            );
        }

        #[tokio::test]
        async fn browsers_keep_the_origin_rule_on_mutations() {
            let ua = ("user-agent", BROWSER);
            assert_eq!(status("GET", "/api/brands", &[ua]).await, StatusCode::OK);
            assert_eq!(
                status("POST", "/api/bookings", &[ua]).await,
                StatusCode::FORBIDDEN
            );
            assert_eq!(
                status("POST", "/api/bookings", &[ua, ("origin", SITE)]).await,
                StatusCode::OK
            );
            assert_eq!(
                status(
                    "POST",
                    "/api/bookings",
                    &[ua, ("referer", "https://evil.example/")]
                )
                .await,
                StatusCode::FORBIDDEN
            );
            assert_eq!(status("POST", "/api/vitals", &[ua]).await, StatusCode::OK);
        }
    }
}

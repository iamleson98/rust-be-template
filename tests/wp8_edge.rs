//! WP8: the edge policy through the full router, configured for a Cloudflare
//! Tunnel origin (`CLIENT_IP_SOURCE=cf-connecting-ip`) with tiny rate limits:
//! per-IP classes, client address trust, the gateway and webhook exemptions
//! and the `X-Client: mobile` header.

use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Method, Request, StatusCode};
use tower::ServiceExt;

const BROWSER: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) wp8-test/1.0";
const SITE: &str = "https://datxevui.com";

async fn boot() -> axum::Router {
    use std::sync::Once;
    static ENV: Once = Once::new();
    ENV.call_once(|| {
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
        std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
        std::env::set_var("COOKIE_SECURE", "false");
        std::env::set_var("CACHE_BACKEND", "moka");
        std::env::set_var("WORKER_BACKEND", "db");
        std::env::set_var("SCHEDULER_ENABLED", "false");
        std::env::set_var("SEARCH_INDEX_DIR", "");
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
            std::env::temp_dir().join(format!("wp8-edge-storage-{}", uuid::Uuid::new_v4())),
        );
        std::env::remove_var("STORAGE_PUBLIC_BASE_URL");
        std::env::set_var("CORS_ORIGINS", SITE);
        std::env::set_var("CLIENT_IP_SOURCE", "cf-connecting-ip");
        std::env::set_var("RATE_LIMIT_STRICT_RPM", "2");
        std::env::set_var("RATE_LIMIT_AUTH_PER_MIN", "1");
        std::env::set_var("RATE_LIMIT_WRITE_PER_MIN", "2");
    });
    let state = backend::server::bootstrap().await.expect("bootstrap");
    backend::routes::build_router(state)
}

struct Reply {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: String,
}

struct Call<'a> {
    method: Method,
    uri: &'a str,
    peer: &'a str,
    headers: Vec<(&'a str, &'a str)>,
}

fn call<'a>(method: Method, uri: &'a str, peer: &'a str) -> Call<'a> {
    Call {
        method,
        uri,
        peer,
        headers: vec![("user-agent", BROWSER)],
    }
}

impl<'a> Call<'a> {
    fn header(mut self, name: &'a str, value: &'a str) -> Self {
        self.headers.retain(|(n, _)| *n != name);
        self.headers.push((name, value));
        self
    }

    async fn send(self, app: &axum::Router) -> Reply {
        let mut req = Request::builder().method(self.method).uri(self.uri);
        for (name, value) in &self.headers {
            req = req.header(*name, *value);
        }
        let mut req = req.body(Body::empty()).unwrap();
        req.extensions_mut().insert(ConnectInfo(SocketAddr::new(
            self.peer.parse().unwrap(),
            40_000,
        )));
        let resp = app.clone().oneshot(req).await.unwrap();
        let (parts, body) = resp.into_parts();
        let bytes = axum::body::to_bytes(body, 1 << 20).await.unwrap();
        Reply {
            status: parts.status,
            headers: parts.headers,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        }
    }
}

/// Statuses of `n` strict-class reads from one address.
async fn strict_reads(
    app: &axum::Router,
    peer: &str,
    cf_ip: Option<&str>,
    n: usize,
) -> Vec<StatusCode> {
    let mut out = Vec::new();
    for _ in 0..n {
        let mut c = call(Method::GET, "/api/recommendations", peer);
        if let Some(ip) = cf_ip {
            c = c.header("cf-connecting-ip", ip);
        }
        out.push(c.send(app).await.status);
    }
    out
}

#[tokio::test]
async fn behind_the_tunnel_each_visitor_has_a_bucket() {
    let app = boot().await;
    // Peer is cloudflared on loopback; the visitor is CF-Connecting-IP.
    let a = strict_reads(&app, "127.0.0.1", Some("14.160.0.1"), 3).await;
    assert_ne!(a[0], StatusCode::TOO_MANY_REQUESTS);
    assert_ne!(a[1], StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(a[2], StatusCode::TOO_MANY_REQUESTS);
    // Another visitor through the same tunnel is not throttled by the first.
    let b = strict_reads(&app, "127.0.0.1", Some("14.160.0.2"), 2).await;
    assert!(
        b.iter().all(|s| *s != StatusCode::TOO_MANY_REQUESTS),
        "{b:?}"
    );
    // The IPv6 loopback peer is the tunnel too.
    let c = strict_reads(&app, "::1", Some("14.160.0.3"), 2).await;
    assert!(
        c.iter().all(|s| *s != StatusCode::TOO_MANY_REQUESTS),
        "{c:?}"
    );
}

#[tokio::test]
async fn a_remote_peer_cannot_choose_its_bucket_with_a_forged_header() {
    let app = boot().await;
    let mut statuses = Vec::new();
    for ip in ["14.160.1.1", "14.160.1.2", "14.160.1.3"] {
        statuses.extend(strict_reads(&app, "203.0.113.9", Some(ip), 1).await);
    }
    assert_eq!(statuses[2], StatusCode::TOO_MANY_REQUESTS, "{statuses:?}");
    // `X-Forwarded-For` is no source in tunnel mode, even from loopback.
    let mut statuses = Vec::new();
    for ip in ["14.160.2.1", "14.160.2.2", "14.160.2.3"] {
        let reply = call(Method::GET, "/api/recommendations", "127.0.0.1")
            .header("x-forwarded-for", ip)
            .send(&app)
            .await;
        statuses.push(reply.status);
    }
    assert_eq!(statuses[2], StatusCode::TOO_MANY_REQUESTS, "{statuses:?}");
}

#[tokio::test]
async fn an_ipv6_visitor_is_limited_as_its_64() {
    let app = boot().await;
    let mut statuses = Vec::new();
    for ip in [
        "2001:db8:7:7::1",
        "2001:db8:7:7:abcd::2",
        "2001:db8:7:7::ffff",
    ] {
        statuses.extend(strict_reads(&app, "127.0.0.1", Some(ip), 1).await);
    }
    assert_eq!(statuses[2], StatusCode::TOO_MANY_REQUESTS, "{statuses:?}");
    let other = strict_reads(&app, "127.0.0.1", Some("2001:db8:7:8::1"), 1).await;
    assert_ne!(other[0], StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn a_429_is_a_json_envelope_with_retry_after_and_the_security_floor() {
    let app = boot().await;
    let replies = {
        let mut out = Vec::new();
        for _ in 0..3 {
            out.push(
                call(Method::GET, "/api/recommendations", "127.0.0.1")
                    .header("cf-connecting-ip", "14.160.3.1")
                    .send(&app)
                    .await,
            );
        }
        out
    };
    let limited = &replies[2];
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    let retry: u64 = limited.headers[header::RETRY_AFTER]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((1..=60).contains(&retry), "{retry}");
    assert_eq!(limited.headers[header::CACHE_CONTROL], "no-store");
    assert!(
        limited.body.contains("\"error\":\"too_many_requests\""),
        "{}",
        limited.body
    );
    assert!(limited.headers.contains_key("content-security-policy"));
    assert!(limited.headers.contains_key("permissions-policy"));
}

#[tokio::test]
async fn login_attempts_have_their_own_tighter_budget() {
    let app = boot().await;
    let attempt = || async {
        call(Method::POST, "/api/auth/login", "127.0.0.1")
            .header("cf-connecting-ip", "14.160.4.1")
            .header("origin", SITE)
            .header("content-type", "application/json")
            .send(&app)
            .await
    };
    let first = attempt().await;
    assert_ne!(first.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(attempt().await.status, StatusCode::TOO_MANY_REQUESTS);
}

/// Payment gateways and chat platforms: no browser UA, no Origin, and a
/// burst far above any per-IP budget. None of it is blocked or limited.
#[tokio::test]
async fn gateway_callbacks_and_webhooks_are_exempt_from_every_rule() {
    let app = boot().await;
    for (method, uri) in [
        (Method::POST, "/api/webhooks/telegram"),
        (Method::POST, "/api/webhooks/zalo"),
        (Method::POST, "/api/webhooks/messenger"),
        (Method::POST, "/api/webhooks/discord"),
        (Method::POST, "/api/payments/ipn/momo"),
        (Method::GET, "/api/payments/ipn/vnpay"),
    ] {
        for ua in ["curl/8.4.0", "Go-http-client/2.0"] {
            for _ in 0..6 {
                let reply = call(method.clone(), uri, "198.51.100.20")
                    .header("user-agent", ua)
                    .send(&app)
                    .await;
                assert_ne!(reply.status, StatusCode::TOO_MANY_REQUESTS, "{uri}");
                assert!(
                    !reply.body.contains("Access denied"),
                    "{uri}: {}",
                    reply.body
                );
            }
        }
    }
}

#[tokio::test]
async fn the_mobile_header_does_not_unlock_scraping_tools() {
    let app = boot().await;
    let scraper = call(Method::GET, "/api/brands", "127.0.0.1")
        .header("cf-connecting-ip", "14.160.5.1")
        .header("user-agent", "curl/8.4.0")
        .header("x-client", "mobile")
        .send(&app)
        .await;
    assert_eq!(scraper.status, StatusCode::FORBIDDEN);

    // The native app: no Origin on a write, an HTTP-library UA.
    let native = call(Method::POST, "/api/auth/refresh", "127.0.0.1")
        .header("cf-connecting-ip", "14.160.5.2")
        .header("user-agent", "Dart/3.5 (dart:io)")
        .header("x-client", "mobile")
        .send(&app)
        .await;
    assert!(!native.body.contains("Access denied"), "{}", native.body);

    // Without the header the same request is refused.
    let web = call(Method::POST, "/api/auth/refresh", "127.0.0.1")
        .header("cf-connecting-ip", "14.160.5.3")
        .send(&app)
        .await;
    assert_eq!(web.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn probes_and_crawler_files_are_never_limited() {
    let app = boot().await;
    for uri in ["/health", "/robots.txt", "/sitemap.xml"] {
        for _ in 0..6 {
            let reply = call(Method::GET, uri, "127.0.0.1")
                .header("cf-connecting-ip", "14.160.6.1")
                .send(&app)
                .await;
            assert_ne!(reply.status, StatusCode::TOO_MANY_REQUESTS, "{uri}");
        }
    }
}

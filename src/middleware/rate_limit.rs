//! Per-IP request limits, in classes.
//!
//! One token bucket per client address and class:
//!
//! | class    | what it limits                                                      | default       |
//! |----------|---------------------------------------------------------------------|---------------|
//! | `Read`   | every other `/api/*` request                                        | 600/min       |
//! | `Strict` | search fan-out, recommendations, auth, uploads, ads, vitals         | 100/min       |
//! | `Ws`     | WebSocket upgrades (`/ws`, `/ws-call`), apart from the HTTP budget  | 100/min       |
//! | `Auth`   | `POST` login, employee login, register, password change             | 10/min        |
//! | `Write`  | mutating `/api/*` requests (staff console and token refresh exempt) | 30/min        |
//!
//! A request is charged to its base class (`Read`, `Strict` or `Ws`) and, when
//! it is a credential attempt or a write, to `Auth` / `Write` as well.
//!
//! The client is the real address of [`super::real_client_ip`]; an IPv6 client
//! is one subscriber per `/64`, so it is limited as its `/64` (a per-address
//! key is trivially bypassed). Health probes, crawler files, payment-gateway
//! callbacks, chat-platform webhooks and media reads are never limited; a
//! request with no known peer (a unit-test harness) is not limited either.
//!
//! A 429 carries an honest `Retry-After`: the seconds until the bucket holds
//! a token again, never less than one (a `0` invites instant retry storms).

use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderValue, Method};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;

use crate::config::RateLimitConfig;
use crate::error::AppError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Read,
    Strict,
    Ws,
    Auth,
    Write,
}

/// Paths under the strict class: guessing, uploads, fan-out.
const STRICT_PREFIXES: [&str; 6] = [
    "/api/auth/",
    "/api/uploads/",
    "/api/search",
    "/api/recommendations",
    "/api/vitals",
    "/api/ads/",
];

/// Credential attempts: counted against the tight per-IP `Auth` budget.
const CREDENTIAL_PATHS: [&str; 4] = [
    "/api/auth/login",
    "/api/auth/employee-login",
    "/api/auth/register",
    "/api/auth/password",
];

/// Paths no limit ever blocks: uptime probes, crawler files, payment
/// gateways and chat platforms (they call with a signature, in bursts), and
/// immutable media reads.
fn is_exempt(path: &str) -> bool {
    matches!(
        path,
        "/health" | "/ready" | "/api/health" | "/sitemap.xml" | "/robots.txt"
    ) || path.starts_with("/api/payments/ipn/")
        || path.starts_with("/api/webhooks/")
        || path.starts_with("/api/media/")
}

/// Which buckets a request is charged to (at most two).
pub fn classify(method: &Method, path: &str, is_upgrade: bool) -> [Option<Class>; 2] {
    if is_exempt(path) {
        return [None, None];
    }
    if is_upgrade && matches!(path, "/ws" | "/ws-call") {
        return [Some(Class::Ws), None];
    }
    if !path.starts_with("/api/") {
        return [None, None];
    }
    let base = if STRICT_PREFIXES.iter().any(|p| path.starts_with(p)) {
        Class::Strict
    } else {
        Class::Read
    };
    let mutating = matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    let extra = if !mutating {
        None
    } else if CREDENTIAL_PATHS.contains(&path) {
        Some(Class::Auth)
    } else if path.starts_with("/api/auth/")
        || path.starts_with("/api/admin/")
        || path == "/api/vitals"
    {
        // Token refresh and logout run on their own; the staff console is
        // signed-in work; vitals is a beacon with its own strict class.
        None
    } else {
        Some(Class::Write)
    };
    [Some(base), extra]
}

/// The identity a client is limited as: an IPv4 address itself, an IPv6 one
/// as its `/64`, an IPv4-mapped IPv6 one as the IPv4 address.
pub fn limit_key(ip: IpAddr) -> IpAddr {
    match ip.to_canonical() {
        IpAddr::V6(v6) => {
            let prefix = u128::from(v6) & (u128::MAX << 64);
            IpAddr::V6(Ipv6Addr::from(prefix))
        }
        v4 => v4,
    }
}

struct Level {
    tokens: f64,
    at: Instant,
}

/// A keyed token bucket: `burst` tokens at most, `per_minute` refilled a minute.
struct Bucket {
    capacity: f64,
    per_second: f64,
    levels: DashMap<IpAddr, Level>,
    checks: AtomicU32,
}

/// Idle buckets are swept this often (in checks); a full bucket is the
/// default state of a key, so dropping it loses nothing.
const SWEEP_EVERY: u32 = 4096;

impl Bucket {
    fn new(per_minute: u32, burst: u32) -> Self {
        Self {
            capacity: f64::from(burst.max(1)),
            per_second: f64::from(per_minute.max(1)) / 60.0,
            levels: DashMap::new(),
            checks: AtomicU32::new(0),
        }
    }

    /// Takes a token for `key` at `now`; `Err(seconds)` is how long until one
    /// is available.
    fn take(&self, key: IpAddr, now: Instant) -> Result<(), u64> {
        if self.checks.fetch_add(1, Ordering::Relaxed) % SWEEP_EVERY == SWEEP_EVERY - 1 {
            self.sweep(now);
        }
        let mut level = self.levels.entry(key).or_insert(Level {
            tokens: self.capacity,
            at: now,
        });
        let refilled =
            level.tokens + now.saturating_duration_since(level.at).as_secs_f64() * self.per_second;
        level.tokens = refilled.min(self.capacity);
        level.at = now;
        if level.tokens >= 1.0 {
            level.tokens -= 1.0;
            Ok(())
        } else {
            // The epsilon keeps a wait of exactly N seconds from rounding up to N+1.
            let wait = ((1.0 - level.tokens) / self.per_second - 1e-6).ceil();
            Err((wait as u64).max(1))
        }
    }

    fn sweep(&self, now: Instant) {
        self.levels.retain(|_, level| {
            let idle = now.saturating_duration_since(level.at).as_secs_f64();
            level.tokens + idle * self.per_second < self.capacity
        });
    }
}

/// Every class's buckets.
pub struct RateLimits {
    read: Bucket,
    strict: Bucket,
    ws: Bucket,
    auth: Bucket,
    write: Bucket,
}

impl RateLimits {
    pub fn new(config: &RateLimitConfig) -> Self {
        Self {
            read: Bucket::new(config.rpm, config.burst),
            strict: Bucket::new(config.strict_rpm, config.strict_rpm),
            ws: Bucket::new(config.strict_rpm, config.strict_rpm),
            auth: Bucket::new(config.auth_per_min, config.auth_per_min),
            write: Bucket::new(config.write_per_min, config.write_per_min),
        }
    }

    fn bucket(&self, class: Class) -> &Bucket {
        match class {
            Class::Read => &self.read,
            Class::Strict => &self.strict,
            Class::Ws => &self.ws,
            Class::Auth => &self.auth,
            Class::Write => &self.write,
        }
    }

    /// Charges a request; `Err(seconds)` when one of its buckets is empty.
    fn charge(&self, classes: [Option<Class>; 2], key: IpAddr, now: Instant) -> Result<(), u64> {
        classes
            .into_iter()
            .flatten()
            .try_for_each(|class| self.bucket(class).take(key, now))
    }
}

/// Middleware: charges the request to its classes, or answers 429.
pub async fn rate_limit(
    State(limits): State<Arc<RateLimits>>,
    req: Request,
    next: Next,
) -> Response {
    let is_upgrade = req
        .headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("websocket"));
    let classes = classify(req.method(), req.uri().path(), is_upgrade);
    if classes[0].is_some() {
        if let Some(peer) = req.extensions().get::<ConnectInfo<SocketAddr>>() {
            let ip = super::real_client_ip(req.headers(), peer.0.ip());
            if let Err(wait) = limits.charge(classes, limit_key(ip), Instant::now()) {
                return too_many_requests(wait);
            }
        }
    }
    next.run(req).await
}

fn too_many_requests(wait_secs: u64) -> Response {
    let mut resp =
        AppError::TooManyRequests("please slow down and try again shortly".into()).into_response();
    let headers = resp.headers_mut();
    headers.insert(header::RETRY_AFTER, HeaderValue::from(wait_secs));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::body::Body;
    use axum::http::StatusCode;
    use axum::routing::any;
    use axum::Router;
    use tower::ServiceExt;

    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn classes(method: Method, path: &str, upgrade: bool) -> Vec<Class> {
        classify(&method, path, upgrade)
            .into_iter()
            .flatten()
            .collect()
    }

    #[test]
    fn every_class_covers_the_paths_the_worker_limits() {
        use Class::*;
        let get = |p| classes(Method::GET, p, false);
        assert_eq!(get("/api/brands"), [Read]);
        for strict in [
            "/api/search",
            "/api/search/trips",
            "/api/recommendations",
            "/api/auth/me",
            "/api/uploads/avatar",
            "/api/ads/conversions",
            "/api/vitals",
        ] {
            assert_eq!(get(strict), [Strict], "{strict}");
        }
        assert_eq!(classes(Method::GET, "/ws", true), [Ws]);
        assert_eq!(classes(Method::GET, "/ws-call", true), [Ws]);
        // Not an upgrade, or not a socket path: unlimited.
        assert!(classes(Method::GET, "/ws", false).is_empty());
        assert!(classes(Method::GET, "/", false).is_empty());
        assert!(classes(Method::GET, "/search", false).is_empty());
    }

    #[test]
    fn credential_attempts_and_writes_have_their_own_budgets() {
        use Class::*;
        let post = |p| classes(Method::POST, p, false);
        assert_eq!(post("/api/auth/login"), [Strict, Auth]);
        assert_eq!(post("/api/auth/register"), [Strict, Auth]);
        assert_eq!(post("/api/auth/employee-login"), [Strict, Auth]);
        assert_eq!(post("/api/auth/password"), [Strict, Auth]);
        assert_eq!(post("/api/auth/refresh"), [Strict]);
        assert_eq!(post("/api/auth/logout"), [Strict]);
        assert_eq!(post("/api/bookings"), [Read, Write]);
        assert_eq!(
            classes(Method::DELETE, "/api/push/devices/t", false),
            [Read, Write]
        );
        assert_eq!(post("/api/admin/brands"), [Read]);
        assert_eq!(post("/api/vitals"), [Strict]);
        assert_eq!(classes(Method::GET, "/api/auth/login", false), [Strict]);
    }

    #[test]
    fn probes_crawlers_gateways_webhooks_and_media_are_never_limited() {
        for path in [
            "/health",
            "/ready",
            "/api/health",
            "/sitemap.xml",
            "/robots.txt",
            "/api/payments/ipn/vnpay",
            "/api/webhooks/telegram",
            "/api/media/routes/a/b.webp",
        ] {
            for method in [Method::GET, Method::POST] {
                assert!(classes(method, path, false).is_empty(), "{path}");
            }
        }
    }

    #[test]
    fn ipv6_clients_are_limited_per_64_and_mapped_ipv4_as_ipv4() {
        assert_eq!(limit_key(ip("203.0.113.7")), ip("203.0.113.7"));
        assert_eq!(
            limit_key(ip("2001:db8:aa:bb:1:2:3:4")),
            limit_key(ip("2001:db8:aa:bb:ffff:0:0:1"))
        );
        assert_ne!(
            limit_key(ip("2001:db8:aa:bb::1")),
            limit_key(ip("2001:db8:aa:bc::1"))
        );
        assert_eq!(limit_key(ip("::ffff:203.0.113.7")), ip("203.0.113.7"));
    }

    #[test]
    fn a_bucket_spends_its_burst_then_refills_at_its_rate() {
        let bucket = Bucket::new(60, 3);
        let t0 = Instant::now();
        let a = ip("203.0.113.1");
        for _ in 0..3 {
            assert!(bucket.take(a, t0).is_ok());
        }
        // 60/min is one a second: the next is a second away.
        assert_eq!(bucket.take(a, t0), Err(1));
        assert!(bucket.take(a, t0 + Duration::from_millis(999)).is_err());
        assert!(bucket.take(a, t0 + Duration::from_millis(1100)).is_ok());
        // Another client has its own bucket.
        assert!(bucket.take(ip("203.0.113.2"), t0).is_ok());
    }

    #[test]
    fn a_slow_bucket_advertises_its_real_wait() {
        let bucket = Bucket::new(10, 10); // one token per 6 s
        let t0 = Instant::now();
        let a = ip("203.0.113.1");
        for _ in 0..10 {
            assert!(bucket.take(a, t0).is_ok());
        }
        assert_eq!(bucket.take(a, t0), Err(6));
        assert_eq!(bucket.take(a, t0 + Duration::from_secs(4)), Err(2));
    }

    #[test]
    fn idle_buckets_are_swept() {
        let bucket = Bucket::new(60, 2);
        let t0 = Instant::now();
        assert!(bucket.take(ip("203.0.113.1"), t0).is_ok());
        assert_eq!(bucket.levels.len(), 1);
        bucket.sweep(t0 + Duration::from_millis(500));
        assert_eq!(bucket.levels.len(), 1, "still short of a full bucket");
        bucket.sweep(t0 + Duration::from_secs(1));
        assert_eq!(bucket.levels.len(), 0);
    }

    fn app(config: &RateLimitConfig) -> Router {
        Router::new().route("/{*p}", any(|| async { "ok" })).layer(
            axum::middleware::from_fn_with_state(Arc::new(RateLimits::new(config)), rate_limit),
        )
    }

    async fn status(app: &Router, method: Method, path: &str, peer: Option<&str>) -> Response {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .body(Body::empty())
            .unwrap();
        if let Some(peer) = peer {
            req.extensions_mut()
                .insert(ConnectInfo(SocketAddr::new(ip(peer), 5000)));
        }
        app.clone().oneshot(req).await.unwrap()
    }

    fn tight() -> RateLimitConfig {
        RateLimitConfig {
            rpm: 600,
            burst: 20,
            strict_rpm: 2,
            auth_per_min: 1,
            write_per_min: 3,
        }
    }

    #[tokio::test]
    async fn the_middleware_answers_429_with_an_honest_retry_after() {
        let app = app(&tight());
        for _ in 0..2 {
            let resp = status(&app, Method::GET, "/api/search", Some("203.0.113.1")).await;
            assert_eq!(resp.status(), StatusCode::OK);
        }
        let resp = status(&app, Method::GET, "/api/search", Some("203.0.113.1")).await;
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        let retry: u64 = resp.headers()[header::RETRY_AFTER]
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        assert!((1..=30).contains(&retry), "{retry}");
        assert_eq!(resp.headers()[header::CACHE_CONTROL], "no-store");
        // Another client, and an unlimited path, are unaffected.
        let other = status(&app, Method::GET, "/api/search", Some("203.0.113.2")).await;
        assert_eq!(other.status(), StatusCode::OK);
        let page = status(&app, Method::GET, "/search", Some("203.0.113.1")).await;
        assert_eq!(page.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn logins_and_writes_hit_their_own_budget_first() {
        let app = app(&tight());
        let login = |peer| status(&app, Method::POST, "/api/auth/login", Some(peer));
        assert_eq!(login("203.0.113.1").await.status(), StatusCode::OK);
        assert_eq!(
            login("203.0.113.1").await.status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        for _ in 0..3 {
            let resp = status(&app, Method::POST, "/api/bookings", Some("203.0.113.3")).await;
            assert_eq!(resp.status(), StatusCode::OK);
        }
        let resp = status(&app, Method::POST, "/api/bookings", Some("203.0.113.3")).await;
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        // Reads stay open to a client whose write budget is spent.
        let read = status(&app, Method::GET, "/api/brands", Some("203.0.113.3")).await;
        assert_eq!(read.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn websocket_upgrades_do_not_spend_the_http_budget() {
        let app = app(&tight());
        let upgrade = |peer: &'static str| {
            let app = app.clone();
            async move {
                let mut req = Request::builder()
                    .uri("/ws")
                    .header(header::UPGRADE, "websocket")
                    .body(Body::empty())
                    .unwrap();
                req.extensions_mut()
                    .insert(ConnectInfo(SocketAddr::new(ip(peer), 5000)));
                app.oneshot(req).await.unwrap().status()
            }
        };
        assert_eq!(upgrade("203.0.113.1").await, StatusCode::OK);
        assert_eq!(upgrade("203.0.113.1").await, StatusCode::OK);
        assert_eq!(upgrade("203.0.113.1").await, StatusCode::TOO_MANY_REQUESTS);
        let http = status(&app, Method::GET, "/api/search", Some("203.0.113.1")).await;
        assert_eq!(http.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn a_request_with_no_known_peer_is_not_limited() {
        let app = app(&tight());
        for _ in 0..10 {
            let resp = status(&app, Method::GET, "/api/search", None).await;
            assert_eq!(resp.status(), StatusCode::OK);
        }
    }
}

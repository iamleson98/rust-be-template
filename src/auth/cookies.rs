use axum_extra::extract::cookie::{Cookie, CookieJar};
use chrono::Duration;

use crate::config::{CookieConfig, JwtConfig};

pub const ACCESS_COOKIE: &str = "access_token";
pub const REFRESH_COOKIE: &str = "refresh_token";

/// Helper: extract access + refresh tokens from cookies.
pub fn extract_tokens(jar: &CookieJar) -> (Option<String>, Option<String>) {
    let access = jar.get(ACCESS_COOKIE).map(|c| c.value().to_string());
    let refresh = jar.get(REFRESH_COOKIE).map(|c| c.value().to_string());
    (access, refresh)
}

/// Set the access + refresh HttpOnly cookies on the response. Caller
/// passes the actual token values; this function packages them. Returns
/// the new jar (jars in axum-extra are immutable, replaced on each op).
///
/// TTLs are read from `JwtConfig` (env-driven) so cookie lifetime and
/// JWT lifetime stay in sync — previously the cookies were always 15 min
/// and 7 days regardless of the configured JWT TTLs, which meant an
/// operator lowering `JWT_ACCESS_TTL_SECS=300` for testing would see the
/// browser keep sending a cookie that the server immediately rejected.
pub fn set_auth_cookies(
    jar: CookieJar,
    cookie_cfg: &CookieConfig,
    jwt_cfg: &JwtConfig,
    access: &str,
    refresh: &str,
) -> CookieJar {
    let access_ttl = Duration::seconds(jwt_cfg.access_ttl_secs as i64);
    let refresh_ttl = Duration::seconds(jwt_cfg.refresh_ttl_secs as i64);

    let access_cookie = build_cookie(ACCESS_COOKIE, access, cookie_cfg, access_ttl);
    let refresh_cookie = build_cookie(REFRESH_COOKIE, refresh, cookie_cfg, refresh_ttl);

    jar.add(access_cookie).add(refresh_cookie)
}

pub fn clear_auth_cookies(jar: CookieJar, cfg: &CookieConfig) -> CookieJar {
    let mut jar = jar;
    for name in [ACCESS_COOKIE, REFRESH_COOKIE] {
        let c = Cookie::build(name)
            .path("/")
            .max_age(time::Duration::seconds(0));
        jar = jar.remove(c.build());
    }
    let _ = cfg;
    jar
}

fn build_cookie(
    name: &'static str,
    value: &str,
    cfg: &CookieConfig,
    ttl: Duration,
) -> Cookie<'static> {
    let mut builder = Cookie::build((name, value.to_string()));
    builder = builder.path("/");
    builder = builder.http_only(true);
    builder = builder.same_site(cfg.samesite.as_axum());
    builder = builder.secure(cfg.secure);
    builder = builder.max_age(time::Duration::seconds(ttl.num_seconds()));
    // Only set the Domain attribute if explicitly configured.
    // An empty domain means "use the request's host" — the browser
    // scopes the cookie to the origin automatically. This is the
    // correct default for same-origin dev (Vite proxy) + production
    // (Rust serves both UI + API on the same origin).
    if !cfg.domain.is_empty() {
        builder = builder.domain(cfg.domain.clone());
    }
    builder.build()
}

use axum_extra::extract::cookie::{Cookie, CookieJar};
use chrono::Duration;

use crate::config::CookieConfig;

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
pub fn set_auth_cookies(
    jar: CookieJar,
    cfg: &CookieConfig,
    access: &str,
    refresh: &str,
) -> CookieJar {
    let access_ttl = Duration::minutes(15);
    let refresh_ttl = Duration::days(7);

    let access_cookie = build_cookie(ACCESS_COOKIE, access, cfg, access_ttl);
    let refresh_cookie = build_cookie(REFRESH_COOKIE, refresh, cfg, refresh_ttl);

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
    // Clone domain into a 'static String so the cookie can outlive cfg.
    builder = builder.domain(cfg.domain.clone());
    builder.build()
}

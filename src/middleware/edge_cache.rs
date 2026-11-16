//! Keeps what the edge may cache identical for everyone.
//!
//! A response marked `s-maxage` is stored by Cloudflare (or any shared cache)
//! and handed to every visitor, so two things must hold for it:
//!
//! * it sets no cookie (a stored `Set-Cookie` would sign visitors into one
//!   another's session): such a response is downgraded to `no-store`;
//! * it varies on nothing but the encoding, and carries no CORS grant. The
//!   CORS layer writes `Vary: Origin, ...` and `Access-Control-Allow-*` on
//!   everything; on a page that does not depend on the origin the first only
//!   splits it into copies and the second would let the cache hand one
//!   origin's grant to another.

use axum::extract::Request;
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

fn shared_cacheable(resp: &Response) -> bool {
    resp.headers()
        .get(header::CACHE_CONTROL)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("s-maxage"))
}

/// Middleware over the whole app, outside the CORS layer.
pub async fn edge_cache_guard(req: Request, next: Next) -> Response {
    let mut resp = next.run(req).await;
    if shared_cacheable(&resp) {
        if resp.headers().contains_key(header::SET_COOKIE) {
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        } else {
            let headers = resp.headers_mut();
            headers.insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));
            headers.remove(header::ACCESS_CONTROL_ALLOW_ORIGIN);
            headers.remove(header::ACCESS_CONTROL_ALLOW_CREDENTIALS);
        }
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    async fn reply(headers: &'static [(&'static str, &'static str)]) -> Response {
        let app = Router::new()
            .route(
                "/",
                get(move || async move {
                    let mut resp = Response::new(Body::empty());
                    for (name, value) in headers {
                        resp.headers_mut().append(
                            header::HeaderName::from_static(name),
                            value.parse().unwrap(),
                        );
                    }
                    resp
                }),
            )
            .layer(axum::middleware::from_fn(edge_cache_guard));
        app.oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a_cacheable_page_varies_on_the_encoding_alone() {
        let resp = reply(&[
            ("cache-control", "public, max-age=0, s-maxage=300"),
            ("vary", "origin"),
            ("access-control-allow-origin", "https://a.example"),
            ("access-control-allow-credentials", "true"),
        ])
        .await;
        assert_eq!(resp.headers()[header::VARY], "Accept-Encoding");
        assert!(resp
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert!(resp
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
            .is_none());
        assert_eq!(
            resp.headers()[header::CACHE_CONTROL],
            "public, max-age=0, s-maxage=300"
        );
    }

    #[tokio::test]
    async fn a_response_that_sets_a_cookie_is_never_stored() {
        let resp = reply(&[
            ("cache-control", "public, s-maxage=300"),
            ("set-cookie", "a=b"),
        ])
        .await;
        assert_eq!(resp.headers()[header::CACHE_CONTROL], "no-store");
    }

    #[tokio::test]
    async fn everything_else_is_left_alone() {
        let resp = reply(&[
            ("cache-control", "no-cache"),
            ("vary", "origin"),
            ("access-control-allow-origin", "https://a.example"),
        ])
        .await;
        assert_eq!(resp.headers()[header::VARY], "origin");
        assert!(resp
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_some());
        assert_eq!(resp.headers()[header::CACHE_CONTROL], "no-cache");
    }
}

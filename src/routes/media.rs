//! Media proxy — `GET /api/media/{key}`.
//!
//! Serves route pictures and brand logos from the configured storage backend
//! when `STORAGE_PUBLIC_BASE_URL` is NOT set (dev / local-storage
//! mode, or as an origin fallback). In production with a CDN origin
//! configured, image traffic flows Cloudflare → Caddy → RustFS and
//! never touches the backend — this router simply stops being hit.
//!
//! ## Caching contract (same as the CDN path)
//!
//! Objects are content-addressed, so the response is immutable:
//! `Cache-Control: public, max-age=31536000, immutable` + a strong
//! ETag derived from the key's hash. `If-None-Match` is answered 304
//! WITHOUT touching storage — the ETag is computable from the key
//! alone.
//!
//! ## Uploads are served from the app's own origin
//!
//! Every response carries `X-Content-Type-Options: nosniff` and a
//! `Content-Security-Policy` that sandboxes the document: an SVG logo
//! opened directly in the browser cannot run script or load anything.
//! (The site-wide CSP is set by the edge middleware; this header is the
//! per-route one for stored uploads.)
//!
//! ## Mounting
//!
//! Mounted at the app root (NOT inside the rate-limited `/api` nest):
//! a route-detail page fans out one request per picture, and image
//! GETs are cheap cacheable static reads — they must not burn
//! rate-limit tokens needed by API traffic.

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;

use crate::error::AppError;
use crate::service::route_media_service::{parse_media_key, IMMUTABLE_CACHE_CONTROL};
use crate::state::AppState;

/// Sandbox for stored uploads (see the module docs).
const UPLOAD_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/// `GET /api/media/{*key}` — serve one media object.
#[utoipa::path(
    get,
    path = "/api/media/{key}",
    tag = "media",
    params(("key" = String, Path, description = "Storage key: routes/{routeId}/{hash16}.{ext}, routes/{routeId}/t{hash16}.{ext} or brands/logos/{hash16}.{ext}")),
    responses(
        (status = 200, description = "Image bytes (immutable, ETag-cached)"),
        (status = 304, description = "Not modified (If-None-Match hit)"),
        (status = 404, description = "Unknown or malformed key"),
    )
)]
pub async fn serve(
    State(st): State<AppState>,
    Path(key): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    // 1. Strict key-shape gate: reject anything that isn't a key WE
    //    generated (path traversal, foreign prefixes, junk) with a
    //    plain 404 — no storage round-trip, no 500s.
    let Some(parsed) = parse_media_key(&key) else {
        return Ok(not_found());
    };
    let etag = parsed.etag();

    // 2. Conditional request: an `If-None-Match` hit is answered
    //    without touching storage — the ETag IS the key's hash.
    if let Some(inm) = headers.get(header::IF_NONE_MATCH) {
        if let Ok(v) = inm.to_str() {
            let hit = v
                .split(',')
                .map(|t| t.trim().trim_start_matches("W/"))
                .any(|t| t == etag || t == "*");
            if hit {
                let mut resp = Response::new(Body::empty());
                *resp.status_mut() = StatusCode::NOT_MODIFIED;
                resp.headers_mut()
                    .insert(header::ETAG, etag.parse().unwrap());
                add_upload_headers(resp.headers_mut());
                return Ok(resp);
            }
        }
    }

    // 3. Fetch + serve with the immutable-cache headers.
    match st.media.serve(&key).await {
        Ok(m) => {
            let mut resp = Response::new(Body::from(m.bytes));
            resp.headers_mut()
                .insert(header::CONTENT_TYPE, m.content_type.parse().unwrap());
            resp.headers_mut()
                .insert(header::ETAG, m.etag.parse().unwrap());
            add_upload_headers(resp.headers_mut());
            Ok(resp)
        }
        // Storage miss on a well-formed key (deleted or never existed)
        // → 404, not 500.
        Err(AppError::NotFound(_)) => Ok(not_found()),
        Err(e) => Err(e),
    }
}

/// The headers every served (or revalidated) upload carries.
fn add_upload_headers(headers: &mut HeaderMap) {
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(IMMUTABLE_CACHE_CONTROL),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(UPLOAD_CSP),
    );
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "media not found").into_response()
}

/// Build the media router. Mounted OUTSIDE the rate-limited `/api`
/// nest (see the module docs).
pub fn router() -> Router<AppState> {
    Router::new().route("/{*key}", get(serve))
}

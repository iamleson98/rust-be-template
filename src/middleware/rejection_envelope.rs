//! Extractor rejections inside the `{error, message}` envelope.
//!
//! axum answers a `Query`, `Path` or `Json` that cannot be read with a
//! `text/plain` body (`400 Failed to deserialize query string: ...`, `422`
//! for JSON of the wrong shape, `415` without a JSON content type). The
//! Worker answers every such request with the envelope and a 400, so this
//! layer rewrites the plain-text rejections of the API the same way:
//!
//! * a body that is not JSON at all (or no JSON content type) is a
//!   `bad_request`;
//! * a query string, path or JSON shape that does not fit is a
//!   `validation_error`.
//!
//! Handlers never answer plain text on these statuses themselves (their
//! errors are `AppError`s, which are JSON), so every plain-text 400, 415 or
//! 422 here is an extractor's.

use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::AppError;

/// A rejection's message is a sentence; anything longer is not one of ours.
const MAX_REJECTION_BYTES: usize = 4096;

/// Beginnings of axum's JSON rejections that are about the bytes (or the
/// content type), not about the shape of a well-formed document.
const NOT_JSON_PREFIXES: [&str; 4] = [
    "Failed to parse the request body as JSON",
    "Failed to buffer the request body",
    "Expected request with `Content-Type: application/json`",
    "Failed to read the request body",
];

pub async fn rejection_envelope(req: Request, next: Next) -> Response {
    let resp = next.run(req).await;
    let status = resp.status();
    let is_rejection = matches!(
        status,
        StatusCode::BAD_REQUEST
            | StatusCode::UNSUPPORTED_MEDIA_TYPE
            | StatusCode::UNPROCESSABLE_ENTITY
    ) && resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/plain"));
    if !is_rejection {
        return resp;
    }
    let bytes = match axum::body::to_bytes(resp.into_body(), MAX_REJECTION_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => return AppError::BadRequest("invalid request".into()).into_response(),
    };
    let text = String::from_utf8_lossy(&bytes).into_owned();
    envelope(status, text)
}

fn envelope(status: StatusCode, text: String) -> Response {
    let not_json = status == StatusCode::UNSUPPORTED_MEDIA_TYPE
        || NOT_JSON_PREFIXES.iter().any(|p| text.starts_with(p));
    if not_json {
        AppError::BadRequest(text).into_response()
    } else {
        AppError::Validation(text).into_response()
    }
}

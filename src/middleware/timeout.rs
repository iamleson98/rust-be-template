use std::time::Duration;

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use tokio::time::timeout;
use tracing::Instrument;

/// Per-request timeout. Returns 408 if the handler doesn't respond within
/// `duration`. Use sparingly — prefer per-layer timeouts (DB, cache) where
/// possible, but this is the catch-all to prevent slowloris-style hangs.
pub async fn request_timeout(req: Request, next: Next, duration: Duration) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    let span = tracing::info_span!("request", %method, %path);

    async move {
        match timeout(duration, next.run(req)).await {
            Ok(resp) => resp,
            Err(_) => {
                tracing::warn!(%method, %path, "request timed out");
                let mut resp = Response::new(axum::body::Body::empty());
                *resp.status_mut() = axum::http::StatusCode::REQUEST_TIMEOUT;
                resp
            }
        }
    }
    .instrument(span)
    .await
}

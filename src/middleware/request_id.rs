
use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use tracing::Instrument;
use uuid::Uuid;

/// Per-request id, generated as UUIDv4 and attached as both a response
/// header (`X-Request-Id`) and a request extension. Also set as a field
/// on the tracing span so every log line for this request includes it.
#[derive(Clone, Copy, Debug)]
pub struct RequestId(pub Uuid);

impl std::fmt::Display for RequestId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

pub async fn request_id_layer(mut req: Request, next: Next) -> Response {
    // Allow clients to pass their own request id; generate one if missing.
    let id = req
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .map(RequestId)
        .unwrap_or_else(|| RequestId(Uuid::new_v4()));

    req.extensions_mut().insert(id);

    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let request_id_str = id.to_string();

    let span = tracing::info_span!(
        "request",
        %method,
        %path,
        request_id = %request_id_str,
    );

    // Run the inner service inside the span so all log lines from the
    // handler carry the request_id.
    let mut resp = next.run(req).instrument(span).await;

    // Echo the request id back so clients can correlate.
    if let Ok(val) = request_id_str.parse() {
        resp.headers_mut().insert("x-request-id", val);
    }
    resp
}

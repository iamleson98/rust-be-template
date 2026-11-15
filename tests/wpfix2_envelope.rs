//! Rejections of the extractors answer inside the `{error, message}` envelope
//! (as the Worker does), and the public review reads carry the one-minute
//! public cache (`no-store` for a signed-in caller).

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const ORIGIN: &str = "https://wpfix2.test";
const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
    (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async fn app() -> axum::Router {
    let _ = dotenvy::dotenv();
    std::env::set_var("DATABASE_URL", "sqlite::memory:");
    std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
    std::env::set_var("CORS_ORIGINS", ORIGIN);
    std::env::set_var("COOKIE_SECURE", "false");
    std::env::set_var("CACHE_BACKEND", "moka");
    std::env::set_var("WORKER_BACKEND", "db");
    std::env::set_var("SCHEDULER_ENABLED", "false");
    std::env::set_var("AUDIO_CALL_ENABLED", "false");
    std::env::set_var("NULLCLAW_ENABLED", "false");
    std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
    std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
    let empty = std::env::temp_dir().join(format!("wpfix2-places-{}", uuid::Uuid::new_v4()));
    std::env::set_var("PLACES_DIR", empty);
    let state = backend::server::bootstrap().await.expect("bootstrap");
    backend::routes::build_router(state)
}

struct Reply {
    status: StatusCode,
    cache_control: Option<String>,
    body: Value,
    content_type: String,
}

async fn send(app: &axum::Router, request: Request<Body>) -> Reply {
    let response = app.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let header_of = |name| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let cache_control = header_of(header::CACHE_CONTROL);
    let content_type = header_of(header::CONTENT_TYPE).unwrap_or_default();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        cache_control,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        content_type,
    }
}

fn get(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .uri(uri)
        .header(header::USER_AGENT, BROWSER_UA)
        .header(header::ORIGIN, ORIGIN);
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    request.body(Body::empty()).unwrap()
}

fn post(uri: &str, content_type: Option<&str>, body: &str) -> Request<Body> {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::USER_AGENT, BROWSER_UA)
        .header(header::ORIGIN, ORIGIN);
    if let Some(content_type) = content_type {
        request = request.header(header::CONTENT_TYPE, content_type);
    }
    request.body(Body::from(body.to_owned())).unwrap()
}

fn assert_envelope(reply: &Reply, status: StatusCode, kind: &str, message_start: &str) {
    assert!(
        reply.content_type.starts_with("application/json"),
        "{}",
        reply.content_type
    );
    assert_eq!(reply.status, status, "{:?}", reply.body);
    assert_eq!(reply.body["error"], kind, "{:?}", reply.body);
    let message = reply.body["message"].as_str().unwrap_or_default();
    assert!(message.starts_with(message_start), "message: {message}");
}

#[tokio::test]
async fn rejections_answer_inside_the_error_envelope_and_reviews_are_cached() {
    let app = app().await;

    // Query string that does not fit.
    let reply = send(&app, get("/api/places?limit=lots", None)).await;
    assert_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "validation_error",
        "validation failed: Failed to deserialize query string",
    );
    let reply = send(&app, get("/api/places/reverse?lat=21", None)).await;
    assert_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "validation_error",
        "validation failed: Failed to deserialize query string",
    );

    // Path segment that is not a UUID.
    let reply = send(&app, get("/api/reviews/not-a-uuid", None)).await;
    assert_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "validation_error",
        "validation failed: Invalid URL",
    );

    // JSON of the wrong shape, not JSON, and no JSON content type.
    let login = "/api/auth/login";
    let reply = send(&app, post(login, Some("application/json"), "{}")).await;
    assert_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "validation_error",
        "validation failed: Failed to deserialize the JSON body",
    );
    let reply = send(&app, post(login, Some("application/json"), "{")).await;
    assert_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "bad_request",
        "bad request: Failed to parse the request body as JSON",
    );
    let body = json!({ "email": "a@b.co", "password": "x" }).to_string();
    let reply = send(&app, post(login, None, &body)).await;
    assert_envelope(
        &reply,
        StatusCode::BAD_REQUEST,
        "bad_request",
        "bad request: Expected request with `Content-Type: application/json`",
    );

    // The public review reads: a minute of cache, none for a signed-in caller.
    let stats = format!("/api/reviews/stats?brand_id={}", uuid::Uuid::new_v4());
    for uri in ["/api/reviews", stats.as_str(), "/api/reviews/tags"] {
        let reply = send(&app, get(uri, None)).await;
        assert_eq!(reply.status, StatusCode::OK, "{uri}");
        assert_eq!(
            reply.cache_control.as_deref(),
            Some("public, max-age=60"),
            "{uri}"
        );
        let reply = send(&app, get(uri, Some("access_token=abc"))).await;
        assert_eq!(reply.cache_control.as_deref(), Some("no-store"), "{uri}");
    }
}

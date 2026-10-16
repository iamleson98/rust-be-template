//! Honest `Retry-After` on 429 responses (load-test finding, 2026-10-15).
//!
//! tower_governor derives the advertised wait from the token-bucket
//! refill interval: with `RATE_LIMIT_RPM=6000` the interval is 10 ms, so
//! the computed wait truncates to zero — production 429s answered
//! `Retry-After: 0` / `x-ratelimit-after: 0` with the body
//! `Too Many Requests! Wait for 0s`. A client that honors `Retry-After`
//! (fetch retry wrappers, SDKs, our own future retries) would re-fire
//! IMMEDIATELY — the exact retry storm the header exists to prevent.
//!
//! This middleware clamps every 429's advertised delay to at least
//! [`MIN_RETRY_AFTER_SECS`] seconds (1 s ≈ 100 refilled tokens at
//! 6000 RPM — a full page's worth of API calls), rewrites the governor's
//! plaintext verdict to match, and leaves every other response — and
//! every non-numeric (HTTP-date) `Retry-After` — untouched.
//!
//! The verdict rewrite is gated on the body's EXACT shape (`Too Many
//! Requests! Wait for <digits>s`), NOT on `Content-Type`: tower_governor
//! 0.7 REPLACES the response's entire header map with just
//! `{x-ratelimit-after, retry-after}` — verified live (v0.9.6 deploy):
//! the 429 reaches this layer with NO content-type (it is added further
//! downstream), so a content-type gate would never fire. A JSON error
//! body can never match the verdict shape, so app-level 429s pass
//! through byte-for-byte.
//!
//! Layer position: applied just OUTSIDE the governor layer in
//! `routes/router.rs`, so every 429 it emits passes through here on the
//! way out; handler-produced 429s (same nest) get the same treatment,
//! which is equally correct — no 429 should ever invite an instant retry.

use axum::extract::Request;
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

/// Smallest wait (seconds) any 429 advertises.
pub const MIN_RETRY_AFTER_SECS: u64 = 1;

/// tower_governor's verdict body: `Too Many Requests! Wait for {n}s`.
const VERDICT_PREFIX: &str = "Too Many Requests! Wait for ";
const VERDICT_SUFFIX: &str = "s";

/// Only verdict-sized bodies are ever inspected — larger 429s (JSON
/// errors are a few hundred bytes) pass through; a body bigger than
/// this cannot be the governor's 30-byte verdict.
const MAX_INSPECTED_BODY_BYTES: usize = 8192;

/// Clamp a numeric delay-seconds value up to the floor. `None` when the
/// value is absent or not delay-seconds (an HTTP-date) — leave those be.
fn clamped(raw: Option<&HeaderValue>) -> Option<u64> {
    raw.and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|n| n.max(MIN_RETRY_AFTER_SECS))
}

/// Rewrite the governor's verdict text to the clamped wait. `None`
/// unless the body is exactly the known verdict shape — anything else
/// (another plaintext 429) is preserved verbatim.
fn rewritten_verdict(body: &str, wait: u64) -> Option<String> {
    let seconds = body
        .strip_prefix(VERDICT_PREFIX)?
        .strip_suffix(VERDICT_SUFFIX)?;
    if seconds.is_empty() || !seconds.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(format!("{VERDICT_PREFIX}{wait}{VERDICT_SUFFIX}"))
}

/// Middleware entry point (see module docs).
pub async fn clamp_retry_after(req: Request, next: Next) -> Response {
    polish_429(next.run(req).await).await
}

async fn polish_429(mut resp: Response) -> Response {
    if resp.status() != StatusCode::TOO_MANY_REQUESTS {
        return resp;
    }

    // `retry-after`: absent → advertise the floor; numeric → clamp up;
    // HTTP-date → leave untouched (still an honest value, and the body
    // rewrite is skipped so a non-governor 429 keeps its wording).
    let advertised = match resp.headers().get(header::RETRY_AFTER) {
        Some(raw) => clamped(Some(raw)),
        None => Some(MIN_RETRY_AFTER_SECS),
    };
    if let Some(wait) = advertised {
        if let Ok(v) = HeaderValue::from_str(&wait.to_string()) {
            resp.headers_mut().insert(header::RETRY_AFTER, v);
        }
    }

    // tower_governor's companion header — same clamp when numeric.
    if let Some(parsed) = resp
        .headers()
        .get("x-ratelimit-after")
        .and_then(|raw| raw.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
    {
        let clamped_value = parsed.max(MIN_RETRY_AFTER_SECS);
        if clamped_value != parsed {
            if let Ok(v) = HeaderValue::from_str(&clamped_value.to_string()) {
                resp.headers_mut().insert("x-ratelimit-after", v);
            }
        }
    }

    let Some(wait) = advertised else {
        return resp; // HTTP-date Retry-After: headers were left honest
    };

    // The verdict rewrite is gated on the body's shape, not on
    // `Content-Type` (the governor's 429 carries none at this point —
    // see module docs). `rewritten_verdict` only matches the exact
    // verdict text, so JSON / app-level 429 bodies fall through the
    // match below and are re-emitted verbatim.
    let (mut parts, body) = resp.into_parts();
    let out: Vec<u8> = match axum::body::to_bytes(body, MAX_INSPECTED_BODY_BYTES).await {
        Ok(bytes) => match rewritten_verdict(&String::from_utf8_lossy(&bytes), wait) {
            Some(text) => text.into_bytes(),
            None => bytes.to_vec(), // not the governor's wording — keep it
        },
        // A 429 body larger than the inspection budget cannot be the
        // verdict; the stream is already consumed, so answer with the
        // canonical verdict text (headers stay clamped).
        Err(_) => format!("{VERDICT_PREFIX}{wait}{VERDICT_SUFFIX}").into_bytes(),
    };
    if let Ok(len) = HeaderValue::from_str(&out.len().to_string()) {
        parts.headers.insert(header::CONTENT_LENGTH, len);
    }
    Response::from_parts(parts, axum::body::Body::from(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    /// Push a synthetic 429/200 through the middleware and return the
    /// final response.
    async fn through(
        status: StatusCode,
        headers: &[(&'static str, &'static str)],
        body: &'static str,
    ) -> Response {
        let headers = headers.to_vec();
        let app = Router::new()
            .route(
                "/api/x",
                get(move || async move {
                    let mut builder = axum::http::Response::builder().status(status);
                    for (k, v) in &headers {
                        builder = builder.header(*k, *v);
                    }
                    builder.body(Body::from(body)).unwrap()
                }),
            )
            .layer(axum::middleware::from_fn(clamp_retry_after));
        app.oneshot(
            axum::http::Request::builder()
                .uri("/api/x")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
    }

    async fn body_text(resp: Response) -> String {
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// The exact production shape observed in the load test: both wait
    /// headers at 0 and the verdict body "Wait for 0s" (tower_governor
    /// answers `text/plain; charset=utf-8`).
    #[tokio::test]
    async fn zero_waits_are_clamped_to_one() {
        let resp = through(
            StatusCode::TOO_MANY_REQUESTS,
            &[
                ("content-type", "text/plain; charset=utf-8"),
                ("retry-after", "0"),
                ("x-ratelimit-after", "0"),
            ],
            "Too Many Requests! Wait for 0s",
        )
        .await;
        assert_eq!(resp.headers()["retry-after"], "1");
        assert_eq!(resp.headers()["x-ratelimit-after"], "1");
        assert_eq!(body_text(resp).await, "Too Many Requests! Wait for 1s");
    }

    /// The EXACT production shape from the v0.9.6 deploy: tower_governor
    /// 0.7 REPLACES the response's header map, so the 429 reaches this
    /// layer with NO content-type — the rewrite must not depend on it.
    #[tokio::test]
    async fn production_shape_without_content_type_is_fixed() {
        let resp = through(
            StatusCode::TOO_MANY_REQUESTS,
            &[("retry-after", "0"), ("x-ratelimit-after", "0")],
            "Too Many Requests! Wait for 0s",
        )
        .await;
        assert!(!resp.headers().contains_key(header::CONTENT_TYPE));
        assert_eq!(resp.headers()["retry-after"], "1");
        assert_eq!(resp.headers()["x-ratelimit-after"], "1");
        assert_eq!(body_text(resp).await, "Too Many Requests! Wait for 1s");
    }

    /// End-to-end with the REAL tower_governor layer: the clamp sees the
    /// governor's own 429 (header map replaced, no content-type) and
    /// fixes both the wait headers and the verdict body.
    #[tokio::test]
    async fn real_governor_429_is_fixed_end_to_end() {
        use tower_governor::governor::GovernorConfigBuilder;
        use tower_governor::key_extractor::KeyExtractor;
        use tower_governor::{GovernorError, GovernorLayer};

        #[derive(Clone, Copy)]
        struct ConstKey;
        impl KeyExtractor for ConstKey {
            type Key = u64;
            fn extract<T>(
                &self,
                _req: &axum::http::Request<T>,
            ) -> Result<Self::Key, GovernorError> {
                Ok(1)
            }
        }

        // Production-like refill (RATE_LIMIT_RPM=6000 → 10 ms interval):
        // the computed wait truncates to 0 — the bug this middleware fixes.
        let conf = std::sync::Arc::new(
            GovernorConfigBuilder::default()
                .key_extractor(ConstKey)
                .per_millisecond(10)
                .burst_size(2)
                .finish()
                .unwrap(),
        );
        let app = Router::new()
            .route("/api/x", get(|| async { "ok" }))
            .layer(GovernorLayer { config: conf })
            .layer(axum::middleware::from_fn(clamp_retry_after));

        let mut saw_429 = false;
        for i in 0..6 {
            let resp = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .uri("/api/x")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            if resp.status() == StatusCode::TOO_MANY_REQUESTS {
                saw_429 = true;
                assert!(
                    !resp.headers().contains_key(header::CONTENT_TYPE),
                    "governor 0.7 replaces the header map — no content-type here"
                );
                assert_eq!(resp.headers()["retry-after"], "1", "request #{i}");
                assert_eq!(resp.headers()["x-ratelimit-after"], "1", "request #{i}");
                assert_eq!(
                    body_text(resp).await,
                    "Too Many Requests! Wait for 1s",
                    "request #{i}"
                );
            }
        }
        assert!(saw_429, "governor never rate-limited 6 requests (burst 2)");
    }

    #[tokio::test]
    async fn missing_retry_after_gets_the_floor() {
        let resp = through(StatusCode::TOO_MANY_REQUESTS, &[], "busy").await;
        assert_eq!(resp.headers()["retry-after"], "1");
        assert_eq!(body_text(resp).await, "busy"); // not a verdict — verbatim
    }

    #[tokio::test]
    async fn honest_waits_pass_through() {
        let resp = through(
            StatusCode::TOO_MANY_REQUESTS,
            &[("retry-after", "30"), ("x-ratelimit-after", "30")],
            "Too Many Requests! Wait for 30s",
        )
        .await;
        assert_eq!(resp.headers()["retry-after"], "30");
        assert_eq!(resp.headers()["x-ratelimit-after"], "30");
        assert_eq!(body_text(resp).await, "Too Many Requests! Wait for 30s");
    }

    /// HTTP-date form is a valid Retry-After: untouched, and the body
    /// rewrite is skipped so the wording stays the producer's own.
    #[tokio::test]
    async fn http_date_retry_after_is_left_alone() {
        let resp = through(
            StatusCode::TOO_MANY_REQUESTS,
            &[("retry-after", "Wed, 21 Oct 2026 07:28:00 GMT")],
            "Too Many Requests! Wait for 0s",
        )
        .await;
        assert_eq!(
            resp.headers()["retry-after"],
            "Wed, 21 Oct 2026 07:28:00 GMT"
        );
        assert_eq!(body_text(resp).await, "Too Many Requests! Wait for 0s");
    }

    #[tokio::test]
    async fn non_429_responses_are_untouched() {
        let resp = through(StatusCode::OK, &[], "{}").await;
        assert!(!resp.headers().contains_key("retry-after"));
        assert_eq!(body_text(resp).await, "{}");
    }

    /// App-level (JSON) 429s keep their body byte-for-byte while the
    /// headers still get the honest floor.
    #[tokio::test]
    async fn json_429_body_is_preserved() {
        let payload = r#"{"error":"hold_limit","retryInMs":900}"#;
        let resp = through(
            StatusCode::TOO_MANY_REQUESTS,
            &[("content-type", "application/json"), ("retry-after", "0")],
            payload,
        )
        .await;
        assert_eq!(resp.headers()["retry-after"], "1");
        assert_eq!(body_text(resp).await, payload);
    }

    /// The rewritten verdict carries a matching Content-Length.
    #[tokio::test]
    async fn rewritten_verdict_updates_content_length() {
        let resp = through(
            StatusCode::TOO_MANY_REQUESTS,
            &[
                ("content-type", "text/plain; charset=utf-8"),
                ("retry-after", "0"),
            ],
            "Too Many Requests! Wait for 0s",
        )
        .await;
        let expected = "Too Many Requests! Wait for 1s";
        let len: usize = resp.headers()[header::CONTENT_LENGTH]
            .to_str()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(len, expected.len());
        assert_eq!(body_text(resp).await, expected);
    }

    #[test]
    fn verdict_detection_is_strict() {
        assert_eq!(
            rewritten_verdict("Too Many Requests! Wait for 0s", 1).as_deref(),
            Some("Too Many Requests! Wait for 1s")
        );
        // Not the governor's wording, or malformed numbers — never rewritten.
        for body in [
            "Too Many Requests! Wait for s",
            "Too Many Requests! Wait for -1s",
            "Too Many Requests! Wait for 0 s",
            "Too Many Requests! Wait for 0sec",
            "Slow down",
            "",
        ] {
            assert_eq!(rewritten_verdict(body, 1), None, "{body:?}");
        }
    }
}

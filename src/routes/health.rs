use std::time::Duration;

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
use tokio::time::timeout;
use utoipa::ToSchema;

use crate::error::AppResult;
use crate::state::AppState;

/// What this binary is: the release tag it was built from (CI sets
/// `RELEASE_TAG` for a tag build, so `/ready` reports `v1.2.3` once that
/// release is live) or `dev-<crate version>` for any other build.
pub const BUILD_VERSION: &str = match option_env!("RELEASE_TAG") {
    Some(tag) => tag,
    None => concat!("dev-", env!("CARGO_PKG_VERSION")),
};

/// The commit a release build was made from (`RELEASE_COMMIT`, set by CI).
const BUILD_COMMIT: Option<&str> = option_env!("RELEASE_COMMIT");

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: String,
    /// The release tag (`v1.2.3`), or `dev-<crate version>` for a local build.
    pub version: String,
    /// The commit of a release build; absent for a local build.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
}

impl HealthResponse {
    fn new(status: &str) -> Self {
        Self {
            status: status.into(),
            version: BUILD_VERSION.into(),
            commit: BUILD_COMMIT.map(Into::into),
        }
    }
}

/// Probes answer fresh every time: a deploy check (and any proxy in front)
/// must never see a stale version.
const NO_STORE: [(header::HeaderName, &str); 1] = [(header::CACHE_CONTROL, "no-store")];

/// `GET /health` — liveness probe. Always returns 200 (process is up).
#[utoipa::path(
    get,
    path = "/health",
    tag = "system",
    responses((status = 200, description = "Service is alive", body = HealthResponse))
)]
pub async fn health() -> AppResult<impl IntoResponse> {
    Ok((NO_STORE, Json(HealthResponse::new("ok"))))
}

/// `GET /ready` — readiness probe. Actually pings the DB.
/// Returns 503 if the DB is unreachable so load balancers won't route here.
#[utoipa::path(
    get,
    path = "/ready",
    tag = "system",
    responses(
        (status = 200, description = "Service is ready", body = HealthResponse),
        (status = 503, description = "Service is not ready", body = HealthResponse)
    )
)]
pub async fn ready(State(state): State<AppState>) -> AppResult<impl IntoResponse> {
    let db_ok = ping_db(&state).await;
    let code = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    let body = HealthResponse::new(if db_ok { "ok" } else { "degraded" });

    Ok((code, NO_STORE, Json(body)))
}

/// Ping the database over the DEDICATED health pool with a short
/// deadline. Returns false if it fails within 1.5 s.
///
/// The health pool's acquire queue is separate from the main request
/// pool (see `server::bootstrap`), so a burst of long searches or an
/// admin `VACUUM INTO` probe can hold every request connection without
/// failing readiness — the failure mode that used to flip `/ready` to
/// 503 and sit one monitor window away from a swarm rollback
/// (issue #75). The ping itself still executes on the same shared
/// engine, so a genuinely wedged engine (or file) keeps failing
/// readiness exactly as before.
async fn ping_db(state: &AppState) -> bool {
    let ping = async { state.health_db.ping().await };

    match timeout(Duration::from_millis(1500), ping).await {
        Ok(Ok(())) => true,
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "db ping failed (health lane)");
            false
        }
        Err(_) => {
            tracing::warn!("db ping timed out after 1.5s (health lane)");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_local_build_reports_dev_and_the_crate_version() {
        // CI's test job runs without RELEASE_TAG; only a tag build sets it.
        if option_env!("RELEASE_TAG").is_none() {
            assert_eq!(BUILD_VERSION, concat!("dev-", env!("CARGO_PKG_VERSION")));
            assert!(HealthResponse::new("ok").commit.is_none());
        }
    }

    #[test]
    fn commit_is_left_out_of_the_json_when_unknown() {
        let json = serde_json::to_value(HealthResponse {
            status: "ok".into(),
            version: "v1.2.3".into(),
            commit: None,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"status": "ok", "version": "v1.2.3"})
        );
    }
}

use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
use tokio::time::timeout;
use utoipa::ToSchema;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

/// `GET /health` — liveness probe. Always returns 200 (process is up).
#[utoipa::path(
    get,
    path = "/health",
    tag = "system",
    responses((status = 200, description = "Service is alive", body = HealthResponse))
)]
pub async fn health() -> AppResult<Json<HealthResponse>> {
    Ok(Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }))
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
    let status = if db_ok { "ok" } else { "degraded" };
    let code = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    let body = HealthResponse {
        status: status.into(),
        version: env!("CARGO_PKG_VERSION").into(),
    };

    Ok((code, Json(body)))
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

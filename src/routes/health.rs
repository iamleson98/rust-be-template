use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
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

/// Ping the database with a trivial query. Returns false if it fails
/// within the timeout (5s) — the connection is probably dead.
async fn ping_db(state: &AppState) -> bool {
    use sea_orm::ConnectionTrait;
    use std::time::Duration;
    use tokio::time::timeout;

    let db = state.db.as_ref();
    let ping = async { db.execute_unprepared("SELECT 1").await };

    match timeout(Duration::from_secs(5), ping).await {
        Ok(Ok(_)) => true,
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "db ping failed");
            false
        }
        Err(_) => {
            tracing::warn!("db ping timed out after 5s");
            false
        }
    }
}

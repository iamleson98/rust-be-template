//! Vitals RUM endpoint — `/api/vitals`.
//!
//! Receives `web-vitals` reports from the browser (LCP / INP / CLS /
//! TTFB / FCP) via `navigator.sendBeacon` and logs them at INFO level
//! with structured fields. No DB write — pipe `app_vitals=info` to your
//! log aggregator (Loki, CloudWatch, journald) and chart P75 over time.

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use utoipa::ToSchema;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct VitalsReport {
    pub name: String,
    pub value: f64,
    pub rating: String,
    pub id: String,
    pub delta: f64,
    pub navigation_type: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub user_agent: String,
    #[serde(default)]
    pub connection: String,
    #[serde(default)]
    pub device_memory: f64,
    #[serde(default)]
    pub timestamp: i64,
}

/// `POST /api/vitals` — receive a web-vitals report from the browser.
#[utoipa::path(
    post,
    path = "/api/vitals",
    tag = "vitals",
    request_body = VitalsReport,
    responses(
        (status = 204, description = "Report accepted"),
        (status = 400, description = "Invalid report"),
    )
)]
pub async fn report_vitals(
    State(_st): State<AppState>,
    Json(report): Json<VitalsReport>,
) -> AppResult<axum::http::StatusCode> {
    if report.value > 60_000.0 {
        return Ok(axum::http::StatusCode::NO_CONTENT);
    }
    tracing::info!(
        target: "app_vitals",
        metric = %report.name,
        value = report.value,
        rating = %report.rating,
        id = %report.id,
        nav_type = %report.navigation_type,
        path = %report.path,
        connection = %report.connection,
        device_memory = report.device_memory,
        "web vital reported"
    );
    Ok(axum::http::StatusCode::NO_CONTENT)
}

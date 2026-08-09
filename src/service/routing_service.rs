//! Routing service — Valhalla routing proxy.
//!
//! Ported from `booking-rs/logic/routing.rs`, adapted to the template's
//! `AppError` architecture.
//!
//! ## Design
//! - Owns: Valhalla URL resolution, request-body construction, HTTP forwarding,
//!   response parsing. No DB access (pure proxy to Valhalla).
//! - Uses a shared `reqwest::Client` for connection pooling.
//! - Returns `serde_json::Value` DTOs (no HTTP types).

use serde_json::{json, Value};

use crate::config::Config;
use crate::error::{AppError, AppResult};

pub struct RoutingService {
    valhalla_url: Option<String>,
    client: reqwest::Client,
}

impl RoutingService {
    pub fn new(config: &Config) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .connect_timeout(std::time::Duration::from_secs(5))
            .pool_max_idle_per_host(4)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            valhalla_url: config.server.valhalla_url.clone(),
            client,
        }
    }

    fn require_valhalla(&self) -> AppResult<&str> {
        self.valhalla_url.as_deref().ok_or_else(|| {
            AppError::Internal(
                "Valhalla routing service not configured. Set VALHALLA_URL.".into(),
            )
        })
    }

    async fn call_valhalla(&self, endpoint: &str, body: Value) -> AppResult<Value> {
        let base = self.require_valhalla()?;
        let url = format!("{base}{endpoint}");
        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(error = ?e, url = %url, "valhalla request failed");
                AppError::Internal(format!("Valhalla request failed: {e}"))
            })?;

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            tracing::error!(status = %status, body = %text, "valhalla non-2xx");
            return Err(AppError::Internal(format!(
                "Valhalla returned {status}: {}",
                text.chars().take(500).collect::<String>()
            )));
        }

        serde_json::from_str::<Value>(&text).map_err(|e| {
            tracing::error!(error = ?e, "valhalla response parse failed");
            AppError::Internal(format!("Valhalla response parse failed: {e}"))
        })
    }

    /// Turn-by-turn driving directions.
    pub async fn directions(
        &self,
        costing: &str,
        language: &str,
        locations: &[(f64, f64)],
    ) -> AppResult<Value> {
        if locations.len() < 2 {
            return Err(AppError::BadRequest(
                "at least 2 locations required".into(),
            ));
        }
        let locs: Vec<Value> = locations
            .iter()
            .map(|(lat, lon)| json!({ "lat": lat, "lon": lon }))
            .collect();
        let body = json!({
            "costing": costing,
            "language": language,
            "locations": locs,
            "directions_options": { "units": "kilometers" },
        });
        let v = self.call_valhalla("/route", body).await?;
        let trip = v.get("trip").cloned().unwrap_or(Value::Null);
        let summary = trip.get("summary").cloned().unwrap_or(Value::Null);
        let distance_km = summary
            .get("length")
            .and_then(|d| d.as_f64())
            .unwrap_or(0.0);
        let time_min = summary
            .get("time")
            .and_then(|t| t.as_f64())
            .unwrap_or(0.0)
            / 60.0;
        let shape = trip
            .get("shape")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string());
        Ok(json!({
            "valhalla": trip,
            "shape": shape,
            "distanceKm": distance_km,
            "timeMin": time_min,
        }))
    }

    /// Many-to-many travel time / distance matrix.
    pub async fn matrix(
        &self,
        costing: &str,
        sources: &[(f64, f64)],
        targets: &[(f64, f64)],
    ) -> AppResult<Value> {
        if sources.is_empty() || targets.is_empty() {
            return Err(AppError::BadRequest(
                "at least 1 source and 1 target required".into(),
            ));
        }
        let srcs: Vec<Value> = sources
            .iter()
            .map(|(lat, lon)| json!({ "lat": lat, "lon": lon }))
            .collect();
        let tgts: Vec<Value> = targets
            .iter()
            .map(|(lat, lon)| json!({ "lat": lat, "lon": lon }))
            .collect();
        let body = json!({
            "costing": costing,
            "sources": srcs,
            "targets": tgts,
            "units": "kilometers",
        });
        let v = self.call_valhalla("/sources_to_targets", body).await?;
        let matrix = v
            .get("sources_to_targets")
            .cloned()
            .unwrap_or(Value::Array(vec![]));
        let mut times_min: Vec<Vec<Option<f64>>> = Vec::new();
        let mut distances_km: Vec<Vec<Option<f64>>> = Vec::new();
        if let Some(rows) = matrix.as_array() {
            for row in rows {
                let mut t_row = Vec::new();
                let mut d_row = Vec::new();
                if let Some(cells) = row.as_array() {
                    for cell in cells {
                        let time = cell
                            .get("time")
                            .and_then(|t| t.as_f64())
                            .map(|t| t / 60.0);
                        let dist = cell.get("distance").and_then(|d| d.as_f64());
                        t_row.push(time);
                        d_row.push(dist);
                    }
                }
                times_min.push(t_row);
                distances_km.push(d_row);
            }
        }
        Ok(json!({
            "timesMin": times_min,
            "distancesKm": distances_km,
        }))
    }

    /// Reachability polygons (isochrones).
    pub async fn isochrone(
        &self,
        costing: &str,
        center: (f64, f64),
        contours_min: &[u32],
    ) -> AppResult<Value> {
        if contours_min.is_empty() {
            return Err(AppError::BadRequest(
                "at least 1 contour time required".into(),
            ));
        }
        let contours: Vec<Value> = contours_min
            .iter()
            .map(|t| json!({ "time": t }))
            .collect();
        let body = json!({
            "costing": costing,
            "locations": [{ "lat": center.0, "lon": center.1 }],
            "contours": contours,
            "polygons": true,
        });
        let v = self.call_valhalla("/isochrone", body).await?;
        Ok(json!({ "geojson": v }))
    }
}

//! Place service: search, popular places and reverse geocoding over the
//! in-memory place engine.
//!
//! The engine is built by `places-build` and swapped in by
//! [`crate::places::live`]; until the first generation exists every call
//! answers an empty list marked [`PlaceEngine::Unavailable`] (the routes give
//! that a short cache lifetime). Searching is CPU-bound, so it runs on the
//! blocking pool. Nothing here can fail on a strange query: text the engine
//! cannot make a word of simply matches nothing.

use std::sync::Arc;

use arc_swap::ArcSwapOption;

use crate::dto::place::{PlaceEngine, PlaceSearchHit, PlaceSearchResponse};
use crate::error::{AppError, AppResult};
use crate::places::{Engine, PlaceHit, SearchOptions};

#[derive(Default)]
pub struct PlaceService {
    engine: ArcSwapOption<Engine>,
}

impl PlaceService {
    pub fn new() -> Self {
        Self::default()
    }

    /// Puts `engine` in service; requests already running finish on the old one.
    pub fn install(&self, engine: Engine) {
        self.engine.store(Some(Arc::new(engine)));
    }

    /// The engine in service, if a generation has been loaded.
    pub fn engine(&self) -> Option<Arc<Engine>> {
        self.engine.load_full()
    }

    /// Places matching `query`, best first; `near` biases results toward a
    /// point. A blank query lists the popular places.
    pub async fn search(
        &self,
        query: &str,
        limit: usize,
        near: Option<(f64, f64)>,
    ) -> AppResult<PlaceSearchResponse> {
        let query = query.trim().to_string();
        self.ask(move |engine| {
            if query.is_empty() {
                engine.popular(0, limit)
            } else {
                engine.search(&query, &SearchOptions { limit, near })
            }
        })
        .await
    }

    /// The biggest cities and towns, `offset` places in.
    pub async fn popular(&self, offset: usize, limit: usize) -> AppResult<PlaceSearchResponse> {
        self.ask(move |engine| engine.popular(offset, limit)).await
    }

    /// The nearest places to a point, nearest first.
    pub async fn reverse(
        &self,
        lat: f64,
        lon: f64,
        limit: usize,
    ) -> AppResult<PlaceSearchResponse> {
        self.ask(move |engine| engine.reverse(lat, lon, limit))
            .await
    }

    async fn ask(
        &self,
        work: impl FnOnce(&Engine) -> Vec<PlaceHit> + Send + 'static,
    ) -> AppResult<PlaceSearchResponse> {
        let Some(engine) = self.engine() else {
            return Ok(PlaceSearchResponse {
                items: Vec::new(),
                engine: PlaceEngine::Unavailable,
            });
        };
        let hits = tokio::task::spawn_blocking(move || work(&engine))
            .await
            .map_err(|e| AppError::Internal(format!("place search: {e}")))?;
        Ok(PlaceSearchResponse {
            items: hits.into_iter().map(PlaceSearchHit::from).collect(),
            engine: PlaceEngine::Index,
        })
    }
}

// ────────────────────────────────────────────────────────────────
//  Pure helpers
// ────────────────────────────────────────────────────────────────

/// Haversine distance in kilometers between two lat/lon points.
pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6371.0; // Earth radius in km
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    r * c
}

// ────────────────────────────────────────────────────────────────
//  Unit tests
// ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_same_point_is_zero() {
        let d = haversine_km(21.0, 105.0, 21.0, 105.0);
        assert!(d < 0.001);
    }

    #[test]
    fn haversine_hanoi_to_da_nang() {
        // Hanoi: 21.0285, 105.8542
        // Da Nang: 16.0544, 108.2022
        // Approx 600-650 km
        let d = haversine_km(21.0285, 105.8542, 16.0544, 108.2022);
        assert!(d > 550.0 && d < 700.0, "distance was {d}");
    }
}

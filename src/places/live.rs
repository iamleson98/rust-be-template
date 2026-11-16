//! Keeps the server's engine in step with the generation `current` points at.
//!
//! The server never builds an index in its own process. It loads the live
//! generation before it starts serving, then looks at the `current` link every
//! minute: when `places-build` (the child process of the `places.build` job)
//! has published a newer generation, the new engine is built on a blocking
//! thread while the old one keeps answering, then swapped in with one atomic
//! pointer store. A generation that cannot be loaded is
//! logged once and skipped; the engine in service is never taken away.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use tracing::{info, warn};

use super::store::{Manifest, Store};
use super::Engine;
use crate::service::PlaceService;

const POLL_INTERVAL: Duration = Duration::from_secs(60);

/// Loads the live generation (if there is one), then keeps watching for new
/// ones in a background task.
pub async fn start(dir: PathBuf, places: Arc<PlaceService>) {
    let mut watcher = Watcher {
        store: Store::new(dir),
        places,
        loaded: None,
        failed: None,
    };
    watcher.check().await;
    if watcher.loaded.is_none() {
        info!("no place index yet: the `places.build` job (admin Cron jobs, Run now) publishes the first generation");
    }
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            watcher.check().await;
        }
    });
}

struct Watcher {
    store: Store,
    places: Arc<PlaceService>,
    /// The generation in service.
    loaded: Option<String>,
    /// The last generation that failed to load (not retried until `current` moves).
    failed: Option<String>,
}

impl Watcher {
    async fn check(&mut self) {
        let generation = match self.store.current_generation() {
            Ok(Some(generation)) => generation,
            Ok(None) => return,
            Err(e) => {
                warn!("place index: {e:#}");
                return;
            }
        };
        if self.loaded.as_ref() == Some(&generation) || self.failed.as_ref() == Some(&generation) {
            return;
        }
        let store = self.store.clone();
        let wanted = generation.clone();
        let started = Instant::now();
        match tokio::task::spawn_blocking(move || build_engine(&store, &wanted)).await {
            Ok(Ok((manifest, engine))) => {
                info!(
                    generation = %manifest.generation,
                    places = engine.len(),
                    "place index loaded in {:.1}s",
                    started.elapsed().as_secs_f64()
                );
                self.places.install(engine);
                self.loaded = Some(generation);
            }
            Ok(Err(e)) => {
                warn!("place index generation {generation} not loaded: {e:#}");
                self.failed = Some(generation);
            }
            Err(e) => {
                warn!("place index generation {generation} not loaded: {e}");
                self.failed = Some(generation);
            }
        }
    }
}

fn build_engine(store: &Store, generation: &str) -> Result<(Manifest, Engine)> {
    let (manifest, records) = store.load(generation)?;
    let engine = Engine::build(records, manifest.built_at.clone());
    Ok((manifest, engine))
}

#[cfg(test)]
mod tests {
    use place_extract::PlaceRecord;

    use super::*;

    fn publish(store: &Store, generation: &str, name: &str) {
        let records = vec![PlaceRecord {
            id: "n1".into(),
            name: name.into(),
            kind: "city".into(),
            province: name.into(),
            district: String::new(),
            ward: String::new(),
            lat: 21.0,
            lon: 105.8,
            population: 1_000_000,
            alt_names: Vec::new(),
        }];
        let manifest = Manifest {
            generation: generation.into(),
            places: 1,
            built_at: "t".into(),
            source_url: "u".into(),
            source_md5: "m".into(),
            profile: "all".into(),
        };
        store.publish(&manifest, &records, 2).unwrap();
    }

    fn first_hit(places: &PlaceService) -> Option<String> {
        places
            .engine()
            .and_then(|e| e.popular(0, 1).into_iter().next())
            .map(|h| h.name)
    }

    #[tokio::test]
    async fn follows_the_current_generation_and_survives_a_bad_one() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let places = Arc::new(PlaceService::new());
        let mut watcher = Watcher {
            store: store.clone(),
            places: places.clone(),
            loaded: None,
            failed: None,
        };

        watcher.check().await;
        assert_eq!(first_hit(&places), None, "no generation yet");

        publish(&store, "20261001T000000Z", "Hà Nội");
        watcher.check().await;
        assert_eq!(first_hit(&places).as_deref(), Some("Hà Nội"));

        publish(&store, "20261008T000000Z", "Đà Nẵng");
        watcher.check().await;
        assert_eq!(first_hit(&places).as_deref(), Some("Đà Nẵng"));

        publish(&store, "20261015T000000Z", "Huế");
        std::fs::write(dir.path().join("gen-20261015T000000Z/records.bin"), b"junk").unwrap();
        watcher.check().await;
        assert_eq!(
            first_hit(&places).as_deref(),
            Some("Đà Nẵng"),
            "a broken generation never replaces the live engine"
        );
        assert_eq!(watcher.failed.as_deref(), Some("20261015T000000Z"));
    }

    #[tokio::test]
    async fn start_loads_the_live_generation_before_returning() {
        let dir = tempfile::tempdir().unwrap();
        let places = Arc::new(PlaceService::new());
        start(dir.path().to_path_buf(), places.clone()).await;
        assert_eq!(first_hit(&places), None, "nothing published yet");

        publish(&Store::new(dir.path()), "20261001T000000Z", "Hà Nội");
        let places = Arc::new(PlaceService::new());
        start(dir.path().to_path_buf(), places.clone()).await;
        assert_eq!(first_hit(&places).as_deref(), Some("Hà Nội"));
    }
}

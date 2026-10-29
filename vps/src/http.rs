//! The HTTP API, served on loopback behind Cloudflare Tunnel.
//!
//! | Route                       | Auth   | Answer                                         |
//! |-----------------------------|--------|------------------------------------------------|
//! | `GET  /healthz`             | none   | 200 when an index is live, 503 before          |
//! | `GET  /v1/places/search`    | bearer | `{ items, engine }` (blank `q` → popular)      |
//! | `GET  /v1/places/reverse`   | bearer | `[hit]`, nearest first                         |
//! | `GET  /v1/places/popular`   | bearer | `{ items }`                                    |
//! | `GET  /v1/status`           | bearer | machine, latency, index and cron state         |
//! | `POST /v1/index?force=true` | bearer | 202 started / 409 already running             |
//!
//! Hits have the shape the Worker's `/api/places/*` routes already return.

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{Query, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use subtle::ConstantTimeEq;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::indexer::{self, Source};
use crate::metrics::Latency;
use crate::places::{Engine, PlaceHit, SearchOptions};
use crate::state::{AppState, Shared};

const MAX_LIMIT: usize = 50;
const MAX_POPULAR: usize = 200;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

pub fn router(state: Shared) -> Router {
    let api = Router::new()
        .route("/v1/places/search", get(search))
        .route("/v1/places/reverse", get(reverse))
        .route("/v1/places/popular", get(popular))
        .route("/v1/status", get(status))
        .route("/v1/index", post(start_index))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));
    Router::new()
        .route("/healthz", get(healthz))
        .merge(api)
        .layer(TimeoutLayer::with_status_code(
            StatusCode::SERVICE_UNAVAILABLE,
            REQUEST_TIMEOUT,
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// An error answer: `{ "error": message }`.
struct ApiError(StatusCode, &'static str);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

async fn require_token(State(state): State<Shared>, req: Request, next: Next) -> Response {
    let given = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default();
    if given
        .as_bytes()
        .ct_eq(state.config.service_token.as_bytes())
        .into()
    {
        next.run(req).await
    } else {
        ApiError(StatusCode::UNAUTHORIZED, "missing or wrong bearer token").into_response()
    }
}

async fn healthz(State(state): State<Shared>) -> Response {
    match state.engine.load_full() {
        Some(engine) => Json(json!({
            "status": "ok",
            "places": engine.len(),
            "indexBuiltAt": engine.stats().built_at,
        }))
        .into_response(),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "starting", "places": null })),
        )
            .into_response(),
    }
}

fn live_engine(state: &AppState) -> Result<Arc<Engine>, ApiError> {
    state.engine.load_full().ok_or(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "the place index is not built yet",
    ))
}

/// Runs CPU-bound index work off the async workers and records its latency.
async fn timed<T: Send + 'static>(
    latency: impl Fn(&AppState) -> &Latency + Send + 'static,
    state: Shared,
    work: impl FnOnce(&Engine) -> T + Send + 'static,
) -> Result<T, ApiError> {
    let engine = live_engine(&state)?;
    let started = Instant::now();
    let result = tokio::task::spawn_blocking(move || work(&engine)).await;
    latency(&state).record(started.elapsed(), result.is_ok());
    result.map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "search failed"))
}

fn coordinate(lat: Option<f64>, lon: Option<f64>) -> Result<Option<(f64, f64)>, ApiError> {
    match (lat, lon) {
        (None, None) => Ok(None),
        (Some(lat), Some(lon))
            if (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon) =>
        {
            Ok(Some((lat, lon)))
        }
        _ => Err(ApiError(
            StatusCode::BAD_REQUEST,
            "lat and lon go together and must be valid coordinates",
        )),
    }
}

#[derive(Deserialize)]
struct SearchParams {
    #[serde(default)]
    q: String,
    limit: Option<usize>,
    lat: Option<f64>,
    lon: Option<f64>,
}

async fn search(State(state): State<Shared>, Query(p): Query<SearchParams>) -> Response {
    let near = match coordinate(p.lat, p.lon) {
        Ok(near) => near,
        Err(e) => return e.into_response(),
    };
    let limit = p.limit.unwrap_or(10).clamp(1, MAX_LIMIT);
    let items = timed(
        |s| &s.search_latency,
        state,
        move |engine| {
            if p.q.trim().is_empty() {
                engine.popular(0, limit)
            } else {
                engine.search(&p.q, &SearchOptions { limit, near })
            }
        },
    )
    .await;
    match items {
        Ok(items) => Json(json!({ "items": items, "engine": "vps" })).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
struct ReverseParams {
    lat: f64,
    lon: f64,
    limit: Option<usize>,
}

async fn reverse(State(state): State<Shared>, Query(p): Query<ReverseParams>) -> Response {
    if let Err(e) = coordinate(Some(p.lat), Some(p.lon)) {
        return e.into_response();
    }
    let limit = p.limit.unwrap_or(10).clamp(1, MAX_LIMIT);
    match timed(
        |s| &s.reverse_latency,
        state,
        move |engine| engine.reverse(p.lat, p.lon, limit),
    )
    .await
    {
        Ok(items) => Json::<Vec<PlaceHit>>(items).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Deserialize)]
struct PopularParams {
    offset: Option<usize>,
    limit: Option<usize>,
}

async fn popular(State(state): State<Shared>, Query(p): Query<PopularParams>) -> Response {
    let engine = match live_engine(&state) {
        Ok(engine) => engine,
        Err(e) => return e.into_response(),
    };
    let limit = p.limit.unwrap_or(50).clamp(1, MAX_POPULAR);
    Json(json!({ "items": engine.popular(p.offset.unwrap_or(0), limit) })).into_response()
}

async fn status(State(state): State<Shared>) -> Response {
    let engine = state.engine.load_full();
    let index = state.index.lock().unwrap();
    let index_state = match (&engine, index.running) {
        (_, true) => "building",
        (Some(_), false) => "ready",
        (None, false) => "empty",
    };
    let index_json = json!({
        "state": index_state,
        "places": engine.as_ref().map(|e| e.len()),
        "terms": engine.as_ref().map(|e| e.stats().terms),
        "current": index.current,
        "lastRun": index.last_run,
        "schedule": state.config.indexer.schedule,
        "diskBytes": state.store.index_bytes(),
    });
    drop(index);
    let jobs: Vec<_> = state.jobs.lock().unwrap().values().cloned().collect();
    Json(json!({
        "service": {
            "version": env!("CARGO_PKG_VERSION"),
            "startedAt": state.started_at,
            "uptimeSecs": state.started.elapsed().as_secs(),
            "timezone": state.config.timezone,
        },
        "system": state.sampler.snapshot(),
        "requests": {
            "search": state.search_latency.summary(),
            "reverse": state.reverse_latency.summary(),
        },
        "index": index_json,
        "jobs": jobs,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct IndexParams {
    #[serde(default)]
    force: bool,
}

async fn start_index(State(state): State<Shared>, Query(p): Query<IndexParams>) -> Response {
    if state.index.lock().unwrap().running {
        return ApiError(StatusCode::CONFLICT, "an index run is already in progress")
            .into_response();
    }
    tokio::spawn(async move {
        if let Err(e) = indexer::run(state, Source::Remote { force: p.force }).await {
            tracing::warn!("index run: {e:#}");
        }
    });
    (StatusCode::ACCEPTED, Json(json!({ "started": true }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    const TOKEN: &str = "test-token-test-token-test-token";

    fn app(with_index: bool) -> (Router, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg: crate::config::Config = toml::from_str(&format!(
            "[server]\ndata_dir = {:?}\n[indexer]\n",
            dir.path()
        ))
        .unwrap();
        cfg.service_token = TOKEN.into();
        let store = crate::store::Store::open(dir.path()).unwrap();
        let state = Arc::new(AppState::new(cfg, store).unwrap());
        if with_index {
            let rec: place_extract::PlaceRecord = serde_json::from_str(
                r#"["n1","Hà Nội","city","Hà Nội","","",21.03,105.85,8000000,""]"#,
            )
            .unwrap();
            state
                .engine
                .store(Some(Arc::new(Engine::build(vec![rec], "t"))));
        }
        (router(state), dir)
    }

    async fn get(app: &Router, uri: &str, token: Option<&str>) -> (StatusCode, serde_json::Value) {
        let mut req = Request::builder().uri(uri);
        if let Some(t) = token {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        let res = app
            .clone()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let body = res.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&body).unwrap_or_default())
    }

    #[tokio::test]
    async fn health_is_public_and_reflects_the_index() {
        let (app, _dir) = app(false);
        assert_eq!(
            get(&app, "/healthz", None).await.0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        let (app, _dir) = self::app(true);
        let (status, body) = get(&app, "/healthz", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["places"], 1);
    }

    #[tokio::test]
    async fn the_api_needs_the_token() {
        let (app, _dir) = app(true);
        assert_eq!(
            get(&app, "/v1/places/search?q=ha", None).await.0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            get(&app, "/v1/places/search?q=ha", Some("wrong")).await.0,
            StatusCode::UNAUTHORIZED
        );
        let (status, body) = get(&app, "/v1/places/search?q=ha%20noi", Some(TOKEN)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["items"][0]["name"], "Hà Nội");
        assert_eq!(body["engine"], "vps");
    }

    #[tokio::test]
    async fn validates_parameters_and_answers_every_route() {
        let (app, _dir) = app(true);
        let (status, _) = get(&app, "/v1/places/search?q=x&lat=999&lon=1", Some(TOKEN)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, body) = get(&app, "/v1/places/search?q=", Some(TOKEN)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["items"][0]["name"], "Hà Nội",
            "blank q lists popular places"
        );
        let (status, body) =
            get(&app, "/v1/places/reverse?lat=21.03&lon=105.85", Some(TOKEN)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body[0]["name"], "Hà Nội");
        let (_, body) = get(&app, "/v1/status", Some(TOKEN)).await;
        assert_eq!(body["index"]["state"], "ready");
        assert_eq!(body["requests"]["reverse"]["count"], 1);
        assert!(body["system"]["cpus"].as_u64().unwrap() >= 1);
    }

    #[tokio::test]
    async fn search_before_the_first_index_is_503() {
        let (app, _dir) = app(false);
        let (status, _) = get(&app, "/v1/places/search?q=ha", Some(TOKEN)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }
}

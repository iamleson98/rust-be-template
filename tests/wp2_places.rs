//! `/api/places/*` over the in-process place engine: the response contract,
//! the cache lifetimes, parameter validation, queries that must never fail,
//! nearest-first reverse geocoding, and a generation swap under load.

use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use backend::places::Engine;
use backend::state::AppState;
use http_body_util::BodyExt;
use place_extract::PlaceRecord;
use serde_json::Value;
use tower::ServiceExt;

async fn boot_state() -> AppState {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = dotenvy::dotenv();
        std::env::set_var("DATABASE_URL", "sqlite::memory:");
        std::env::set_var("JWT_SECRET", "test-secret-at-least-32-bytes-long-aaaaaaaa");
        std::env::set_var("COOKIE_SECURE", "false");
        std::env::set_var("COOKIE_DOMAIN", "localhost");
        std::env::set_var("CACHE_BACKEND", "moka");
        std::env::set_var("WORKER_BACKEND", "db");
        std::env::set_var("SCHEDULER_ENABLED", "false");
        std::env::set_var("AUDIO_CALL_ENABLED", "false");
        std::env::set_var("NULLCLAW_ENABLED", "false");
        std::env::set_var("VNPAY_ENABLED", "false");
        std::env::set_var("MOMO_ENABLED", "false");
        std::env::set_var("ZALOPAY_ENABLED", "false");
        std::env::set_var("VIETQR_ENABLED", "false");
        std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
        std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
        // No generation has ever been built here.
        let empty = std::env::temp_dir().join(format!("wp2-places-{}", uuid::Uuid::new_v4()));
        std::env::set_var("PLACES_DIR", empty);
    });
    backend::server::bootstrap().await.expect("bootstrap")
}

fn rec(
    id: &str,
    name: &str,
    kind: &str,
    province: &str,
    lat: f64,
    lon: f64,
    pop: i64,
) -> PlaceRecord {
    PlaceRecord {
        id: id.into(),
        name: name.into(),
        kind: kind.into(),
        province: province.into(),
        district: String::new(),
        ward: String::new(),
        lat,
        lon,
        population: pop,
        alt_names: Vec::new(),
    }
}

fn engine() -> Engine {
    Engine::build(
        vec![
            rec("n1", "Hà Nội", "city", "Hà Nội", 21.03, 105.85, 8_000_000),
            rec(
                "n2",
                "Hồ Chí Minh",
                "city",
                "Hồ Chí Minh",
                10.78,
                106.7,
                9_000_000,
            ),
            rec("n3", "Đà Nẵng", "city", "Đà Nẵng", 16.05, 108.2, 1_100_000),
            rec(
                "n4",
                "Bến xe Mỹ Đình",
                "bus_station",
                "Hà Nội",
                21.028,
                105.78,
                0,
            ),
            rec(
                "n5",
                "Bến xe Miền Đông",
                "bus_station",
                "Hồ Chí Minh",
                10.81,
                106.71,
                0,
            ),
        ],
        "t",
    )
}

/// The anti-scraping layer lets browsers (and nothing without a User-Agent) in.
const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
    (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn get(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(header::USER_AGENT, BROWSER_UA)
        .body(Body::empty())
        .unwrap()
}

/// What a client of the full router sees. The limiter keys on the peer address.
async fn call(app: &axum::Router, uri: &str) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut req = get(uri);
    req.extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 4000))));
    let res = app.clone().oneshot(req).await.unwrap();
    let (status, headers) = (res.status(), res.headers().clone());
    let body = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        headers,
        serde_json::from_slice(&body).unwrap_or(Value::Null),
    )
}

fn cache_control(headers: &axum::http::HeaderMap) -> &str {
    headers
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
}

#[tokio::test]
async fn before_the_first_index_every_route_answers_empty_and_briefly_cached() {
    let st = boot_state().await;
    let app = backend::routes::build_router(st);

    let (status, headers, body) = call(&app, "/api/places/search?q=ha").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"], serde_json::json!([]));
    assert_eq!(body["engine"], "unavailable");
    assert_eq!(cache_control(&headers), "public, max-age=60");

    let (status, headers, body) = call(&app, "/api/places").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({ "items": [] }));
    assert_eq!(cache_control(&headers), "public, max-age=60");

    let (status, headers, body) = call(&app, "/api/places/reverse?lat=21&lon=105").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!([]));
    assert_eq!(cache_control(&headers), "public, max-age=60");
}

#[tokio::test]
async fn search_hits_have_the_worker_shape_and_a_five_minute_cache() {
    let st = boot_state().await;
    st.places.install(engine());
    let app = backend::routes::build_router(st);

    let (status, headers, body) = call(&app, "/api/places/search?q=ha%20noi").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["engine"], "index");
    assert_eq!(cache_control(&headers), "public, max-age=300");
    let hit = &body["items"][0];
    assert_eq!(hit["name"], "Hà Nội");
    let mut keys: Vec<&str> = hit
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "district",
            "id",
            "lat",
            "lon",
            "name",
            "nameNoTones",
            "province",
            "score",
            "type",
            "ward"
        ]
    );
    assert_eq!(hit["id"], "n1");
    assert_eq!(hit["nameNoTones"], "ha noi");
    assert_eq!(hit["type"], "city");
    assert_eq!(hit["district"], Value::Null);
    assert!(hit["score"].as_f64().unwrap() > 0.0);
}

#[tokio::test]
async fn a_blank_query_lists_the_popular_places() {
    let st = boot_state().await;
    st.places.install(engine());
    let app = backend::routes::build_router(st);

    for uri in ["/api/places/search?q=", "/api/places/search?q=%20%20"] {
        let (status, _, body) = call(&app, uri).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
        let names: Vec<&str> = body["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| h["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["Hồ Chí Minh", "Hà Nội", "Đà Nẵng"], "{uri}");
        assert_eq!(body["engine"], "index");
    }
}

#[tokio::test]
async fn parameters_are_validated_and_limits_clamped() {
    let st = boot_state().await;
    st.places.install(engine());
    let app = backend::routes::build_router(st);

    for uri in [
        "/api/places/search",
        "/api/places/search?q=ha&lat=21",
        "/api/places/search?q=ha&lon=105",
        "/api/places/search?q=ha&lat=91&lon=105",
        "/api/places/search?q=ha&lat=21&lon=181",
        "/api/places/search?q=ha&lat=NaN&lon=105",
        "/api/places/search?q=ha&lat=north&lon=105",
        "/api/places/search?q=ha&limit=many",
        "/api/places/search?q=ha&limit=-1",
        "/api/places/reverse",
        "/api/places/reverse?lat=21",
        "/api/places?limit=lots",
        "/api/places?offset=-3",
    ] {
        let (status, _, _) = call(&app, uri).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
    }

    let (status, _, body) = call(&app, "/api/places/search?q=ha&lat=21&lon=105").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"][0]["name"], "Hà Nội");

    // Reverse geocoding a point off the globe is an empty list, as on the Worker.
    for uri in [
        "/api/places/reverse?lat=21&lon=999",
        "/api/places/reverse?lat=-90.5&lon=105",
    ] {
        let (status, _, body) = call(&app, uri).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
        assert_eq!(body, serde_json::json!([]), "{uri}");
    }

    // `limit=0` still returns one item; a huge limit is capped (here by the data).
    let (_, _, body) = call(&app, "/api/places/search?q=&limit=0").await;
    assert_eq!(body["items"].as_array().unwrap().len(), 1);
    let (status, _, body) = call(&app, "/api/places/search?q=&limit=100000").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn strange_queries_are_empty_answers_never_errors() {
    let st = boot_state().await;
    st.places.install(engine());
    let app = backend::routes::build_router(st);

    let long = "x".repeat(5000);
    for q in [
        "???",
        "a:b",
        "H%C3%A0%20N%E1%BB%99i%20(c%C5%A9",
        "%22",
        "*",
        "-",
        "%2B%2B",
        "%5C",
        "%00",
        "%F0%9F%9A%8C",
        "()",
        &long,
    ] {
        let (status, _, body) = call(&app, &format!("/api/places/search?q={q}")).await;
        assert_eq!(status, StatusCode::OK, "q={q}");
        assert!(body["items"].is_array(), "q={q}");
        assert_eq!(body["engine"], "index", "q={q}");
    }
    let (_, _, body) = call(&app, "/api/places/search?q=???").await;
    assert_eq!(body["items"], serde_json::json!([]));
}

#[tokio::test]
async fn the_popular_list_pages_and_caches_for_an_hour() {
    let st = boot_state().await;
    st.places.install(engine());
    let app = backend::routes::build_router(st);

    let (status, headers, body) = call(&app, "/api/places").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cache_control(&headers), "public, max-age=3600");
    assert_eq!(body["items"].as_array().unwrap().len(), 3);
    assert_eq!(body.as_object().unwrap().len(), 1, "only `items`");

    let (_, _, body) = call(&app, "/api/places?offset=1&limit=1").await;
    assert_eq!(body["items"][0]["name"], "Hà Nội");
    let (_, _, body) = call(&app, "/api/places?offset=99").await;
    assert_eq!(body["items"], serde_json::json!([]));
}

#[tokio::test]
async fn reverse_returns_the_nearest_places_first() {
    // A dense block of places that all look alike to a text search: the old
    // index scored them equally and dropped the nearest arbitrarily.
    let mut records = Vec::new();
    for i in 0..30 {
        for j in 0..30 {
            records.push(rec(
                &format!("n{}", i * 30 + j),
                &format!("Phường {}", i * 30 + j),
                "suburb",
                "Hà Nội",
                21.0 + f64::from(i) * 0.001,
                105.8 + f64::from(j) * 0.001,
                0,
            ));
        }
    }
    let st = boot_state().await;
    st.places.install(Engine::build(records, "t"));
    let app = backend::routes::build_router(st);

    let (status, headers, body) =
        call(&app, "/api/places/reverse?lat=21.0151&lon=105.8149&limit=5").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cache_control(&headers), "public, max-age=3600");
    let hits = body.as_array().expect("a bare array");
    assert_eq!(hits.len(), 5);

    // Squared planar distance to the query point, longitude shrunk by latitude.
    let dist = |lat: f64, lon: f64| {
        let (dlat, dlon) = (
            lat - 21.0151,
            (lon - 105.8149) * 21.0151_f64.to_radians().cos(),
        );
        dlat * dlat + dlon * dlon
    };
    let hit_dist = |h: &Value| dist(h["lat"].as_f64().unwrap(), h["lon"].as_f64().unwrap());
    assert!(
        hits.windows(2).all(|w| hit_dist(&w[0]) <= hit_dist(&w[1])),
        "nearest first"
    );
    // The five nearest of the whole block, not just of some arbitrary slice.
    let mut all: Vec<(f64, usize)> = (0..30)
        .flat_map(|i| (0..30).map(move |j| (i, j)))
        .map(|(i, j)| {
            let d = dist(21.0 + i as f64 * 0.001, 105.8 + j as f64 * 0.001);
            (d, i * 30 + j)
        })
        .collect();
    all.sort_by(|a, b| a.0.total_cmp(&b.0));
    let want: Vec<String> = all[..5].iter().map(|(_, n)| format!("n{n}")).collect();
    let got: Vec<&str> = hits.iter().map(|h| h["id"].as_str().unwrap()).collect();
    assert_eq!(got, want);
}

#[tokio::test]
async fn swapping_the_engine_under_load_never_fails_a_request() {
    let st = boot_state().await;
    st.places.install(engine());
    let app = backend::routes::build_router(st.clone());

    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let swapper = {
        let (places, stop) = (st.places.clone(), stop.clone());
        tokio::spawn(async move {
            let mut swaps = 0u32;
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                let next = tokio::task::spawn_blocking(engine).await.unwrap();
                places.install(next);
                swaps += 1;
                tokio::task::yield_now().await;
            }
            swaps
        })
    };

    let mut clients = Vec::new();
    for c in 0..8 {
        let app = app.clone();
        clients.push(tokio::spawn(async move {
            for n in 0..150 {
                let uri = match (c + n) % 3 {
                    0 => "/api/places/search?q=ha%20noi",
                    1 => "/api/places?limit=2",
                    _ => "/api/places/reverse?lat=21.03&lon=105.85",
                };
                // A peer of its own per request: the limiter's buckets are per address.
                let mut req = get(uri);
                req.extensions_mut().insert(ConnectInfo(SocketAddr::from((
                    [10, 0, c as u8, n as u8],
                    4000,
                ))));
                let res = app.clone().oneshot(req).await.unwrap();
                assert_eq!(res.status(), StatusCode::OK, "{uri}");
                let body = res.into_body().collect().await.unwrap().to_bytes();
                let json: Value = serde_json::from_slice(&body).unwrap();
                let items = json.get("items").unwrap_or(&json);
                assert!(
                    !items.as_array().unwrap().is_empty(),
                    "{uri}: never empty mid-swap"
                );
            }
        }));
    }
    for client in clients {
        client.await.unwrap();
    }
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    let swaps = swapper.await.unwrap();
    assert!(
        swaps > 1,
        "the engine was swapped while requests ran ({swaps} swaps)"
    );
}

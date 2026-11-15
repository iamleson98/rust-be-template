//! The public catalog and trip search, over the service graph and HTTP:
//! the coordinate search within the places' cities, trips of inactive
//! brands, recommendations, `/api/routes` and `/api/brands`, the date and
//! `brand_id` checks, routing without Valhalla, `cityId` on the trip
//! detail, and the brand page (`/api/brands/{slug}/profile`).

use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use axum::response::IntoResponse;
use backend::dto::admin::{
    UpsertAddressRequest, UpsertBrandRequest, UpsertBusLayoutRequest, UpsertPickupPointRequest,
    UpsertRouteRequest, UpsertSchedulePointItem, UpsertScheduleRequest,
};
use backend::error::AppError;
use backend::service::seat_plan_presets;
use backend::service::trip_search::{Filters, Options, Sort};
use backend::service::trip_time;
use backend::state::AppState;
use chrono::Datelike;
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
    Statement,
};
use tower::ServiceExt;
use uuid::Uuid;

async fn boot_state() -> anyhow::Result<AppState> {
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
        std::env::set_var("SEARCH_INDEX_DIR", "");
        std::env::set_var("AUDIO_CALL_ENABLED", "false");
        std::env::set_var("NULLCLAW_ENABLED", "false");
        std::env::set_var("VNPAY_ENABLED", "false");
        std::env::set_var("MOMO_ENABLED", "false");
        std::env::set_var("ZALOPAY_ENABLED", "false");
        std::env::set_var("VIETQR_ENABLED", "false");
        std::env::set_var("OAUTH_GOOGLE_ENABLED", "false");
        std::env::set_var("OAUTH_FACEBOOK_ENABLED", "false");
        std::env::remove_var("SERVER_VALHALLA_URL");
    });
    backend::server::bootstrap().await
}

/// `GET uri` through the real router, as a browser would send it.
async fn get(st: &AppState, uri: &str) -> anyhow::Result<(StatusCode, serde_json::Value)> {
    let mut request = Request::builder()
        .uri(uri)
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) wp3/1.0",
        )
        .body(Body::empty())?;
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 4000))));
    let response = backend::routes::build_router(st.clone())
        .oneshot(request)
        .await?;
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await?;
    Ok((
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    ))
}

/// Two days ahead: no trip has left yet, whatever the time of day.
fn travel_date() -> String {
    (chrono::Utc::now() + chrono::Duration::days(2))
        .format("%Y-%m-%d")
        .to_string()
}

fn opts(sort: Sort, filters: Filters) -> Options {
    Options::new(
        &travel_date(),
        Some(100),
        Some(0),
        sort,
        Some(1),
        None,
        filters,
    )
    .expect("valid options")
}

async fn brand(st: &AppState, name: &str) -> anyhow::Result<Uuid> {
    Ok(st
        .admin
        .create_brand(&UpsertBrandRequest {
            name: Some(name.into()),
            ..Default::default()
        })
        .await?
        .id)
}

async fn route(
    st: &AppState,
    name: &str,
    brand: Uuid,
    from: &str,
    to: &str,
) -> anyhow::Result<Uuid> {
    Ok(st
        .admin
        .create_route(&UpsertRouteRequest {
            name: Some(name.into()),
            brand_id: Some(brand),
            start_location_id: Some(from.into()),
            end_location_id: Some(to.into()),
            status: None,
        })
        .await?
        .id)
}

async fn limousine(st: &AppState) -> anyhow::Result<Uuid> {
    st.admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))
}

/// A daily schedule of `route_id` leaving at `at`.
async fn schedule(st: &AppState, route_id: Uuid, at: &str, price: i64) -> anyhow::Result<Uuid> {
    Ok(st
        .admin
        .create_schedule(&UpsertScheduleRequest {
            route_id: Some(route_id),
            departure_time: Some(at.into()),
            days_of_week: Some("1111111".into()),
            vehicle_type_id: Some(limousine(st).await?),
            base_price_adult: Some(price),
            ..Default::default()
        })
        .await?
        .id)
}

async fn pickup_points(
    st: &AppState,
    route_id: Uuid,
    stops: &[(&str, f64, f64)],
) -> anyhow::Result<()> {
    for (order, (name, lat, lon)) in stops.iter().enumerate() {
        st.admin
            .create_pickup_point(&UpsertPickupPointRequest {
                route_id: Some(route_id),
                name: Some((*name).into()),
                lat: Some(*lat),
                lon: Some(*lon),
                stop_order: Some(order as i64),
                ..Default::default()
            })
            .await?;
    }
    Ok(())
}

async fn deactivate(st: &AppState, brand: Uuid) -> anyhow::Result<()> {
    st.admin
        .update_brand(
            brand,
            &UpsertBrandRequest {
                status: Some("inactive".into()),
                ..Default::default()
            },
        )
        .await?;
    Ok(())
}

// ── Coordinate search within the places' cities ─────────────────

const HANOI: (f64, f64) = (21.03, 105.85);
const SAIGON: (f64, f64) = (10.78, 106.70);
const NEAR_HANOI: (&str, f64, f64) = ("Bến xe Giáp Bát", 20.98, 105.84);
const NEAR_SAIGON: (&str, f64, f64) = ("Bến xe Miền Đông", 10.81, 106.71);

#[tokio::test]
async fn a_geo_search_within_the_cities_keeps_every_trip_between_them() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let operator = brand(&st, "Nhà xe Nam Bắc").await?;

    // Every route runs Hà Nội → Sài Gòn but the passing one.
    let trip_of = |name: &'static str, from: &'static str, to: &'static str, at: &'static str| {
        let st = &st;
        async move {
            let route_id = route(st, name, operator, from, to).await?;
            schedule(st, route_id, at, 500_000).await?;
            anyhow::Ok(route_id)
        }
    };
    let near = trip_of("Gần", "ha-noi", "ho-chi-minh", "07:00").await?;
    pickup_points(&st, near, &[NEAR_HANOI, NEAR_SAIGON]).await?;
    // Stops 36 km and 23 km from the places: measured, farther than `near`.
    let far = trip_of("Xa", "ha-noi", "ho-chi-minh", "08:00").await?;
    pickup_points(
        &st,
        far,
        &[("Sơn Tây", 21.14, 105.5), ("Biên Hòa", 10.95, 106.82)],
    )
    .await?;
    // Stops beyond the 50 km a search measures.
    let outside = trip_of("Ngoài", "ha-noi", "ho-chi-minh", "09:00").await?;
    pickup_points(
        &st,
        outside,
        &[("Hòa Bình", 20.82, 105.34), ("Bà Rịa", 10.5, 107.17)],
    )
    .await?;
    // Nothing to measure at all.
    trip_of("Không điểm", "ha-noi", "ho-chi-minh", "10:00").await?;
    // Not between the cities but passing near both places.
    let passing = trip_of("Đi qua", "hai-phong", "ho-chi-minh", "11:00").await?;
    pickup_points(&st, passing, &[NEAR_HANOI, NEAR_SAIGON]).await?;
    // Neither.
    trip_of("Khác", "hai-phong", "da-nang", "12:00").await?;
    trip_of("Chiều về", "ho-chi-minh", "ha-noi", "13:00").await?;

    let names = |found: &backend::dto::public::TripSearchResponse| -> Vec<String> {
        found.items.iter().map(|t| t.route_name.clone()).collect()
    };
    let geo = |cities: Option<(&'static str, &'static str)>| {
        let public = st.public.clone();
        async move {
            public
                .search_trips_geo(
                    HANOI,
                    SAIGON,
                    50.0,
                    &opts(Sort::Distance, Filters::default()),
                    cities,
                )
                .await
        }
    };

    // Without the cities only what can be measured is found.
    assert_eq!(names(&geo(None).await?), ["Gần", "Đi qua", "Xa"]);

    // With them every trip between the cities too — unmeasured last.
    let found = geo(Some(("Hà Nội", "TP. Hồ Chí Minh"))).await?;
    assert_eq!(
        names(&found),
        ["Gần", "Đi qua", "Xa", "Ngoài", "Không điểm"]
    );
    assert_eq!(found.total, Some(5));
    assert_eq!(found.facets.as_ref().map(|f| f.matches), Some(5));
    let by_name = |name: &str| found.items.iter().find(|t| t.route_name == name).unwrap();
    assert_eq!(
        by_name("Gần").pickup.as_ref().unwrap().name,
        "Bến xe Giáp Bát"
    );
    let beyond = by_name("Ngoài").pickup.as_ref().unwrap();
    assert_eq!(beyond.name, "Hòa Bình");
    assert!(beyond.distance_km > 50.0, "{}", beyond.distance_km);
    assert!(by_name("Không điểm").pickup.is_none());
    assert!(by_name("Không điểm").dropoff.is_none());
    // Every route is still sorted by the other keys on request.
    let by_departure = st
        .public
        .search_trips_geo(
            HANOI,
            SAIGON,
            50.0,
            &opts(Sort::Departure, Filters::default()),
            Some(("Hà Nội", "Sài Gòn")),
        )
        .await?;
    assert_eq!(
        names(&by_departure),
        ["Gần", "Xa", "Ngoài", "Không điểm", "Đi qua"]
    );
    Ok(())
}

#[tokio::test]
async fn the_geo_endpoint_reads_the_cities_both_or_neither() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let operator = brand(&st, "Nhà xe Nam Bắc").await?;
    let route_id = route(&st, "Không điểm", operator, "ha-noi", "ho-chi-minh").await?;
    schedule(&st, route_id, "10:00", 500_000).await?;

    let query = format!(
        "/api/search/geo?fromLat=21.03&fromLon=105.85&toLat=10.78&toLon=106.7&date={}",
        travel_date()
    );
    let total = |extra: &'static str| {
        let (st, query) = (&st, &query);
        async move {
            let (status, body) = get(st, &format!("{query}{extra}")).await?;
            assert_eq!(status, StatusCode::OK, "{body}");
            anyhow::Ok(body["total"].as_u64().unwrap())
        }
    };
    assert_eq!(total("").await?, 0);
    assert_eq!(total("&fromCity=H%C3%A0%20N%E1%BB%99i").await?, 0);
    assert_eq!(
        total("&fromCity=H%C3%A0%20N%E1%BB%99i&toCity=S%C3%A0i%20G%C3%B2n").await?,
        1
    );
    Ok(())
}

// ── Inactive brands ─────────────────────────────────────────────

#[tokio::test]
async fn trips_of_inactive_brands_are_dropped_before_the_facets() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let (open, closed) = (
        brand(&st, "Nhà xe Mở").await?,
        brand(&st, "Nhà xe Đóng").await?,
    );
    for (operator, at) in [(open, "07:00"), (closed, "08:00"), (closed, "09:00")] {
        let route_id = route(&st, "Hà Nội - Đà Nẵng", operator, "ha-noi", "da-nang").await?;
        schedule(&st, route_id, at, 300_000).await?;
    }
    let search = || {
        let public = st.public.clone();
        async move {
            public
                .search_trips(
                    "Hà Nội",
                    "Đà Nẵng",
                    &opts(Sort::Departure, Filters::default()),
                )
                .await
        }
    };
    assert_eq!(search().await?.total, Some(3));

    deactivate(&st, closed).await?;
    let found = search().await?;
    assert_eq!(found.total, Some(1));
    assert_eq!(found.items[0].brand_name, "Nhà xe Mở");
    let facets = found.facets.unwrap();
    assert_eq!(facets.matches, 1);
    assert_eq!(facets.brands.len(), 1);
    assert_eq!(facets.hours.iter().map(|h| h.count).sum::<u64>(), 1);
    Ok(())
}

// ── Recommendations ─────────────────────────────────────────────

#[tokio::test]
async fn recommendations_are_real_cards_in_departure_order() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let plan = seat_plan_presets::find("sleeper_40").expect("preset").plan;
    let layout = st
        .admin
        .create_bus_layout(&UpsertBusLayoutRequest {
            name: Some("Giường nằm 40".into()),
            vehicle_type: Some("sleeper".into()),
            plan: Some(plan),
            ..Default::default()
        })
        .await?
        .id;
    let (open, closed) = (
        brand(&st, "Nhà xe Mở").await?,
        brand(&st, "Nhà xe Đóng").await?,
    );
    let open_route = route(&st, "Hà Nội - Đà Nẵng", open, "ha-noi", "da-nang").await?;
    for at in ["18:00", "06:00", "12:00"] {
        st.admin
            .create_schedule(&UpsertScheduleRequest {
                route_id: Some(open_route),
                departure_time: Some(at.into()),
                days_of_week: Some("1111111".into()),
                bus_layout_id: Some(layout),
                vehicle_type_id: Some(limousine(&st).await?),
                base_price_adult: Some(400_000),
                ..Default::default()
            })
            .await?;
    }
    let closed_route = route(&st, "Hà Nội - Huế", closed, "ha-noi", "hue").await?;
    schedule(&st, closed_route, "00:30", 200_000).await?;
    deactivate(&st, closed).await?;

    let found = st.public.recommendations().await?;
    assert_eq!(found.items.len(), 4);
    assert!(found.total.is_none() && found.facets.is_none());
    let today = trip_time::local_today();
    let order: Vec<(String, String)> = found
        .items
        .iter()
        .map(|t| (t.departure_date.clone(), t.departure_time.clone().unwrap()))
        .collect();
    let mut sorted = order.clone();
    sorted.sort();
    assert_eq!(order, sorted, "soonest first: by date, then time");
    assert!(order[0].0 >= today, "{order:?}");
    for item in &found.items {
        assert_eq!(item.brand_name, "Nhà xe Mở");
        // The schedule's own vehicle class, not a hard-coded "standard".
        assert_eq!(item.vehicle_type, "sleeper");
        assert_eq!(item.capacity, Some(40));
        assert_eq!(item.from_name, "Hà Nội");
        assert_ne!(item.to_lat, 0.0);
    }
    Ok(())
}

// ── Brands and routes ───────────────────────────────────────────

#[tokio::test]
async fn brands_are_ordered_by_rating_then_trips_then_name() -> anyhow::Result<()> {
    use backend::entity::brand as brands;
    let st = boot_state().await?;
    for (name, rating, trips) in [
        ("Zed", Some(4.5), 5),
        ("Beta", Some(4.5), 5),
        ("Alpha", Some(4.5), 90),
        ("Top", Some(4.9), 0),
        ("Unrated B", None, 3),
        ("Unrated A", None, 3),
    ] {
        let id = brand(&st, name).await?;
        brands::Entity::update_many()
            .col_expr(brands::Column::Rating, Expr::value(rating))
            .col_expr(brands::Column::TotalTrips, Expr::value(trips))
            .filter(brands::Column::Id.eq(id))
            .exec(st.db.as_ref())
            .await?;
    }
    let listed = st.public.list_brands(20).await?;
    let names: Vec<_> = listed.items.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(
        names,
        ["Top", "Alpha", "Beta", "Zed", "Unrated A", "Unrated B"]
    );

    let (status, body) = get(&st, "/api/brands?limit=2").await?;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"][0]["name"], "Top");
    assert_eq!(body["items"].as_array().unwrap().len(), 2);
    Ok(())
}

#[tokio::test]
async fn routes_carry_the_cities_coordinates_and_reject_a_bad_brand_id() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let (mine, other) = (brand(&st, "Của tôi").await?, brand(&st, "Của họ").await?);
    let to_hue = route(&st, "B Hà Nội - Huế", mine, "ha-noi", "hue").await?;
    route(&st, "A Hà Nội - Đà Nẵng", mine, "ha-noi", "da-nang").await?;
    route(&st, "C Khác", other, "ha-noi", "da-nang").await?;
    schedule(&st, to_hue, "07:00", 250_000).await?;

    let (status, all) = get(&st, "/api/routes").await?;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(all["items"].as_array().unwrap().len(), 3);

    let (status, own) = get(&st, &format!("/api/routes?brand_id={mine}")).await?;
    assert_eq!(status, StatusCode::OK);
    let items = own["items"].as_array().unwrap();
    let names: Vec<_> = items.iter().map(|r| r["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["A Hà Nội - Đà Nẵng", "B Hà Nội - Huế"]);
    let hue = backend::cities::find_by_slug("hue").unwrap();
    let hanoi = backend::cities::find_by_slug("ha-noi").unwrap();
    assert_eq!(items[1]["from"]["name"], "Hà Nội");
    assert_eq!(items[1]["from"]["lat"], hanoi.lat);
    assert_eq!(items[1]["from"]["lon"], hanoi.lon);
    assert_eq!(items[1]["to"]["lat"], hue.lat);
    assert_eq!(items[1]["to"]["lon"], hue.lon);
    assert_eq!(items[1]["priceFrom"], 250_000);
    assert_eq!(items[1]["scheduleCount"], 1);

    for bad in ["not-a-uuid", "", "123"] {
        let (status, _) = get(&st, &format!("/api/routes?brand_id={bad}")).await?;
        assert_eq!(status, StatusCode::BAD_REQUEST, "brand_id={bad:?}");
    }
    Ok(())
}

// ── Option and routing checks ───────────────────────────────────

#[test]
fn a_search_date_must_be_a_zero_padded_calendar_date() {
    let new = |date: &str| {
        Options::new(
            date,
            None,
            None,
            Sort::Departure,
            None,
            None,
            Filters::default(),
        )
    };
    assert!(new("2026-01-05").is_ok());
    assert!(new(" 2026-01-05 ").is_ok());
    for bad in [
        "2026-1-5",
        "2026-01-5",
        "2026-02-30",
        "05/01/2026",
        "2026-01-05T08:00",
        "",
    ] {
        assert!(
            matches!(new(bad), Err(AppError::BadRequest(_))),
            "{bad:?} must be a 400"
        );
    }
}

#[tokio::test]
async fn routing_without_valhalla_is_service_unavailable() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let stops = [(21.0, 105.8), (10.8, 106.7)];
    let errors = [
        st.routing.directions("auto", "vi", &stops).await.err(),
        st.routing.matrix("auto", &stops, &stops).await.err(),
        st.routing.isochrone("auto", stops[0], &[15]).await.err(),
    ];
    for err in errors {
        let err = err.expect("unconfigured routing fails");
        assert!(matches!(err, AppError::ServiceUnavailable(_)), "{err:?}");
        assert_eq!(
            err.into_response().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
    Ok(())
}

// ── Trip detail ─────────────────────────────────────────────────

#[tokio::test]
async fn the_trip_detail_names_the_cities_and_labels_unknown_amenities_by_key() -> anyhow::Result<()>
{
    let st = boot_state().await?;
    let operator = brand(&st, "Nhà xe Cảng").await?;
    let route_id = route(&st, "Hà Nội - Hải Phòng", operator, "ha-noi", "hai-phong").await?;
    let address = |name: &str, lat: f64, lon: f64| UpsertAddressRequest {
        brand_id: Some(operator),
        name: Some(name.into()),
        lat: Some(lat),
        lon: Some(lon),
        ..Default::default()
    };
    let start = st
        .admin
        .create_address(&address("Bến xe Giáp Bát", 20.9806, 105.8414))
        .await?
        .id;
    let end = st
        .admin
        .create_address(&address("Bến xe Niệm Nghĩa", 20.84, 106.687))
        .await?
        .id;
    // Only the first stop's address says which city it is in.
    st.db
        .execute(Statement::from_sql_and_values(
            st.db.get_database_backend(),
            "UPDATE address SET city_id = ? WHERE id = ?",
            ["ha-noi".into(), start.into()],
        ))
        .await?;
    let point = |address_id| UpsertSchedulePointItem {
        address_id: Some(address_id),
        arrival_time: None,
    };
    st.admin
        .create_schedule(&UpsertScheduleRequest {
            route_id: Some(route_id),
            departure_time: Some("06:00".into()),
            days_of_week: Some("1111111".into()),
            vehicle_type_id: Some(limousine(&st).await?),
            base_price_adult: Some(150_000),
            amenities: Some("wifi,jacuzzi".into()),
            points: Some(vec![point(start), point(end)]),
            ..Default::default()
        })
        .await?;

    let found = st
        .public
        .search_trips(
            "Hà Nội",
            "Hải Phòng",
            &opts(Sort::Departure, Filters::default()),
        )
        .await?;
    let labels: Vec<_> = found
        .facets
        .as_ref()
        .unwrap()
        .amenities
        .iter()
        .map(|a| (a.key.as_str(), a.label.as_str()))
        .collect();
    assert_eq!(labels, [("wifi", "WiFi"), ("jacuzzi", "jacuzzi")]);

    let (status, detail) = get(&st, &format!("/api/trips/{}", found.items[0].trip_id)).await?;
    assert_eq!(status, StatusCode::OK, "{detail}");
    assert_eq!(detail["from"]["cityId"], "ha-noi");
    assert_eq!(detail["to"]["cityId"], "hai-phong");
    assert_eq!(detail["amenities"][0]["label"], "WiFi");
    assert_eq!(detail["amenities"][1]["label"], "jacuzzi");
    let points = detail["schedulePoints"].as_array().unwrap();
    assert_eq!(points.len(), 2);
    assert_eq!(points[0]["cityId"], "ha-noi");
    assert!(points[1].get("cityId").is_none(), "{}", points[1]);
    Ok(())
}

// ── Brand profile ───────────────────────────────────────────────

fn day(offset: i64) -> String {
    (chrono::NaiveDate::parse_from_str(&trip_time::local_today(), "%Y-%m-%d").unwrap()
        + chrono::Duration::days(offset))
    .format("%Y-%m-%d")
    .to_string()
}

/// Materialize the trips of `date` the way a search does.
async fn open_day(st: &AppState, date: &str) -> anyhow::Result<()> {
    let options = Options::new(
        date,
        Some(1),
        None,
        Sort::Departure,
        None,
        None,
        Filters::default(),
    )?;
    st.public
        .search_trips("Hà Nội", "Đà Nẵng", &options)
        .await?;
    Ok(())
}

#[tokio::test]
async fn a_brand_page_is_answered_in_one_read_for_active_brands_only() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let gone = st
        .admin
        .create_brand(&UpsertBrandRequest {
            name: Some("Đã đóng".into()),
            slug: Some("da-dong".into()),
            ..Default::default()
        })
        .await?
        .id;
    deactivate(&st, gone).await?;
    let (status, _) = get(&st, "/api/brands/da-dong/profile").await?;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = get(&st, "/api/brands/nobody/profile").await?;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let operator = st
        .admin
        .create_brand(&UpsertBrandRequest {
            name: Some("Sao Việt".into()),
            slug: Some("sao-viet".into()),
            description: Some("Xe giường nằm".into()),
            contact_phone: Some("0900000000".into()),
            ..Default::default()
        })
        .await?
        .id;
    let other = brand(&st, "Khác").await?;
    let limo = limousine(&st).await?;
    let to_da_nang = route(&st, "Hà Nội - Đà Nẵng", operator, "ha-noi", "da-nang").await?;
    // Every weekday but one that is not tomorrow: it runs tomorrow.
    let tomorrow = chrono::NaiveDate::parse_from_str(&day(1), "%Y-%m-%d")?;
    let rests = (tomorrow.weekday().num_days_from_monday() + 3) % 7;
    let pattern: String = (0..7).map(|d| if d == rests { '0' } else { '1' }).collect();
    st.admin
        .create_schedule(&UpsertScheduleRequest {
            route_id: Some(to_da_nang),
            departure_time: Some("06:00".into()),
            days_of_week: Some(pattern.clone()),
            vehicle_type_id: Some(limo),
            base_price_adult: Some(300_000),
            ..Default::default()
        })
        .await?;
    schedule(&st, to_da_nang, "21:00", 250_000).await?;
    // A closed window never departs again.
    st.admin
        .create_schedule(&UpsertScheduleRequest {
            route_id: Some(to_da_nang),
            departure_time: Some("12:00".into()),
            effective_to: Some(day(-1)),
            base_price_adult: Some(100_000),
            ..Default::default()
        })
        .await?;
    // Another route of the brand, closed; one without a schedule; another
    // brand's.
    let closed = route(&st, "Hà Nội - Hải Phòng", operator, "ha-noi", "hai-phong").await?;
    st.admin
        .update_route(
            closed,
            &UpsertRouteRequest {
                status: Some("inactive".into()),
                ..Default::default()
            },
        )
        .await?;
    route(&st, "Không lịch", operator, "ha-noi", "hue").await?;
    let theirs = route(&st, "Hà Nội - Đà Nẵng", other, "ha-noi", "da-nang").await?;
    schedule(&st, theirs, "07:00", 100_000).await?;

    // Locations: by city then name in Vietnamese order; reviews: approved only.
    for (name, province) in [("Văn phòng B", "Huế"), ("Văn phòng A", "Hà Nội")] {
        st.admin
            .create_address(&UpsertAddressRequest {
                brand_id: Some(operator),
                name: Some(name.into()),
                address: Some("1 Hàng Bài".into()),
                lat: Some(21.0),
                lon: Some(105.8),
                province: Some(province.into()),
                ..Default::default()
            })
            .await?;
    }
    st.admin
        .create_address(&UpsertAddressRequest {
            brand_id: Some(other),
            name: Some("Không phải".into()),
            lat: Some(1.0),
            lon: Some(1.0),
            ..Default::default()
        })
        .await?;
    for (brand_id, status) in [
        (operator, "approved"),
        (operator, "pending"),
        (other, "approved"),
    ] {
        backend::entity::review::ActiveModel {
            id: Set(Uuid::new_v4()),
            brand_id: Set(Some(brand_id)),
            rating: Set(5),
            status: Set(status.into()),
            helpful_count: Set(0),
            created_at: Set("2026-01-01T00:00:00Z".into()),
            updated_at: Set("2026-01-01T00:00:00Z".into()),
            ..Default::default()
        }
        .insert(st.db.as_ref())
        .await?;
    }

    // The page never creates trips: until a search opens a day, none.
    let (status, empty) = get(&st, "/api/brands/sao-viet/profile").await?;
    assert_eq!(status, StatusCode::OK, "{empty}");
    assert_eq!(empty["trips"], serde_json::json!([]));
    open_day(&st, &day(1)).await?;
    open_day(&st, &day(5)).await?; // beyond the window

    let (_, page) = get(&st, "/api/brands/sao-viet/profile").await?;
    let brand_json = &page["brand"];
    assert_eq!(brand_json["slug"], "sao-viet");
    assert_eq!(brand_json["name"], "Sao Việt");
    assert_eq!(brand_json["description"], "Xe giường nằm");
    assert_eq!(brand_json["contactPhone"], "0900000000");
    assert_eq!(brand_json["reviewCount"], 1);
    for absent in ["logoUrl", "contactEmail", "rating"] {
        assert!(
            brand_json[absent].is_null(),
            "{absent} is null, not omitted"
        );
    }

    let location_names: Vec<_> = page["locations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| (l["name"].as_str().unwrap(), l["city"].as_str().unwrap()))
        .collect();
    assert_eq!(
        location_names,
        [("Văn phòng A", "Hà Nội"), ("Văn phòng B", "Huế")]
    );

    let routes = page["routes"].as_array().unwrap();
    let route_names: Vec<_> = routes.iter().map(|r| r["name"].as_str().unwrap()).collect();
    assert_eq!(route_names, ["Hà Nội - Đà Nẵng", "Không lịch"]);
    let da_nang = &routes[0];
    assert_eq!(da_nang["id"], to_da_nang.to_string());
    assert_eq!(da_nang["priceFrom"], 250_000);
    assert_eq!(da_nang["from"]["name"], "Hà Nội");
    assert_ne!(da_nang["to"]["lat"], 0.0);
    let timetable: Vec<_> = da_nang["schedules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["departureTime"].as_str().unwrap(),
                s["priceAdult"].as_i64().unwrap(),
                s["vehicleType"].as_str(),
                s["daysOfWeek"].as_str(),
            )
        })
        .collect();
    assert_eq!(
        timetable,
        [
            ("06:00", 300_000, Some("Limousine"), Some(pattern.as_str())),
            ("21:00", 250_000, Some("Limousine"), Some("1111111")),
        ]
    );
    assert!(routes[1]["priceFrom"].is_null());
    assert_eq!(routes[1]["schedules"], serde_json::json!([]));

    // Tomorrow's two trips only (not the other brand's, not day 5).
    let trips = page["trips"].as_array().unwrap();
    let listed: Vec<_> = trips
        .iter()
        .map(|t| {
            (
                t["date"].as_str().unwrap(),
                t["departureTime"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        listed,
        [(day(1).as_str(), "06:00"), (day(1).as_str(), "21:00")]
    );
    assert_eq!(trips[0]["routeId"], to_da_nang.to_string());
    assert_eq!(trips[0]["vehicleType"], "Limousine");
    assert_eq!(trips[0]["priceAdult"], 300_000);
    Ok(())
}

#[tokio::test]
async fn a_brand_page_lists_at_most_60_locations_40_trips_and_3_days() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let operator = st
        .admin
        .create_brand(&UpsertBrandRequest {
            name: Some("Nhà xe Lớn".into()),
            slug: Some("nha-xe-lon".into()),
            ..Default::default()
        })
        .await?
        .id;
    let route_id = route(&st, "Hà Nội - Đà Nẵng", operator, "ha-noi", "da-nang").await?;
    // 25 daily departures: 50 trips tomorrow and the day after alone.
    for i in 0..25 {
        schedule(
            &st,
            route_id,
            &format!("{:02}:{:02}", i / 2, (i % 2) * 30),
            300_000,
        )
        .await?;
    }
    for offset in 0..=3 {
        open_day(&st, &day(offset)).await?;
    }
    for i in 0..65 {
        st.admin
            .create_address(&UpsertAddressRequest {
                brand_id: Some(operator),
                name: Some(format!("Điểm {i:02}")),
                lat: Some(21.0),
                lon: Some(105.8),
                province: Some("Hà Nội".into()),
                ..Default::default()
            })
            .await?;
    }

    let (status, page) = get(&st, "/api/brands/nha-xe-lon/profile").await?;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["locations"].as_array().unwrap().len(), 60);
    let trips = page["trips"].as_array().unwrap();
    assert_eq!(trips.len(), 40);
    let keys: Vec<String> = trips
        .iter()
        .map(|t| {
            format!(
                "{}{}",
                t["date"].as_str().unwrap(),
                t["departureTime"].as_str().unwrap()
            )
        })
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted, "soonest first");
    let last = day(2);
    assert!(
        trips
            .iter()
            .all(|t| t["date"].as_str().unwrap() <= last.as_str()),
        "nothing after day 3"
    );
    Ok(())
}

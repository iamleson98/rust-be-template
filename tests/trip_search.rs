//! Trip search through the service graph: the direction of a city
//! search, the results page's filters and their counts (on the server,
//! over every match), the coordinate search boarding at a schedule's own
//! stops, and prices of trips whose seats were not created yet.

use backend::dto::admin::{
    UpsertAddressRequest, UpsertBrandRequest, UpsertBusLayoutRequest, UpsertRouteRequest,
    UpsertSchedulePointItem, UpsertScheduleRequest,
};
use backend::dto::fares::SeatClassFare;
use backend::service::seat_plan_presets;
use backend::service::trip_search::{Filters, Options, Sort};

async fn boot_state() -> anyhow::Result<backend::state::AppState> {
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
    });
    backend::server::bootstrap().await
}

/// Two days ahead: no trip has left yet, whatever the time of day.
fn travel_date() -> String {
    (chrono::Utc::now() + chrono::Duration::days(2))
        .format("%Y-%m-%d")
        .to_string()
}

fn opts(sort: Sort, depart_after: Option<&str>, filters: Filters) -> Options {
    Options::new(
        &travel_date(),
        Some(20),
        Some(0),
        sort,
        Some(1),
        depart_after,
        filters,
    )
    .expect("valid options")
}

async fn brand(st: &backend::state::AppState, name: &str) -> anyhow::Result<uuid::Uuid> {
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
    st: &backend::state::AppState,
    name: &str,
    brand: uuid::Uuid,
    from: &str,
    to: &str,
) -> anyhow::Result<uuid::Uuid> {
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

async fn limousine(st: &backend::state::AppState) -> anyhow::Result<uuid::Uuid> {
    st.admin
        .list_vehicle_types(Some("limousine"), Some(1), 0)
        .await?
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))
}

async fn schedule(
    st: &backend::state::AppState,
    route_id: uuid::Uuid,
    at: &str,
    price: i64,
    amenities: Option<&str>,
) -> anyhow::Result<()> {
    st.admin
        .create_schedule(&UpsertScheduleRequest {
            route_id: Some(route_id),
            departure_time: Some(at.into()),
            days_of_week: Some("1111111".into()),
            vehicle_type_id: Some(limousine(st).await?),
            base_price_adult: Some(price),
            amenities: amenities.map(str::to_string),
            ..Default::default()
        })
        .await?;
    Ok(())
}

#[tokio::test]
async fn a_city_search_keeps_its_direction_and_filters_every_match() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let (an, binh) = (
        brand(&st, "Nhà xe An").await?,
        brand(&st, "Nhà xe Bình").await?,
    );
    let an_route = route(&st, "Hà Nội - Đà Nẵng", an, "ha-noi", "da-nang").await?;
    schedule(&st, an_route, "07:00", 300_000, Some("wifi,water")).await?;
    schedule(&st, an_route, "19:00", 320_000, None).await?;
    let binh_route = route(&st, "Hà Nội - Đà Nẵng", binh, "ha-noi", "da-nang").await?;
    schedule(&st, binh_route, "13:00", 450_000, None).await?;
    // Named the other way round, but runs Đà Nẵng → Hà Nội.
    let back = route(&st, "Hà Nội - Đà Nẵng (chiều về)", an, "da-nang", "ha-noi").await?;
    schedule(&st, back, "09:00", 280_000, None).await?;

    let search = |o: Options| {
        let public = st.public.clone();
        async move { public.search_trips("Hà Nội", "Đà Nẵng", &o).await }
    };

    // Only the trips that go Hà Nội → Đà Nẵng, earliest first.
    let all = search(opts(Sort::Departure, None, Filters::default())).await?;
    let times: Vec<_> = all
        .items
        .iter()
        .map(|t| t.departure_time.clone().unwrap())
        .collect();
    assert_eq!(times, ["07:00", "13:00", "19:00"]);
    let back_trips = st
        .public
        .search_trips(
            "Đà Nẵng",
            "Hà Nội",
            &opts(Sort::Departure, None, Filters::default()),
        )
        .await?;
    assert_eq!(
        back_trips.total,
        Some(1),
        "the way back finds only the way back"
    );
    assert_eq!(back_trips.items[0].route_id, back);

    // The filter options count every match.
    let facets = all.facets.expect("facets");
    let brands: Vec<_> = facets
        .brands
        .iter()
        .map(|b| (b.label.as_str(), b.count))
        .collect();
    assert_eq!(brands, [("Nhà xe An", 2), ("Nhà xe Bình", 1)]);
    let hours: Vec<_> = facets
        .hours
        .iter()
        .map(|h| (h.key.as_str(), h.count))
        .collect();
    assert_eq!(hours, [("0-6", 0), ("6-12", 1), ("12-18", 1), ("18-24", 1)]);
    assert_eq!((facets.price_min, facets.price_max), (300_000, 450_000));

    // A filter sees every match, not one page: Bình's only trip is the
    // second by time, yet a one-trip page filtered to Bình finds it.
    let binh_slug = facets.brands[1].key.clone();
    let only_binh = Options {
        limit: 1,
        ..opts(
            Sort::Departure,
            None,
            Filters {
                brands: vec![binh_slug],
                ..Default::default()
            },
        )
    };
    let page = search(only_binh).await?;
    assert_eq!(page.total, Some(1));
    assert_eq!(page.items[0].departure_time.as_deref(), Some("13:00"));
    assert_eq!(
        page.facets.unwrap().brands.len(),
        2,
        "options stay complete"
    );

    let cheap = Filters {
        price_max: Some(320_000),
        ..Default::default()
    };
    assert_eq!(
        search(opts(Sort::Departure, None, cheap)).await?.total,
        Some(2)
    );
    let afternoon = Filters {
        hours: vec![(12, 18)],
        ..Default::default()
    };
    let found = search(opts(Sort::Departure, None, afternoon)).await?;
    assert_eq!(found.items[0].departure_time.as_deref(), Some("13:00"));
    let wifi = Filters {
        amenities: vec!["wifi".into()],
        ..Default::default()
    };
    assert_eq!(
        search(opts(Sort::Departure, None, wifi)).await?.total,
        Some(1)
    );

    // Sorted by price over every match.
    let by_price = search(opts(Sort::Price, None, Filters::default())).await?;
    let prices: Vec<_> = by_price.items.iter().map(|t| t.min_price).collect();
    assert_eq!(prices, [300_000, 320_000, 450_000]);
    Ok(())
}

#[tokio::test]
async fn a_coordinate_search_boards_at_the_schedules_own_stop_and_time() -> anyhow::Result<()> {
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
    let midway = st
        .admin
        .create_address(&address("Điểm đón Long Biên", 21.0430, 105.8790))
        .await?
        .id;
    let end = st
        .admin
        .create_address(&address("Bến xe Niệm Nghĩa", 20.8400, 106.6870))
        .await?
        .id;
    let point = |id: uuid::Uuid, at: Option<&str>| UpsertSchedulePointItem {
        address_id: Some(id),
        arrival_time: at.map(str::to_string),
    };
    st.admin
        .create_schedule(&UpsertScheduleRequest {
            route_id: Some(route_id),
            departure_time: Some("06:00".into()),
            days_of_week: Some("1111111".into()),
            vehicle_type_id: Some(limousine(&st).await?),
            base_price_adult: Some(150_000),
            points: Some(vec![
                point(start, None),
                point(midway, Some("06:40")),
                point(end, Some("08:30")),
            ]),
            ..Default::default()
        })
        .await?;

    // The customer is near Long Biên, going to near Niệm Nghĩa.
    let (near_long_bien, near_niem_nghia) = ((21.0440, 105.8800), (20.8410, 106.6880));
    let geo = |from, to, after: Option<&'static str>| {
        let public = st.public.clone();
        async move {
            public
                .search_trips_geo(
                    from,
                    to,
                    5.0,
                    &opts(Sort::Distance, after, Filters::default()),
                )
                .await
        }
    };

    let found = geo(near_long_bien, near_niem_nghia, None).await?;
    assert_eq!(found.total, Some(1));
    let trip = &found.items[0];
    let pickup = trip.pickup.as_ref().expect("pickup");
    assert_eq!(pickup.name, "Điểm đón Long Biên");
    assert_eq!(pickup.time.as_deref(), Some("06:40"));
    assert!(pickup.distance_km < 1.0, "{}", pickup.distance_km);
    assert_eq!(trip.dropoff.as_ref().unwrap().name, "Bến xe Niệm Nghĩa");

    // "Leaving after" is when the bus reaches the customer, not when it
    // left its first stop (06:00).
    assert_eq!(
        geo(near_long_bien, near_niem_nghia, Some("06:30"))
            .await?
            .total,
        Some(1)
    );
    assert_eq!(
        geo(near_long_bien, near_niem_nghia, Some("07:00"))
            .await?
            .total,
        Some(0)
    );
    // The bus does not go the other way.
    assert_eq!(
        geo(near_niem_nghia, near_long_bien, None).await?.total,
        Some(0)
    );
    Ok(())
}

#[tokio::test]
async fn trips_are_priced_from_their_fares_until_opened_then_get_their_seats() -> anyhow::Result<()>
{
    let st = boot_state().await?;
    // A 9-seat limousine whose first two seats are VIP.
    let mut plan = seat_plan_presets::find("limo_9").expect("preset").plan;
    for cell in plan.decks[0]
        .cells
        .iter_mut()
        .filter(|c| c.kind.is_sellable())
        .take(2)
    {
        cell.seat_class = Some("vip".into());
    }
    let layout = st
        .admin
        .create_bus_layout(&UpsertBusLayoutRequest {
            name: Some("Limo 9 VIP".into()),
            vehicle_type: Some("limousine".into()),
            plan: Some(plan),
            ..Default::default()
        })
        .await?
        .id;
    let operator = brand(&st, "Nhà xe Tây").await?;
    let route_id = route(&st, "Sài Gòn - Cần Thơ", operator, "ho-chi-minh", "can-tho").await?;
    st.admin
        .create_schedule(&UpsertScheduleRequest {
            route_id: Some(route_id),
            departure_time: Some("21:00".into()),
            days_of_week: Some("1111111".into()),
            bus_layout_id: Some(layout),
            base_price_adult: Some(200_000),
            class_fares: Some(vec![SeatClassFare {
                seat_class: "vip".into(),
                price_adult: 300_000,
                price_child: None,
            }]),
            ..Default::default()
        })
        .await?;

    let found = st
        .public
        .search_trips(
            "Sài Gòn",
            "Cần Thơ",
            &opts(Sort::Departure, None, Filters::default()),
        )
        .await?;
    let trip = &found.items[0];
    assert_eq!((trip.min_price, trip.max_price), (200_000, 300_000));
    assert_eq!(trip.available_seats, 9);

    // Opening the trip creates its seats, priced by class.
    let detail = st.public.trip_detail(trip.trip_id).await?;
    let mut fares: Vec<_> = detail
        .pricing
        .fares
        .iter()
        .map(|f| (f.price_adult, f.seats, f.available))
        .collect();
    fares.sort();
    assert_eq!(fares, [(200_000, 7, 7), (300_000, 2, 2)]);
    Ok(())
}

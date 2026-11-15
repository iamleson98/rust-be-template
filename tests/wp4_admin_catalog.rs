//! Admin catalog parity: address cities, the address and bus-layout
//! lists, and the audit fixes for partial updates (omitted fields are
//! kept, `null` clears), coordinate checks and atomic schedule writes.
//!
//! Request bodies are parsed from JSON, as the routes receive them, so
//! "left out" and "sent as `null`" stay distinguishable.

use backend::dto::admin::{
    UpsertAddressRequest, UpsertBrandRequest, UpsertBusLayoutRequest, UpsertPickupPointRequest,
    UpsertRouteRequest, UpsertScheduleRequest,
};
use backend::error::AppError;
use backend::state::AppState;
use sea_orm::{ConnectionTrait, EntityTrait, PaginatorTrait};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use uuid::Uuid;
use validator::Validate;

/// Boot the full AppState on a fresh in-memory database (the same
/// environment contract as `bus_layouts_admin.rs`).
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
    });
    backend::server::bootstrap().await
}

/// A request body as the route would deserialize it.
fn body<T: DeserializeOwned>(json: Value) -> T {
    serde_json::from_value(json).expect("request body parses")
}

struct Catalog {
    st: AppState,
    brand: Uuid,
    route: Uuid,
}

/// A brand with one route.
async fn catalog() -> anyhow::Result<Catalog> {
    let st = boot_state().await?;
    let brand = st
        .admin
        .create_brand(&UpsertBrandRequest {
            name: Some("Nhà xe thử".into()),
            slug: Some("nha-xe-thu".into()),
            ..Default::default()
        })
        .await?
        .id;
    let route = st
        .admin
        .create_route(&UpsertRouteRequest {
            name: Some("Sài Gòn - Cần Thơ".into()),
            brand_id: Some(brand),
            start_location_id: Some("ho-chi-minh".into()),
            end_location_id: Some("can-tho".into()),
            status: None,
        })
        .await?
        .id;
    Ok(Catalog { st, brand, route })
}

impl Catalog {
    /// A point in Hà Nội unless the JSON overrides it.
    fn address_json(&self, over: Value) -> Value {
        let mut point = json!({
            "brandId": self.brand,
            "name": "Bến xe Mỹ Đình",
            "lat": 21.028,
            "lon": 105.778,
            "cityId": "ha-noi",
        });
        for (key, value) in over.as_object().expect("object") {
            point[key] = value.clone();
        }
        point
    }

    async fn create_address(&self, over: Value) -> Result<Uuid, AppError> {
        let request: UpsertAddressRequest = body(self.address_json(over));
        Ok(self.st.admin.create_address(&request).await?.id)
    }

    async fn address(&self, id: Uuid) -> anyhow::Result<backend::dto::admin::AdminAddressOut> {
        let listed = self
            .st
            .admin
            .list_addresses(&self.brand.to_string(), None, None, 0)
            .await?;
        listed
            .items
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| anyhow::anyhow!("address {id} missing from the list"))
    }

    async fn update_address(&self, id: Uuid, json: Value) -> Result<(), AppError> {
        let request: UpsertAddressRequest = body(json);
        self.st.admin.update_address(id, &request).await?;
        Ok(())
    }

    async fn create_layout(&self, json: Value) -> anyhow::Result<Uuid> {
        let request: UpsertBusLayoutRequest = body(json);
        Ok(self.st.admin.create_bus_layout(&request).await?.id)
    }

    /// A 2×2 sleeper layout; extra fields come from `over`.
    fn layout_json(&self, over: Value) -> Value {
        let mut layout = json!({
            "name": "Giường nằm 4",
            "vehicleType": "sleeper",
            "seatGrid": { "rows": 2, "cols": 2, "floors": 1 },
        });
        for (key, value) in over.as_object().expect("object") {
            layout[key] = value.clone();
        }
        layout
    }

    async fn create_schedule(&self, json: Value) -> Result<Uuid, AppError> {
        let request: UpsertScheduleRequest = body(json);
        Ok(self.st.admin.create_schedule(&request).await?.id)
    }

    async fn update_schedule(&self, id: Uuid, json: Value) -> Result<(), AppError> {
        let request: UpsertScheduleRequest = body(json);
        self.st.admin.update_schedule(id, &request).await?;
        Ok(())
    }

    async fn schedule(&self, id: Uuid) -> anyhow::Result<backend::dto::admin::AdminScheduleOut> {
        let listed = self
            .st
            .admin
            .list_schedules(&self.route.to_string())
            .await?;
        listed
            .items
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| anyhow::anyhow!("schedule {id} missing from the list"))
    }

    async fn vehicle_type(&self, code: &str) -> anyhow::Result<Uuid> {
        self.st
            .admin
            .list_vehicle_types(Some(code), None, 0)
            .await?
            .items
            .iter()
            .find(|v| v.code == code)
            .map(|v| v.id)
            .ok_or_else(|| anyhow::anyhow!("seeded vehicle type {code} missing"))
    }
}

fn is_bad_request(err: &AppError) -> bool {
    matches!(err, AppError::BadRequest(_) | AppError::Validation(_))
}

// ── Addresses ────────────────────────────────────────────────────

#[tokio::test]
async fn address_create_requires_one_of_our_cities_and_derives_the_province() -> anyhow::Result<()>
{
    let c = catalog().await?;

    for city in [json!(null), json!(" "), json!("atlantis"), json!("Hà Nội")] {
        let err = c
            .create_address(json!({ "cityId": city, "province": "Đà Nẵng" }))
            .await
            .expect_err("a missing or unknown city must be refused");
        assert!(is_bad_request(&err), "{city}: {err:?}");
        assert!(err.to_string().contains("cityId"), "{city}: {err}");
    }
    let mut without_city = c.address_json(json!({}));
    without_city
        .as_object_mut()
        .expect("object")
        .remove("cityId");
    let request: UpsertAddressRequest = body(without_city);
    let err =
        c.st.admin
            .create_address(&request)
            .await
            .expect_err("cityId is required");
    assert!(err.to_string().contains("cityId"), "{err}");

    // A posted province is ignored: the city's name always wins.
    let id = c
        .create_address(json!({ "province": "Đà Nẵng" }))
        .await
        .expect("created");
    let out = c.address(id).await?;
    assert_eq!(out.city_id.as_deref(), Some("ha-noi"));
    assert_eq!(out.province.as_deref(), Some("Hà Nội"));

    let wire = serde_json::to_value(&out)?;
    assert_eq!(wire["cityId"], "ha-noi");
    assert_eq!(wire["stopCount"], 0);
    Ok(())
}

#[tokio::test]
async fn address_update_changes_the_city_only_to_one_of_ours_and_keeps_it_otherwise(
) -> anyhow::Result<()> {
    let c = catalog().await?;
    let id = c.create_address(json!({})).await.expect("created");

    let err = c
        .update_address(id, json!({ "cityId": "atlantis" }))
        .await
        .expect_err("an unknown city must be refused");
    assert!(is_bad_request(&err), "{err:?}");

    c.update_address(id, json!({ "name": "Mỹ Đình" })).await?;
    let out = c.address(id).await?;
    assert_eq!(out.name, "Mỹ Đình");
    assert_eq!(out.city_id.as_deref(), Some("ha-noi"));
    assert_eq!(out.province.as_deref(), Some("Hà Nội"));

    c.update_address(id, json!({ "cityId": "da-nang" })).await?;
    let out = c.address(id).await?;
    assert_eq!(out.city_id.as_deref(), Some("da-nang"));
    assert_eq!(out.province.as_deref(), Some("Đà Nẵng"));
    Ok(())
}

#[tokio::test]
async fn address_update_clears_a_blank_detail_keeps_one_not_sent_and_rejects_an_empty_name(
) -> anyhow::Result<()> {
    let c = catalog().await?;
    let id = c
        .create_address(json!({
            "address": "1 Phạm Hùng",
            "district": "Nam Từ Liêm",
            "ward": "Mỹ Đình 2",
        }))
        .await
        .expect("created");

    // Blank text and `null` both clear; a field left out is kept.
    c.update_address(
        id,
        json!({ "address": "  ", "district": null, "ward": "Mỹ Đình 1" }),
    )
    .await?;
    let out = c.address(id).await?;
    assert_eq!(out.address, None);
    assert_eq!(out.district, None);
    assert_eq!(out.ward.as_deref(), Some("Mỹ Đình 1"));

    c.update_address(id, json!({ "lat": 21.03 })).await?;
    assert_eq!(c.address(id).await?.ward.as_deref(), Some("Mỹ Đình 1"));

    let blank = c
        .update_address(id, json!({ "name": " " }))
        .await
        .expect_err("a blank name must be refused");
    assert!(is_bad_request(&blank), "{blank:?}");
    let empty: UpsertAddressRequest = body(json!({ "name": "" }));
    assert!(empty.validate().is_err(), "an empty name fails validation");
    assert_eq!(c.address(id).await?.name, "Bến xe Mỹ Đình");
    Ok(())
}

#[tokio::test]
async fn address_list_counts_schedule_stops_and_delete_is_refused_while_one_stops_there(
) -> anyhow::Result<()> {
    let c = catalog().await?;
    let first = c.create_address(json!({ "name": "A" })).await.expect("a");
    let last = c.create_address(json!({ "name": "B" })).await.expect("b");
    let free = c.create_address(json!({ "name": "C" })).await.expect("c");
    c.create_schedule(json!({
        "routeId": c.route,
        "departureTime": "08:00",
        "basePriceAdult": 150_000,
        "points": [{ "addressId": first }, { "addressId": last }, { "addressId": first }],
    }))
    .await
    .expect("schedule");

    let listed =
        c.st.admin
            .list_addresses(&c.brand.to_string(), None, None, 0)
            .await?;
    let counts: Vec<_> = listed
        .items
        .iter()
        .map(|a| (a.name.as_str(), a.stop_count))
        .collect();
    assert_eq!(
        counts,
        [("A", Some(2)), ("B", Some(1)), ("C", Some(0))],
        "stopCount is per stop, address names order the list"
    );

    let err =
        c.st.admin
            .delete_address(first)
            .await
            .expect_err("an address used by a schedule must stay");
    assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    assert_eq!(
        axum::response::IntoResponse::into_response(err).status(),
        409
    );
    assert_eq!(c.address(first).await?.id, first);

    c.st.admin.delete_address(free).await?;
    assert!(
        c.address(free).await.is_err(),
        "an unused address is deleted"
    );
    Ok(())
}

#[tokio::test]
async fn schedule_stops_carry_their_address_city() -> anyhow::Result<()> {
    let c = catalog().await?;
    let hanoi = c
        .create_address(json!({ "name": "Hà Nội" }))
        .await
        .expect("a");
    let danang = c
        .create_address(json!({ "name": "Đà Nẵng", "cityId": "da-nang" }))
        .await
        .expect("b");
    let id = c
        .create_schedule(json!({
            "routeId": c.route,
            "departureTime": "08:00",
            "basePriceAdult": 150_000,
            "points": [{ "addressId": hanoi }, { "addressId": danang }],
        }))
        .await
        .expect("schedule");

    let wire = serde_json::to_value(c.schedule(id).await?)?;
    let cities: Vec<_> = wire["points"]
        .as_array()
        .expect("points")
        .iter()
        .map(|p| p["address"]["cityId"].as_str().expect("cityId"))
        .collect();
    assert_eq!(cities, ["ha-noi", "da-nang"]);
    assert!(
        wire["points"][0]["address"].get("stopCount").is_none(),
        "stopCount is list-only"
    );
    Ok(())
}

// ── Bus layouts ──────────────────────────────────────────────────

#[tokio::test]
async fn bus_layout_list_adds_the_shared_catalog_only_when_asked() -> anyhow::Result<()> {
    let c = catalog().await?;
    let own = c
        .create_layout(c.layout_json(json!({ "name": "Của hãng", "brandId": c.brand })))
        .await?;
    let shared = c
        .create_layout(c.layout_json(json!({ "name": "Dùng chung" })))
        .await?;
    let brand = c.brand.to_string();

    let only_own =
        c.st.admin
            .list_bus_layouts(Some(&brand), false, None, 0)
            .await?;
    assert_eq!(only_own.total, Some(1));
    assert_eq!(only_own.items.len(), 1);
    assert_eq!(only_own.items[0].id, own);

    // The seeded catalog is shared too, so the brand's view is larger.
    let both =
        c.st.admin
            .list_bus_layouts(Some(&brand), true, None, 0)
            .await?;
    assert_eq!(both.total, Some(both.items.len() as u64));
    assert!(both.items.iter().any(|l| l.id == own));
    assert!(both.items.iter().any(|l| l.id == shared));
    assert!(
        both.items
            .iter()
            .all(|l| l.brand_id.is_none_or(|b| b == c.brand)),
        "no other brand's layout is listed"
    );
    Ok(())
}

#[tokio::test]
async fn bus_layout_update_keeps_an_omitted_brand_and_null_makes_it_shared() -> anyhow::Result<()> {
    let c = catalog().await?;
    let id = c
        .create_layout(c.layout_json(json!({ "brandId": c.brand })))
        .await?;
    let brand_of = |id: Uuid| {
        let st = &c.st;
        async move { Ok::<_, anyhow::Error>(st.admin.get_bus_layout(id).await?.brand_id) }
    };

    let rename: UpsertBusLayoutRequest = body(json!({ "name": "Đổi tên" }));
    c.st.admin.update_bus_layout(id, &rename).await?;
    assert_eq!(brand_of(id).await?, Some(c.brand), "brand kept");
    let detail = c.st.admin.get_bus_layout(id).await?;
    assert_eq!(detail.name.as_deref(), Some("Đổi tên"));
    assert_eq!(
        detail.vehicle_type.as_deref(),
        Some("sleeper"),
        "class kept"
    );

    let unbrand: UpsertBusLayoutRequest = body(json!({ "brandId": null, "vehicleType": null }));
    c.st.admin.update_bus_layout(id, &unbrand).await?;
    let detail = c.st.admin.get_bus_layout(id).await?;
    assert_eq!(detail.brand_id, None, "null makes it shared");
    assert_eq!(detail.vehicle_type, None, "null clears the class");
    assert_eq!(detail.name.as_deref(), Some("Đổi tên"));
    Ok(())
}

// ── Schedules ────────────────────────────────────────────────────

#[tokio::test]
async fn schedule_update_keeps_an_omitted_layout_and_vehicle_type() -> anyhow::Result<()> {
    let c = catalog().await?;
    let layout = c.create_layout(c.layout_json(json!({}))).await?;
    let sleeper = c.vehicle_type("sleeper").await?;
    let id = c
        .create_schedule(json!({
            "routeId": c.route,
            "departureTime": "08:00",
            "basePriceAdult": 150_000,
            "busLayoutId": layout,
            "amenities": "[\"wifi\"]",
        }))
        .await
        .expect("schedule");
    let before = c.schedule(id).await?;
    assert_eq!(before.bus_layout_id, Some(layout));
    assert_eq!(before.vehicle_type_id, Some(sleeper));

    c.update_schedule(
        id,
        json!({ "departureTime": "09:30", "basePriceAdult": 160_000 }),
    )
    .await?;
    let after = c.schedule(id).await?;
    assert_eq!(after.departure_time, "09:30");
    assert_eq!(after.base_price_adult, 160_000);
    assert_eq!(after.bus_layout_id, Some(layout), "layout kept");
    assert_eq!(after.vehicle_type_id, Some(sleeper), "vehicle type kept");
    assert_eq!(
        after.amenities.as_deref(),
        Some("[\"wifi\"]"),
        "amenities kept"
    );

    // `null` (what the schedule form sends for "no layout") unlinks it;
    // the vehicle class stays as it was.
    c.update_schedule(id, json!({ "busLayoutId": null, "amenities": null }))
        .await?;
    let unlinked = c.schedule(id).await?;
    assert_eq!(unlinked.bus_layout_id, None);
    assert_eq!(unlinked.vehicle_type_id, Some(sleeper));
    assert_eq!(unlinked.amenities, None);
    Ok(())
}

#[tokio::test]
async fn schedule_update_keeps_omitted_points_and_fares_and_replaces_given_ones(
) -> anyhow::Result<()> {
    let c = catalog().await?;
    let a = c.create_address(json!({ "name": "A" })).await.expect("a");
    let b = c.create_address(json!({ "name": "B" })).await.expect("b");
    let id = c
        .create_schedule(json!({
            "routeId": c.route,
            "departureTime": "08:00",
            "basePriceAdult": 150_000,
            "classFares": [{ "seatClass": "vip", "priceAdult": 250_000 }],
            "points": [{ "addressId": a }, { "addressId": b }],
        }))
        .await
        .expect("schedule");

    c.update_schedule(id, json!({ "basePriceAdult": 155_000 }))
        .await?;
    let kept = c.schedule(id).await?;
    assert_eq!(kept.points.len(), 2);
    assert_eq!(kept.class_fares.len(), 1);

    c.update_schedule(
        id,
        json!({ "points": [{ "addressId": b }, { "addressId": a }] }),
    )
    .await?;
    let swapped = c.schedule(id).await?;
    let stops: Vec<_> = swapped.points.iter().map(|p| p.address_id).collect();
    assert_eq!(stops, [b, a]);
    assert_eq!(swapped.class_fares.len(), 1, "fares not sent are kept");
    Ok(())
}

#[tokio::test]
async fn schedule_row_stops_and_fares_are_written_atomically() -> anyhow::Result<()> {
    use backend::entity::{schedule, schedule_point};

    let c = catalog().await?;
    let a = c.create_address(json!({ "name": "A" })).await.expect("a");
    let b = c.create_address(json!({ "name": "B" })).await.expect("b");
    let id = c
        .create_schedule(json!({
            "routeId": c.route,
            "departureTime": "08:00",
            "basePriceAdult": 150_000,
            "points": [{ "addressId": a }, { "addressId": b }],
        }))
        .await
        .expect("schedule");
    let schedules_before = schedule::Entity::find().count(c.st.db.as_ref()).await?;

    // Fares are the last write of the transaction; make it fail.
    c.st.db
        .execute_unprepared(
            "CREATE TRIGGER refuse_fares BEFORE INSERT ON schedule_fare \
             BEGIN SELECT RAISE(ABORT, 'fares refused'); END",
        )
        .await?;

    let create = c
        .create_schedule(json!({
            "routeId": c.route,
            "departureTime": "10:00",
            "basePriceAdult": 150_000,
            "classFares": [{ "seatClass": "vip", "priceAdult": 250_000 }],
            "points": [{ "addressId": a }, { "addressId": b }],
        }))
        .await;
    assert!(create.is_err(), "the failing fare insert fails the create");
    assert_eq!(
        schedule::Entity::find().count(c.st.db.as_ref()).await?,
        schedules_before,
        "no schedule row survives a failed create"
    );
    assert_eq!(
        schedule_point::Entity::find()
            .count(c.st.db.as_ref())
            .await?,
        2,
        "no stops of the failed schedule survive"
    );

    let update = c
        .update_schedule(
            id,
            json!({
                "departureTime": "11:00",
                "classFares": [{ "seatClass": "vip", "priceAdult": 250_000 }],
                "points": [{ "addressId": b }, { "addressId": a }],
            }),
        )
        .await;
    assert!(update.is_err(), "the failing fare insert fails the update");
    let unchanged = c.schedule(id).await?;
    assert_eq!(unchanged.departure_time, "08:00", "the row is rolled back");
    let stops: Vec<_> = unchanged.points.iter().map(|p| p.address_id).collect();
    assert_eq!(stops, [a, b], "the old stops survive a failed update");
    Ok(())
}

// ── Routes and pickup points ─────────────────────────────────────

#[tokio::test]
async fn route_update_keeps_an_omitted_brand() -> anyhow::Result<()> {
    let c = catalog().await?;
    let rename: UpsertRouteRequest = body(json!({ "name": "Sài Gòn - Mỹ Tho" }));
    c.st.admin.update_route(c.route, &rename).await?;

    let listed =
        c.st.admin
            .list_routes(Some(&c.brand.to_string()), None, None, None, None, 0)
            .await?;
    let route = listed
        .items
        .iter()
        .find(|r| r.id == c.route)
        .expect("route still listed under its brand");
    assert_eq!(route.brand_id, Some(c.brand));
    assert_eq!(route.name, "Sài Gòn - Mỹ Tho");
    assert_eq!(route.start_location_id, "ho-chi-minh");
    Ok(())
}

#[tokio::test]
async fn pickup_point_coordinates_are_range_checked_and_updates_keep_omitted_fields(
) -> anyhow::Result<()> {
    let c = catalog().await?;
    let create = |json: Value| {
        let request: UpsertPickupPointRequest = body(json);
        let st = &c.st;
        async move { st.admin.create_pickup_point(&request).await }
    };
    let point = |over: Value| {
        let mut point = json!({
            "routeId": c.route,
            "name": "Ngã tư Thủ Đức",
            "address": "Xa lộ Hà Nội",
            "lat": 10.85,
            "lon": 106.77,
            "stopOrder": 2,
            "kind": "curb",
        });
        for (key, value) in over.as_object().expect("object") {
            point[key] = value.clone();
        }
        point
    };

    for (lat, lon) in [
        (91.0, 106.77),
        (-90.5, 106.77),
        (10.85, 181.0),
        (10.85, -180.5),
    ] {
        let err = create(point(json!({ "lat": lat, "lon": lon })))
            .await
            .expect_err("an impossible point must be refused");
        assert!(is_bad_request(&err), "{lat},{lon}: {err:?}");
    }
    let err = create(point(json!({ "routeId": Uuid::new_v4() })))
        .await
        .expect_err("an unknown route must be refused");
    assert!(is_bad_request(&err), "{err:?}");

    let id = create(point(json!({}))).await?.id;
    let bad: UpsertPickupPointRequest = body(json!({ "lon": 200.0 }));
    let err =
        c.st.admin
            .update_pickup_point(id, &bad)
            .await
            .expect_err("an update must be range checked too");
    assert!(is_bad_request(&err), "{err:?}");

    let rename: UpsertPickupPointRequest = body(json!({ "name": "Ngã tư", "address": "" }));
    c.st.admin.update_pickup_point(id, &rename).await?;
    let listed = c.st.admin.list_pickup_points(&c.route.to_string()).await?;
    let stored = listed.items.iter().find(|p| p.id == id).expect("listed");
    assert_eq!(stored.name.as_deref(), Some("Ngã tư"));
    assert_eq!(stored.address, None, "a blank address is cleared");
    assert_eq!(stored.lat, Some(10.85), "coordinates kept");
    assert_eq!(stored.stop_order, 2, "order kept");
    assert_eq!(stored.kind.as_deref(), Some("curb"), "kind kept");
    Ok(())
}

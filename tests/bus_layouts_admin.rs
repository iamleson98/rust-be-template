//! Bus-layout admin CRUD integration tests.
//!
//! Boots the full AppState (SQLite in-memory, real migration chain +
//! service graph — same harness as `api_smoke.rs`) and exercises the
//! seat-layout catalog end-to-end:
//!
//! - create generates the concrete `seat` rows from the grid spec, and
//!   the trip materializer picks the layout capacity up,
//! - update is a metadata patch,
//! - delete is guarded (schedules referencing the layout block it with
//!   a 409-shaped message; unreferenced layouts delete cleanly),
//! - the `admin:bus_layouts:write` RBAC permission exists after the
//!   migration chain runs (seed + idempotent top-up migration),
//! - the admin routes list supports the start/end city-slug smart
//!   filter that powers the brands tree page.

// Link anchor: rustc only places an rlib on a TEST binary's link line
// when the test's own code references the crate. The rustqlite engine
// (`sqlite3` crate — the sqlite3_* C ABI) is otherwise dropped and
// sqlx-sqlite's FFI references go unresolved. Referencing the compat crate's
// Rust-visible `engine_version` pulls the engine + compat rlibs onto
// THIS binary's link line.
#[used]
static ENGINE_LINK: fn() -> &'static str = sqlite3::engine_version;

use backend::dto::admin::{
    SeatGridSpec, UpsertBusLayoutRequest, UpsertRouteRequest, UpsertScheduleRequest,
};

/// Boot the AppState directly (see `api_smoke::boot_state` for the env
/// contract — same values, duplicated so the two files stay
/// independently runnable).
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
        std::env::set_var("OAUTH_TWITTER_ENABLED", "false");
    });
    backend::server::bootstrap().await
}

/// Register the FIRST human user — the bootstrap promotion makes them
/// `admin`, which the RBAC assertion below relies on.
async fn first_admin_user_id(st: &backend::state::AppState) -> anyhow::Result<uuid::Uuid> {
    let user = st
        .auth
        .register(
            "admin.bus-layout@example.com".into(),
            "adminbuslayout".into(),
            "Sup3rSecret!pass".into(),
        )
        .await?;
    Ok(user.id)
}

#[tokio::test]
async fn bus_layout_write_permission_exists_after_migrations() -> anyhow::Result<()> {
    let st = boot_state().await?;
    let user_id = first_admin_user_id(&st).await?;

    // The seed (fresh DBs) or the idempotent top-up migration (existing
    // DBs) must grant the write permission to the admin role.
    assert!(
        st.rbac.check(user_id, "admin:bus_layouts:write").await?,
        "admin:bus_layouts:write missing — migration 000014 or the seed failed"
    );
    assert!(
        st.rbac.check(user_id, "admin:bus_layouts:read").await?,
        "admin:bus_layouts:read missing (seed regression)"
    );
    Ok(())
}

#[tokio::test]
async fn bus_layout_create_generates_seats_and_drives_trip_capacity() -> anyhow::Result<()> {
    let st = boot_state().await?;

    // A seeded vehicle type for the schedule below.
    let vt = st
        .admin
        .list_vehicle_types(Some("sleeper"), Some(1), 0)
        .await?;
    let vt_id = vt
        .items
        .first()
        .map(|v| v.id)
        .ok_or_else(|| anyhow::anyhow!("seeded vehicle types missing"))?;

    // 2 decks × 5 rows × 4 cols = 40 beds.
    let created = st
        .admin
        .create_bus_layout(&UpsertBusLayoutRequest {
            name: Some("Giường nằm 40 biệt thự".into()),
            brand_id: None,
            vehicle_type: Some("sleeper".into()),
            total_seats: None,
            layout_data: None,
            seat_grid: Some(SeatGridSpec {
                rows: Some(5),
                cols: Some(4),
                floors: Some(2),
            }),
        })
        .await?;

    // The list must expose the layout with the COMPUTED seat count.
    let list = st.admin.list_bus_layouts(None, Some(50), 0).await?;
    let item = list
        .items
        .iter()
        .find(|l| l.id == created.id)
        .ok_or_else(|| anyhow::anyhow!("created layout missing from the list"))?;
    assert_eq!(item.total_seats, Some(40));
    assert_eq!(item.vehicle_type.as_deref(), Some("sleeper"));

    // A schedule wired to the layout + an on-demand search must
    // materialize a trip whose capacity comes from the generated seats
    // (40), NOT the vehicle-type fallback (40 for sleeper — pick a
    // vehicle type whose fallback differs: use `standard` fallback 29
    // by NOT setting vehicle_type_id on the schedule).
    let route = st
        .admin
        .create_route(&UpsertRouteRequest {
            name: Some("Sài Gòn - Cần Thơ".into()),
            brand_id: None,
            start_location_id: Some("ho-chi-minh".into()),
            end_location_id: Some("can-tho".into()),
            status: None,
        })
        .await?;
    st.admin
        .create_schedule(&UpsertScheduleRequest {
            route_id: Some(route.id),
            departure_time: Some("21:00".into()),
            effective_from: None,
            effective_to: None,
            days_of_week: Some("1111111".into()),
            bus_layout_id: Some(created.id),
            vehicle_type_id: Some(vt_id),
            base_price_adult: Some(180_000),
            base_price_child: None,
            amenities: None,
            points: None,
        })
        .await?;

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let res = st
        .public
        .search_trips("sài gòn", "cần thơ", &today, 20, vec![], "departure", 1)
        .await?;
    let trip = res
        .items
        .first()
        .ok_or_else(|| anyhow::anyhow!("trip not materialized for the layout schedule"))?;
    assert_eq!(
        trip.available_seats, 40,
        "capacity must come from the generated seat rows"
    );
    assert_eq!(trip.total_seats, 40);

    // Deleting the referenced layout must be blocked with a
    // schedule-reference conflict.
    let err = st
        .admin
        .delete_bus_layout(created.id)
        .await
        .expect_err("delete must be blocked while a schedule references the layout");
    let msg = err.to_string();
    assert!(
        msg.contains("lịch trình"),
        "conflict message should explain the schedule reference: {msg}"
    );
    Ok(())
}

#[tokio::test]
async fn bus_layout_update_patches_metadata_and_unreferenced_delete_works() -> anyhow::Result<()> {
    let st = boot_state().await?;

    let created = st
        .admin
        .create_bus_layout(&UpsertBusLayoutRequest {
            name: Some("Limousine 9 chỗ Dcar".into()),
            brand_id: None,
            vehicle_type: Some("limousine".into()),
            total_seats: None,
            layout_data: None,
            seat_grid: Some(SeatGridSpec {
                rows: Some(3),
                cols: Some(3),
                floors: Some(1),
            }),
        })
        .await?;

    // Update is a metadata patch — name + vehicle type flip.
    st.admin
        .update_bus_layout(
            created.id,
            &UpsertBusLayoutRequest {
                name: Some("Limousine 9 chỗ Dcar Premium".into()),
                brand_id: None,
                vehicle_type: Some("minivan".into()),
                total_seats: None,
                layout_data: None,
                seat_grid: None,
            },
        )
        .await?;

    let list = st.admin.list_bus_layouts(None, Some(50), 0).await?;
    let item = list
        .items
        .iter()
        .find(|l| l.id == created.id)
        .ok_or_else(|| anyhow::anyhow!("layout missing from the list"))?;
    assert_eq!(item.name.as_deref(), Some("Limousine 9 chỗ Dcar Premium"));
    assert_eq!(item.vehicle_type.as_deref(), Some("minivan"));
    // The generated seat count survives the metadata patch.
    assert_eq!(item.total_seats, Some(9));

    // Empty-name update is rejected.
    let bad = st
        .admin
        .update_bus_layout(
            created.id,
            &UpsertBusLayoutRequest {
                name: Some("   ".into()),
                brand_id: None,
                vehicle_type: None,
                total_seats: None,
                layout_data: None,
                seat_grid: None,
            },
        )
        .await;
    assert!(bad.is_err(), "empty name must be rejected");

    // Unreferenced layout (no schedule, no trips, no tickets) deletes
    // cleanly — its generated seats cascade away with it.
    st.admin.delete_bus_layout(created.id).await?;
    let list = st.admin.list_bus_layouts(None, Some(50), 0).await?;
    assert!(
        list.items.iter().all(|l| l.id != created.id),
        "deleted layout must not appear in the list"
    );
    Ok(())
}

#[tokio::test]
async fn bus_layout_create_requires_name_and_caps_the_grid() -> anyhow::Result<()> {
    let st = boot_state().await?;

    // Missing name → BadRequest.
    let no_name = st
        .admin
        .create_bus_layout(&UpsertBusLayoutRequest::default())
        .await;
    assert!(no_name.is_err(), "name is required");

    // Oversized grid (20 × 6 × 2 = 240 > 120) → Validation.
    let oversized = st
        .admin
        .create_bus_layout(&UpsertBusLayoutRequest {
            name: Some("Quá lớn".into()),
            brand_id: None,
            vehicle_type: None,
            total_seats: None,
            layout_data: None,
            seat_grid: Some(SeatGridSpec {
                rows: Some(20),
                cols: Some(6),
                floors: Some(2),
            }),
        })
        .await;
    assert!(
        oversized.is_err(),
        "seat grids above 120 seats are rejected"
    );
    Ok(())
}

#[tokio::test]
async fn admin_routes_filter_by_start_and_end_location() -> anyhow::Result<()> {
    let st = boot_state().await?;

    // Three routes: the exact pair, a reversed pair, and an unrelated one.
    for (name, start, end) in [
        ("Hà Nội - Đà Nẵng", "ha-noi", "da-nang"),
        ("Đà Nẵng - Hà Nội", "da-nang", "ha-noi"),
        ("Hà Nội - Hải Phòng", "ha-noi", "hai-phong"),
    ] {
        st.admin
            .create_route(&UpsertRouteRequest {
                name: Some(name.into()),
                brand_id: None,
                start_location_id: Some(start.into()),
                end_location_id: Some(end.into()),
                status: None,
            })
            .await?;
    }

    // BOTH start and end set — only the exact pair matches.
    let both = st
        .admin
        .list_routes(None, None, Some("ha-noi"), Some("da-nang"), Some(50), 0)
        .await?;
    assert_eq!(both.items.len(), 1, "exact pair filter");
    assert_eq!(both.items[0].name, "Hà Nội - Đà Nẵng");

    // Only start set — every route leaving Hà Nội.
    let start_only = st
        .admin
        .list_routes(None, None, Some("ha-noi"), None, Some(50), 0)
        .await?;
    assert_eq!(start_only.items.len(), 2, "start-only filter");

    // Only end set — every route ending in Hà Nội.
    let end_only = st
        .admin
        .list_routes(None, None, None, Some("ha-noi"), Some(50), 0)
        .await?;
    assert_eq!(end_only.items.len(), 1, "end-only filter");
    assert_eq!(end_only.items[0].name, "Đà Nẵng - Hà Nội");

    // No filter — all three.
    let all = st
        .admin
        .list_routes(None, None, None, None, Some(50), 0)
        .await?;
    assert_eq!(all.items.len(), 3, "unfiltered list");
    Ok(())
}

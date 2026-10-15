//! `backend layouts-canonicalize` — collapse per-brand layout copies onto
//! the global canonical catalog.
//!
//! Imported catalogs re-created the same physical bus once per brand
//! ("Limousine 24 phòng" × 36 brands, "Giường nằm 40" × 24, …). This
//! command:
//!
//!   1. seeds the canonical global catalog ([`layout_catalog`]) — only
//!      when applying; a dry run must not write,
//!   2. re-points every schedule whose layout confidently identifies as
//!      a canonical bus — `bus_layout_id` AND `vehicle_type_id` follow
//!      the canonical row's class,
//!   3. deletes the per-brand layouts (and their seat rows) once
//!      nothing references them.
//!
//! `--reset-trips` also drops the trip sessions (and their seat
//! inventories) of re-pointed schedules so the seat maps regenerate
//! from the canonical layout on next view — safe only while those
//! trips carry no bookings; the warmer refills the sell window.
//!
//! Layouts that cannot be confidently identified (no preset matches
//! the name / class / size, or their seats are only partially
//! VIP-classed) are kept as per-brand customs and reported.
//!
//! Dry run by default; `--apply` writes. Run it while the backend is
//! quiet (single writer on SQLite).

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Context;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    Set,
};
use uuid::Uuid;

use crate::cli::util::db_connect;
use crate::config::Config;
use crate::entity::{bus_layout, schedule, seat, seat_inventory, trip_session};
use crate::service::layout_catalog::{canonical_by_key, ensure_canonical_layouts};
use crate::service::seat_plan_presets;
use crate::store::{
    DbScheduleStore, DbTripStore, DbVehicleTypeStore, ScheduleStore, TripStore, VehicleTypeStore,
};

pub async fn run(apply: bool, reset_trips: bool) -> anyhow::Result<()> {
    let cfg = Config::load().context("loading config")?;
    let db = Arc::new(db_connect(&cfg).await?);
    let schedules = DbScheduleStore::new(db.clone());
    let trips = DbTripStore::new(db.clone());
    let vehicle_types = DbVehicleTypeStore::new(db.clone());

    // ── 1. canonical catalog ─────────────────────────────────────
    // A dry run never writes: it reads whatever global rows exist
    // (the backend seeds them at boot) and reports the gap.
    let canonical_rows = if apply {
        ensure_canonical_layouts(&db)
            .await
            .context("seeding the canonical catalog")?
    } else {
        bus_layout::Entity::find()
            .filter(bus_layout::Column::BrandId.is_null())
            .all(db.as_ref())
            .await
            .context("listing global layouts")?
    };
    let canonical = canonical_by_key(&canonical_rows);
    println!(
        "canonical catalog: {} global row(s), {} of the known keys present{}",
        canonical_rows.len(),
        canonical.len(),
        if apply {
            ""
        } else {
            " (dry run: seeding happens with --apply)"
        }
    );

    // `code → id` for the vehicle-type catalog — re-pointed schedules
    // follow the canonical class.
    let vt_id_by_code: HashMap<String, Uuid> = vehicle_types
        .list_active_vehicle_types()
        .await
        .context("listing vehicle types")?
        .into_iter()
        .map(|vt| (vt.code.to_lowercase(), vt.id))
        .collect();
    let vt_code_by_id: HashMap<Uuid, String> = vt_id_by_code
        .iter()
        .map(|(code, id)| (*id, code.clone()))
        .collect();

    // ── 2. verdicts for every per-brand layout ───────────────────
    let layouts = schedules
        .list_bus_layouts()
        .await
        .context("listing layouts")?;

    let mut repointed_layouts = 0usize;
    let mut repointed_schedules = 0usize;
    let mut class_moves: HashMap<(String, String), usize> = HashMap::new();
    let mut deleted_layouts = 0usize;
    let mut deleted_seats = 0usize;
    let mut reset_trips_count = 0usize;
    let mut custom_count = 0usize;
    let mut kept_busy = 0usize;

    for layout in &layouts {
        if layout.brand_id.is_none() {
            continue; // canonical or already-global rows
        }
        let seats = trips
            .list_seats_by_bus_layout_id(&layout.id.to_string())
            .await
            .context("listing seats")?;
        let name = layout.name.as_deref().unwrap_or("(unnamed)");

        // VIP is a whole-layout trait: every seat classed vip (the fare
        // class VIP limousines price). A partial split is a genuine
        // per-brand differentiation — keep the layout as a custom.
        let vip = !seats.is_empty() && seats.iter().all(|s| s.seat_class.as_deref() == Some("vip"));

        let Some(preset_id) =
            seat_plan_presets::infer_id(name, layout.vehicle_type.as_deref(), seats.len())
        else {
            custom_count += 1;
            println!(
                "keep  {}  {name} ({} seats): no preset match",
                layout.id,
                seats.len()
            );
            continue;
        };

        let key = (preset_id.clone(), vip);
        let Some(canonical_row) = canonical.get(&key) else {
            custom_count += 1;
            println!(
                "keep  {}  {name} ({} seats): {preset_id}{} identified but no canonical row",
                layout.id,
                seats.len(),
                if vip { " VIP" } else { "" }
            );
            continue;
        };

        // The schedules wired to this layout move to the canonical row.
        let wired: Vec<schedule::Model> = schedule::Entity::find()
            .filter(schedule::Column::BusLayoutId.eq(layout.id))
            .all(db.as_ref())
            .await
            .context("listing wired schedules")?;
        let new_vt = canonical_row
            .vehicle_type
            .as_deref()
            .and_then(|code| vt_id_by_code.get(&code.to_lowercase()).copied());

        if apply {
            for sched in &wired {
                // Optionally drop the schedule's trips first so their
                // inventories cannot dangle off the deleted seats.
                if reset_trips {
                    reset_trips_count += delete_trips_of(db.as_ref(), sched.id).await?;
                }
                let mut active: schedule::ActiveModel = sched.clone().into();
                active.bus_layout_id = Set(Some(canonical_row.id));
                if let Some(vt) = new_vt {
                    active.vehicle_type_id = Set(Some(vt));
                }
                active
                    .update(db.as_ref())
                    .await
                    .with_context(|| format!("re-pointing schedule {}", sched.id))?;
            }
        }

        repointed_schedules += wired.len();
        for sched in &wired {
            if let (Some(old_vt), Some(new_code)) =
                (sched.vehicle_type_id, canonical_row.vehicle_type.as_deref())
            {
                let old_code = vt_code_by_id
                    .get(&old_vt)
                    .cloned()
                    .unwrap_or_else(|| "?".into());
                *class_moves
                    .entry((old_code, new_code.to_lowercase()))
                    .or_default() += 1;
            }
        }
        repointed_layouts += 1;

        // Delete the per-brand copy (seats first — the engine's FK
        // cascade is not relied upon).
        if apply {
            let still_wired = schedule::Entity::find()
                .filter(schedule::Column::BusLayoutId.eq(layout.id))
                .count(db.as_ref())
                .await
                .context("checking remaining references")?;
            if still_wired > 0 {
                kept_busy += 1;
                println!(
                    "keep  {}  {name}: {still_wired} schedule(s) could not move",
                    layout.id
                );
                continue;
            }
            let live_inventory = schedules
                .count_seat_inventory_by_bus_layout(layout.id)
                .await
                .context("counting live seat inventory")?;
            let sold = schedules
                .count_booking_seats_by_bus_layout(layout.id)
                .await
                .context("counting sold tickets")?;
            if live_inventory + sold > 0 {
                kept_busy += 1;
                println!(
                    "keep  {}  {name}: live seat inventory ({live_inventory}) or sold tickets ({sold})",
                    layout.id
                );
                continue;
            }
            let seat_rows = seat::Entity::delete_many()
                .filter(seat::Column::BusLayoutId.eq(layout.id))
                .exec(db.as_ref())
                .await
                .context("deleting layout seats")?;
            deleted_seats += seat_rows.rows_affected as usize;
            bus_layout::Entity::delete_by_id(layout.id)
                .exec(db.as_ref())
                .await
                .context("deleting layout")?;
            deleted_layouts += 1;
        }
        println!(
            "{}  {}  {name} ({} seats) → {} [{} schedule(s)]",
            if apply { "done " } else { "plan " },
            layout.id,
            seats.len(),
            canonical_row
                .name
                .as_deref()
                .unwrap_or("(unnamed canonical)"),
            wired.len()
        );
    }

    // ── 3. report ────────────────────────────────────────────────
    println!();
    println!(
        "layouts: {} per-brand → {} re-pointed, {} deleted, {} kept busy, {} custom",
        layouts.iter().filter(|l| l.brand_id.is_some()).count(),
        repointed_layouts,
        deleted_layouts,
        kept_busy,
        custom_count
    );
    println!(
        "schedules re-pointed: {repointed_schedules}; seats deleted: {deleted_seats}; trips reset: {reset_trips_count}"
    );
    if !class_moves.is_empty() {
        println!("vehicle-class moves (facet changes):");
        let mut moves: Vec<_> = class_moves.iter().collect();
        moves.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        for ((from, to), n) in moves {
            println!("  {from} → {to}: {n} schedule(s)");
        }
    }
    if !apply {
        println!("dry run — nothing changed; re-run with --apply to write.");
    }
    Ok(())
}

/// Delete a schedule's trip sessions and their seat inventories —
/// the lazy seat path regenerates both from the NEW layout on next
/// view. Row-at-a-time deletes: the engine's bulk paths are not
/// trusted (see rust-sql issue #8) and this is a one-shot op.
async fn delete_trips_of(db: &DatabaseConnection, schedule_id: Uuid) -> anyhow::Result<usize> {
    let trips: Vec<trip_session::Model> = trip_session::Entity::find()
        .filter(trip_session::Column::ScheduleId.eq(schedule_id))
        .all(db)
        .await
        .context("listing trips to reset")?;
    let mut n = 0usize;
    for trip in trips {
        seat_inventory::Entity::delete_many()
            .filter(seat_inventory::Column::TripSessionId.eq(trip.id))
            .exec(db)
            .await
            .context("deleting trip seat inventory")?;
        trip_session::Entity::delete_by_id(trip.id)
            .exec(db)
            .await
            .context("deleting trip session")?;
        n += 1;
    }
    Ok(n)
}

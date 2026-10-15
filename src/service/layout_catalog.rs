//! The global canonical bus-layout catalog.
//!
//! One row per vehicle configuration Vietnamese operators actually run:
//! the physical geometry comes from the seat-plan presets
//! ([`crate::service::seat_plan_presets`]), the row is GLOBAL
//! (`brand_id = NULL`) so every brand shares it, and a "VIP" variant of
//! a seat limousine marks every sellable cell `vip` (the fare class
//! VIP-limousine schedules price).
//!
//! This is the single source of truth for "which bus is this": a
//! schedule points at one canonical layout and its `vehicle_type_id`
//! follows the layout's class. Per-brand copies of these same buses are
//! import artifacts — `backend layouts-canonicalize` collapses them.
//!
//! Seeding is idempotent on the layout NAME (unique among global rows),
//! so it can run at every boot and from the CLI.

use std::collections::HashMap;

use sea_orm::{
    ColumnTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::dto::seat_plan::SeatPlan;
use crate::entity::{bus_layout, seat};
use crate::service::seat_plan::{self, sync_seats};
use crate::service::seat_plan_db;
use crate::service::seat_plan_presets;

/// (preset id, vip) — every canonical layout, in catalog order.
///
/// * the four catalogued sleepers plus the formula sizes seen in real
///   fleets (32 / 36 / 48 berths),
/// * VIP variants of the two seat limousines (the fare class lives on
///   the seats, the geometry is unchanged),
/// * no VIP variants of berths: their classes are `bed_lower` /
///   `bed_upper` by deck and pricing already splits on those.
pub const CANONICAL_PRESETS: &[(&str, bool)] = &[
    ("car_4", false),
    ("car_7", false),
    ("limo_9", false),
    ("limo_9", true),
    ("limo_11", false),
    ("limo_11", true),
    ("minibus_15", false),
    ("seat_29", false),
    ("seat_45", false),
    ("sleeper_38_wc", false),
    ("sleeper_32", false),
    ("sleeper_36", false),
    ("sleeper_40", false),
    ("sleeper_42", false),
    ("sleeper_44", false),
    ("sleeper_46", false),
    ("sleeper_48", false),
    ("limo_bed_34", false),
    ("cabin_24", false),
    ("cabin_22", false),
    ("cabin_22_double", false),
    ("cabin_22_plain", false),
    ("cabin_21", false),
    ("cabin_20", false),
];

/// Canonical display name for a (preset, vip) pair: the preset's own
/// catalog name, with the VIP suffix. Public — the CLI and admin
/// listing reuse it so names never drift apart.
pub fn canonical_name(preset_id: &str, vip: bool) -> Option<String> {
    let preset = seat_plan_presets::find(preset_id)?;
    Some(if vip {
        format!("{} VIP", preset.name)
    } else {
        preset.name.to_string()
    })
}

/// The plan a canonical layout stores: the preset's plan, with every
/// sellable cell classed `vip` for the VIP variants.
fn canonical_plan(preset_id: &str, vip: bool) -> Option<SeatPlan> {
    let mut plan = seat_plan_presets::find(preset_id)?.plan;
    if vip {
        for deck in &mut plan.decks {
            for cell in &mut deck.cells {
                if cell.kind.is_sellable() {
                    cell.seat_class = Some("vip".into());
                }
            }
        }
    }
    Some(plan)
}

/// Insert any canonical layout that does not exist yet (matched on the
/// name among global rows). Returns EVERY canonical row that exists
/// after the pass — existing rows are returned untouched so callers can
/// rely on their ids for re-pointing.
pub async fn ensure_canonical_layouts(
    db: &DatabaseConnection,
) -> Result<Vec<bus_layout::Model>, DbErr> {
    let now = now_iso();
    for &(preset_id, vip) in CANONICAL_PRESETS {
        let Some(name) = canonical_name(preset_id, vip) else {
            tracing::warn!(preset = preset_id, "canonical preset missing from catalog");
            continue;
        };
        let existing = bus_layout::Entity::find()
            .filter(bus_layout::Column::BrandId.is_null())
            .filter(bus_layout::Column::Name.eq(&name))
            .one(db)
            .await?;
        if existing.is_some() {
            continue;
        }
        let Some(plan) = canonical_plan(preset_id, vip) else {
            continue;
        };
        let preset = seat_plan_presets::find(preset_id).expect("checked by canonical_plan");
        let id = Uuid::new_v4();
        // Seat rows and the layout row land together — same shape as the
        // admin create path (`create_bus_layout`).
        let sync = sync_seats(&[], &plan, false)
            .map_err(|e| DbErr::Custom(format!("canonical plan rejected: {e:?}")))?;
        let seats: Vec<_> = sync
            .inserts
            .iter()
            .map(|spec| seat_plan_db::new_seat(id, spec, &now))
            .collect();
        let layout = bus_layout::ActiveModel {
            id: Set(id),
            brand_id: Set(None),
            name: Set(Some(name)),
            vehicle_type: Set(Some(preset.vehicle_type.to_string())),
            total_seats: Set(Some(preset.capacity)),
            layout_data: Set(Some(seat_plan::to_stored(&plan))),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        };
        let txn = db.begin().await?;
        bus_layout::Entity::insert(layout)
            .exec(&txn)
            .await
            .map_err(|e| DbErr::Custom(format!("insert canonical layout: {e}")))?;
        seat::Entity::insert_many(seats)
            .exec(&txn)
            .await
            .map_err(|e| DbErr::Custom(format!("insert canonical seats: {e}")))?;
        txn.commit().await?;
    }

    // Everything that exists now, keyed for re-pointing lookups.
    let rows = bus_layout::Entity::find()
        .filter(bus_layout::Column::BrandId.is_null())
        .all(db)
        .await?;
    Ok(rows)
}

/// Map canonical rows by (preset id, vip) — the key the canonicalize
/// CLI resolves legacy layouts to. Rows whose name does not round-trip
/// through [`canonical_name`] (admin-renamed) still map when their plan
/// matches a preset's stored form; the rest are skipped.
pub fn canonical_by_key(rows: &[bus_layout::Model]) -> HashMap<(String, bool), bus_layout::Model> {
    let mut out = HashMap::new();
    for row in rows {
        for &(preset_id, vip) in CANONICAL_PRESETS {
            if canonical_name(preset_id, vip).as_deref() == row.name.as_deref() {
                out.insert((preset_id.to_string(), vip), row.clone());
                break;
            }
        }
    }
    out
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn seeding_is_idempotent_and_resolves_every_key() {
        use sea_orm_migration::MigratorTrait;
        let store = crate::store::CompositeStore::in_memory().await;
        migrator::Migrator::up(store.db(), None).await.unwrap();

        let first = ensure_canonical_layouts(store.db()).await.unwrap();
        assert_eq!(
            first.len(),
            CANONICAL_PRESETS.len(),
            "one global row per canonical preset"
        );
        // Re-running neither duplicates nor errors.
        let second = ensure_canonical_layouts(store.db()).await.unwrap();
        assert_eq!(first.iter().map(|l| l.id).collect::<Vec<_>>(),
                   second.iter().map(|l| l.id).collect::<Vec<_>>(),
                   "seeding twice keeps the same rows");

        let by_key = canonical_by_key(&second);
        assert_eq!(by_key.len(), CANONICAL_PRESETS.len());
        for &(id, vip) in CANONICAL_PRESETS {
            let row = by_key
                .get(&(id.to_string(), vip))
                .unwrap_or_else(|| panic!("key ({id}, {vip}) missing"));
            assert_eq!(row.brand_id, None, "{id}: canonical rows are global");
            let preset = seat_plan_presets::find(id).unwrap();
            assert_eq!(row.total_seats, Some(preset.capacity), "{id}: capacity");
            assert_eq!(
                row.vehicle_type.as_deref(),
                Some(preset.vehicle_type.as_str()),
                "{id}: class follows the preset"
            );
            // The seat rows exist and carry the right classes.
            let seats = seat::Entity::find()
                .filter(seat::Column::BusLayoutId.eq(row.id))
                .all(store.db())
                .await
                .unwrap();
            assert_eq!(seats.len(), preset.capacity as usize, "{id}: seat rows");
            if vip {
                assert!(seats.iter().all(|s| s.seat_class.as_deref() == Some("vip")));
            }
        }
    }

    #[test]
    fn every_canonical_preset_resolves() {
        for &(id, vip) in CANONICAL_PRESETS {
            let name = canonical_name(id, vip)
                .unwrap_or_else(|| panic!("preset {id} missing from the catalog"));
            let plan = canonical_plan(id, vip).expect("plan builds");
            let preset = seat_plan_presets::find(id).expect("preset exists");
            assert_eq!(
                seat_plan::sellable_count(&plan),
                preset.capacity as usize,
                "{name}: capacity unchanged by the VIP marking"
            );
            seat_plan::validate(&plan).unwrap_or_else(|e| panic!("{name}: {e}"));
            if vip {
                let all_vip = plan
                    .decks
                    .iter()
                    .flat_map(|d| &d.cells)
                    .filter(|c| c.kind.is_sellable())
                    .all(|c| c.seat_class.as_deref() == Some("vip"));
                assert!(all_vip, "{name}: every sellable cell is vip");
            }
        }
    }

    #[test]
    fn canonical_names_are_unique() {
        let mut names: Vec<_> = CANONICAL_PRESETS
            .iter()
            .map(|&(id, vip)| canonical_name(id, vip).unwrap())
            .collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), CANONICAL_PRESETS.len());
    }

    #[test]
    fn canonical_classes_are_catalog_codes() {
        for &(id, _) in CANONICAL_PRESETS {
            let preset = seat_plan_presets::find(id).expect("preset exists");
            assert!(
                matches!(
                    preset.vehicle_type.as_str(),
                    "limousine" | "minivan" | "standard" | "semi_sleeper" | "sleeper"
                ),
                "{}: class {} is not a catalog code",
                id,
                preset.vehicle_type
            );
        }
    }
}

//! Backfill for layouts that predate seat plans: decide which catalog
//! template a legacy layout is, and lay it over the layout's seats —
//! labels and ids untouched, only positions, decks and fixtures change.
//!
//! Pure planning lives here (unit-tested); `backend layouts-normalize`
//! applies the verdicts.

use crate::dto::seat_plan::SeatPlan;
use crate::entity::{bus_layout, seat};
use crate::service::{seat_plan, seat_plan_presets};

#[derive(Debug, PartialEq)]
pub enum Normalization {
    /// A saved plan already matches the seat rows.
    AlreadyPlanned,
    NoSeats,
    /// No catalog template matches the layout's size / name.
    NoTemplate,
    DoesNotFit {
        preset: String,
        reason: String,
    },
    Fitted {
        preset: String,
        plan: SeatPlan,
    },
}

pub fn plan_normalization(layout: &bus_layout::Model, seats: &[seat::Model]) -> Normalization {
    if seats.is_empty() {
        return Normalization::NoSeats;
    }
    if seat_plan::trusted_plan(layout.layout_data.as_deref(), seats).is_some() {
        return Normalization::AlreadyPlanned;
    }
    let name = layout.name.as_deref().unwrap_or_default();
    let Some(id) = seat_plan_presets::infer_id(name, layout.vehicle_type.as_deref(), seats.len())
    else {
        return Normalization::NoTemplate;
    };
    let Some(preset) = seat_plan_presets::find(&id) else {
        return Normalization::NoTemplate;
    };
    match seat_plan::fit_to_seats(&preset.plan, seats) {
        Ok(plan) => Normalization::Fitted { preset: id, plan },
        Err(reason) => Normalization::DoesNotFit { preset: id, reason },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn layout(name: &str, vehicle_type: Option<&str>, data: Option<String>) -> bus_layout::Model {
        bus_layout::Model {
            id: Uuid::new_v4(),
            brand_id: None,
            name: Some(name.into()),
            vehicle_type: vehicle_type.map(str::to_string),
            total_seats: None,
            layout_data: data,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn seat(label: &str, floor: i16, row: i16, col: i16, class: Option<&str>) -> seat::Model {
        seat::Model {
            id: Uuid::new_v4(),
            bus_layout_id: Uuid::nil(),
            seat_label: label.into(),
            seat_class: class.map(str::to_string),
            row_num: Some(row),
            col_num: Some(col),
            is_window: false,
            floor,
            created_at: String::new(),
        }
    }

    /// The imported shape seen in production: one deck, A-beds beside
    /// B-beds (`A01..A21` lower class, `B01..B21` upper class).
    fn flat_sleeper_42() -> Vec<seat::Model> {
        (1..=21)
            .flat_map(|n| {
                [
                    seat(&format!("A{n:02}"), 1, n, 1, Some("bed_lower")),
                    seat(&format!("B{n:02}"), 1, n, 2, Some("bed_upper")),
                ]
            })
            .collect()
    }

    #[test]
    fn a_flat_imported_sleeper_is_split_into_two_real_decks() {
        let seats = flat_sleeper_42();
        let Normalization::Fitted { preset, plan } =
            plan_normalization(&layout("Giường nằm 42", Some("sleeper"), None), &seats)
        else {
            panic!("expected a fitted plan");
        };
        assert_eq!(preset, "sleeper_42");
        assert_eq!(plan.decks.len(), 2);
        // A-beds go to the lower deck in numeric order, B-beds to the upper.
        let lower: Vec<_> = plan.decks[0]
            .cells
            .iter()
            .filter(|c| c.kind.is_sellable())
            .map(|c| c.label.clone().unwrap())
            .collect();
        assert_eq!(lower.first().map(String::as_str), Some("A01"));
        assert_eq!(lower.len(), 21);
        assert!(lower.iter().all(|l| l.starts_with('A')));
        // identity is preserved: every cell points at an existing seat id
        let ids: std::collections::HashSet<_> = seats.iter().map(|s| s.id).collect();
        assert!(plan
            .decks
            .iter()
            .flat_map(|d| &d.cells)
            .filter(|c| c.kind.is_sellable())
            .all(|c| c.seat_id.is_some_and(|id| ids.contains(&id))));
        // and the result is a legal, unchanged-seat-set plan for an in-use layout
        let sync = seat_plan::sync_seats(&seats, &plan, true).expect("same seat set");
        assert!(sync.inserts.is_empty() && sync.deletes.is_empty());
    }

    #[test]
    fn a_layout_that_already_has_a_matching_plan_is_left_alone() {
        let preset = seat_plan_presets::find("sleeper_40").unwrap();
        let sync = seat_plan::sync_seats(&[], &preset.plan, false).unwrap();
        let seats: Vec<seat::Model> = sync
            .inserts
            .iter()
            .map(|s| seat(&s.label, s.floor, s.row, s.col, s.class.as_deref()))
            .collect();
        let l = layout("x", None, Some(seat_plan::to_stored(&preset.plan)));
        assert_eq!(
            plan_normalization(&l, &seats),
            Normalization::AlreadyPlanned
        );
    }

    #[test]
    fn an_unrecognised_size_or_a_seater_posing_as_a_sleeper_is_skipped() {
        let odd: Vec<_> = (1..=33)
            .map(|n| seat(&format!("{n:02}"), 1, n, 1, None))
            .collect();
        assert_eq!(
            plan_normalization(&layout("Ghế ngồi 33", Some("standard"), None), &odd),
            Normalization::NoTemplate
        );
        // 40 plain seats in one deck: size matches sleeper_40 but they cannot be split in decks
        let seater: Vec<_> = (1..=40)
            .map(|n| seat(&format!("{n:02}"), 1, n, 1, None))
            .collect();
        assert!(matches!(
            plan_normalization(&layout("Giường nằm 40", Some("sleeper"), None), &seater),
            Normalization::DoesNotFit { .. }
        ));
        assert_eq!(
            plan_normalization(&layout("empty", None, None), &[]),
            Normalization::NoSeats
        );
    }
}

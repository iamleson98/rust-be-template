//! Ready-made seat plans for the vehicles Vietnamese operators run.
//!
//! The generators here are the single source of truth: the admin UI lists
//! them as "create from template" and `layouts-normalize` fits legacy
//! layouts onto them.
//!
//! Orientation (see `dto::seat_plan`): row 1 is the front, column 1 the
//! driver's side — the left in Vietnam, with the door on the right.
//! Sellable cells are numbered front → rear, left → right: `01…` on a
//! single deck, `A01…` (lower) / `B01…` (upper) on two decks.

use crate::dto::seat_plan::{BusLayoutPreset, CellKind, DeckPlan, PlanCell, SeatPlan};
use crate::service::seat_plan::sellable_count;

use CellKind::{Bed, Cabin, CabinDouble, Door, Driver, Seat, Stairs, Wc};

// ────────────────────────────────────────────────────────────────
//  Catalog
// ────────────────────────────────────────────────────────────────

struct Spec {
    id: &'static str,
    name: &'static str,
    vehicle_type: &'static str,
    description: &'static str,
    build: fn() -> SeatPlan,
}

const CATALOG: &[Spec] = &[
    Spec {
        id: "car_4",
        name: "Xe 4 chỗ",
        vehicle_type: "standard",
        description: "Ghế phụ và hàng ghế sau 3 chỗ (4 khách + tài xế)",
        build: || single_deck(3, &[(1, Driver), (3, Seat)], &[&[1, 2, 3]]),
    },
    Spec {
        id: "car_7",
        name: "Xe 7 chỗ",
        vehicle_type: "standard",
        description: "Ghế phụ, hàng 2 ba chỗ, hàng 3 hai chỗ (6 khách + tài xế)",
        build: || single_deck(3, &[(1, Driver), (3, Seat)], &[&[1, 2, 3], &[1, 3]]),
    },
    Spec {
        id: "limo_9",
        name: "Limousine 9 chỗ",
        vehicle_type: "limousine",
        description: "Hai ghế cạnh tài xế, 2 hàng ghế đơn có lối đi giữa, hàng cuối 3 chỗ",
        build: || {
            single_deck(
                3,
                &[(1, Driver), (2, Seat), (3, Seat)],
                &[&[1, 3], &[1, 3], &[1, 2, 3]],
            )
        },
    },
    Spec {
        id: "limo_11",
        name: "Limousine 11 chỗ",
        vehicle_type: "limousine",
        description:
            "Hai ghế cạnh tài xế, 3 hàng ghế đơn có lối đi giữa, hàng cuối 3 chỗ (xe 12 chỗ)",
        build: || {
            single_deck(
                3,
                &[(1, Driver), (2, Seat), (3, Seat)],
                &[&[1, 3], &[1, 3], &[1, 3], &[1, 2, 3]],
            )
        },
    },
    Spec {
        id: "minibus_15",
        name: "Xe 16 chỗ",
        vehicle_type: "minivan",
        description:
            "Hai ghế cạnh tài xế, 3 hàng 2+1 có lối đi, hàng cuối 4 chỗ (15 khách + tài xế)",
        build: || {
            single_deck(
                4,
                &[(1, Driver), (2, Seat), (3, Seat), (4, Door)],
                &[&[1, 2, 4], &[1, 2, 4], &[1, 2, 4], &[1, 2, 3, 4]],
            )
        },
    },
    Spec {
        id: "seat_29",
        name: "Ghế ngồi 29 chỗ",
        vehicle_type: "standard",
        description: "6 hàng 2+2 và hàng cuối 5 chỗ",
        build: || coach(6),
    },
    Spec {
        id: "seat_45",
        name: "Ghế ngồi 45 chỗ",
        vehicle_type: "standard",
        description: "10 hàng 2+2 và hàng cuối 5 chỗ",
        build: || coach(10),
    },
    Spec {
        id: "sleeper_38_wc",
        name: "Giường nằm 38 (có WC)",
        vehicle_type: "sleeper",
        description: "2 tầng × (5 hàng 3 giường + hàng cuối 4 giường); WC cuối xe tầng dưới",
        build: || sleeper(19, true),
    },
    Spec {
        id: "sleeper_40",
        name: "Giường nằm 40",
        vehicle_type: "sleeper",
        description: "2 tầng × (5 hàng 3 giường + hàng cuối 5 giường)",
        build: || sleeper(20, false),
    },
    Spec {
        id: "sleeper_42",
        name: "Giường nằm 42",
        vehicle_type: "sleeper",
        description: "2 tầng × 7 hàng 3 giường",
        build: || sleeper(21, false),
    },
    Spec {
        id: "sleeper_44",
        name: "Giường nằm 44",
        vehicle_type: "sleeper",
        description: "2 tầng × (6 hàng 3 giường + hàng cuối 4 giường)",
        build: || sleeper(22, false),
    },
    Spec {
        id: "sleeper_46",
        name: "Giường nằm 46",
        vehicle_type: "sleeper",
        description: "2 tầng × (6 hàng 3 giường + hàng cuối 5 giường)",
        build: || sleeper(23, false),
    },
    Spec {
        id: "limo_bed_34",
        name: "Limousine giường 34",
        vehicle_type: "limousine",
        description: "2 tầng × 17 giường, 3 dãy (6 · 5 · 6)",
        build: limo_bed_34,
    },
    Spec {
        id: "cabin_24",
        name: "Limousine 24 phòng",
        vehicle_type: "limousine",
        description: "2 tầng × 6 hàng 2 phòng, lối đi giữa",
        build: || cabin(6, None, 6, None),
    },
    Spec {
        id: "cabin_22",
        name: "Limousine 22 phòng (có WC)",
        vehicle_type: "limousine",
        description: "Tầng dưới 10 phòng + WC cuối xe, tầng trên 12 phòng; lối đi giữa",
        build: || cabin(5, Some(Wc), 6, None),
    },
    Spec {
        id: "cabin_22_double",
        name: "Limousine 22 phòng (1 phòng đôi)",
        vehicle_type: "limousine",
        description: "Mỗi tầng 5 hàng 2 phòng + phòng cuối xe; phòng cuối tầng dưới là phòng đôi",
        build: || cabin(5, Some(CabinDouble), 5, Some(Cabin)),
    },
];

fn preset(
    id: &str,
    name: &str,
    vehicle_type: &str,
    description: &str,
    plan: SeatPlan,
) -> BusLayoutPreset {
    BusLayoutPreset {
        id: id.into(),
        name: name.into(),
        vehicle_type: vehicle_type.into(),
        capacity: sellable_count(&plan) as i16,
        description: description.into(),
        plan,
    }
}

pub fn catalog() -> Vec<BusLayoutPreset> {
    CATALOG
        .iter()
        .map(|s| preset(s.id, s.name, s.vehicle_type, s.description, (s.build)()))
        .collect()
}

/// A catalog preset by id. `sleeper_<n>` additionally resolves for any
/// even `n` in 30–50 (3-lane sleepers beyond the catalogued sizes).
pub fn find(id: &str) -> Option<BusLayoutPreset> {
    if let Some(s) = CATALOG.iter().find(|s| s.id == id) {
        return Some(preset(
            s.id,
            s.name,
            s.vehicle_type,
            s.description,
            (s.build)(),
        ));
    }
    let n: i16 = id.strip_prefix("sleeper_")?.parse().ok()?;
    ((30..=50).contains(&n) && n % 2 == 0).then(|| {
        preset(
            id,
            &format!("Giường nằm {n}"),
            "sleeper",
            "2 tầng, 3 dãy giường",
            sleeper(n / 2, false),
        )
    })
}

/// Pick the preset a legacy layout most plausibly is, from its seat
/// count, name and vehicle type. `None` when nothing fits or the name
/// cannot break a tie.
///
/// Size alone is not enough: 40 plain seats are not a sleeper. Berth
/// templates need a berth hint (sleeper / limousine vehicle type or a
/// "giường", "phòng", "cabin" … name); variants need their own hint — a
/// toilet ("WC") or a double cabin ("đôi").
pub fn infer_id(name: &str, vehicle_type: Option<&str>, seat_count: usize) -> Option<String> {
    let name = name.to_lowercase();
    let says = |words: &[&str]| words.iter().any(|w| name.contains(w));
    let berthy = matches!(vehicle_type, Some("sleeper" | "semi_sleeper" | "limousine"))
        || says(&["giường", "phòng", "cabin", "sleeper", "limousine", "limo"]);
    let (double, wc) = (says(&["đôi", "doi", "double"]), says(&["wc", "vệ sinh"]));

    let fits: Vec<&Spec> = CATALOG
        .iter()
        .filter(|s| {
            let plan = (s.build)();
            let has_berths = plan
                .decks
                .iter()
                .flat_map(|d| &d.cells)
                .any(|c| matches!(c.kind, Bed | Cabin | CabinDouble));
            let compatible = if has_berths {
                berthy
            } else {
                vehicle_type != Some("sleeper")
            };
            compatible
                && sellable_count(&plan) == seat_count
                && (!s.name.contains("WC") || wc)
                && (!s.id.contains("double") || double)
        })
        .collect();
    match fits.as_slice() {
        [only] => Some(only.id.to_string()),
        [] => {
            let id = format!("sleeper_{seat_count}");
            let sleeperish = vehicle_type == Some("sleeper") || says(&["giường"]);
            (sleeperish && find(&id).is_some()).then_some(id)
        }
        _ => None,
    }
}

// ────────────────────────────────────────────────────────────────
//  Builders
// ────────────────────────────────────────────────────────────────

/// One deck under construction. Sellable cells are labelled in call
/// order: `{prefix}{nn}`.
struct DeckBuilder {
    rows: i16,
    cols: i16,
    prefix: &'static str,
    next: u32,
    cells: Vec<PlanCell>,
}

impl DeckBuilder {
    fn new(rows: i16, cols: i16, prefix: &'static str) -> Self {
        Self {
            rows,
            cols,
            prefix,
            next: 1,
            cells: Vec::new(),
        }
    }

    fn cell(mut self, row: i16, col: i16, kind: CellKind) -> Self {
        let label = kind.is_sellable().then(|| {
            let label = format!("{}{:02}", self.prefix, self.next);
            self.next += 1;
            label
        });
        self.cells.push(PlanCell {
            row,
            col,
            kind,
            label,
            seat_class: None,
            seat_id: None,
        });
        self
    }

    fn row(mut self, row: i16, cols: &[i16], kind: CellKind) -> Self {
        for &col in cols {
            self = self.cell(row, col, kind);
        }
        self
    }

    fn build(self) -> DeckPlan {
        DeckPlan {
            name: None,
            rows: self.rows,
            cols: self.cols,
            cells: self.cells,
        }
    }
}

/// One-deck vehicle: a cab row (driver, door, front passengers) followed
/// by seat rows. `cab` is `(col, kind)`; `seat_rows` lists the occupied
/// columns of each row behind the cab, the last one being the rear bench.
fn single_deck(cols: i16, cab: &[(i16, CellKind)], seat_rows: &[&[i16]]) -> SeatPlan {
    let mut deck = DeckBuilder::new(1 + seat_rows.len() as i16, cols, "");
    for &(col, kind) in cab {
        deck = deck.cell(1, col, kind);
    }
    for (i, cols) in seat_rows.iter().enumerate() {
        deck = deck.row(2 + i as i16, cols, Seat);
    }
    SeatPlan {
        decks: vec![deck.build()],
    }
}

/// Seater coach: `rows` rows of 2+2 around a centre aisle plus a 5-seat
/// rear bench; the door sits front-right.
fn coach(rows: usize) -> SeatPlan {
    let row: &[i16] = &[1, 2, 4, 5];
    let mut seat_rows = vec![row; rows];
    seat_rows.push(&[1, 2, 3, 4, 5]);
    single_deck(5, &[(1, Driver), (5, Door)], &seat_rows)
}

/// 3-lane double-decker sleeper with `per_deck` berths on each deck:
/// full rows of three, plus a rear bench of four or five to absorb the
/// remainder (`wc` puts the toilet in the gap of a 4-bed bench on the
/// lower deck). Lower deck is `A`, upper is `B`; the upper deck shows the
/// stair opening where the door is below.
fn sleeper(per_deck: i16, wc: bool) -> SeatPlan {
    let rear: i16 = match per_deck % 3 {
        0 => 0,
        1 => 4,
        _ => 5,
    };
    let full = (per_deck - rear) / 3;
    let bench_row = 2 + full;
    let rows = if rear > 0 { bench_row } else { 1 + full };

    let deck = |upper: bool| {
        let mut d = DeckBuilder::new(rows, 5, if upper { "B" } else { "A" });
        d = if upper {
            d.cell(1, 5, Stairs)
        } else {
            d.cell(1, 1, Driver).cell(1, 5, Door)
        };
        for r in 0..full {
            d = d.row(2 + r, &[1, 3, 5], Bed);
        }
        match rear {
            5 => d = d.row(bench_row, &[1, 2, 3, 4, 5], Bed),
            4 => {
                d = d.row(bench_row, &[1, 2, 4, 5], Bed);
                if wc && !upper {
                    d = d.cell(bench_row, 3, Wc);
                }
            }
            _ => {}
        }
        d.build()
    };
    SeatPlan {
        decks: vec![deck(false), deck(true)],
    }
}

/// Limousine with berths in three lanes (6 · 5 · 6 per deck): the centre
/// lane starts one row back, leaving the stair well clear.
fn limo_bed_34() -> SeatPlan {
    let deck = |upper: bool| {
        let mut d = DeckBuilder::new(7, 5, if upper { "B" } else { "A" });
        d = if upper {
            d.cell(1, 5, Stairs)
        } else {
            d.cell(1, 1, Driver).cell(1, 5, Door)
        };
        for row in 2..=7 {
            d = d.row(row, if row == 2 { &[1, 5] } else { &[1, 3, 5] }, Bed);
        }
        d.build()
    };
    SeatPlan {
        decks: vec![deck(false), deck(true)],
    }
}

/// Cabin limousine: two lanes of single cabins around one aisle.
/// `*_full` rows of two per deck, then an optional centre cell at the
/// rear (a WC, a double cabin or one more cabin).
fn cabin(
    lower_full: i16,
    lower_rear: Option<CellKind>,
    upper_full: i16,
    upper_rear: Option<CellKind>,
) -> SeatPlan {
    let used = |full: i16, rear: Option<CellKind>| full + i16::from(rear.is_some());
    let rows = 1 + used(lower_full, lower_rear).max(used(upper_full, upper_rear));

    let deck = |upper: bool, full: i16, rear: Option<CellKind>| {
        let mut d = DeckBuilder::new(rows, 3, if upper { "B" } else { "A" });
        d = if upper {
            d.cell(1, 3, Stairs)
        } else {
            d.cell(1, 1, Driver).cell(1, 3, Door)
        };
        for r in 0..full {
            d = d.row(2 + r, &[1, 3], Cabin);
        }
        if let Some(kind) = rear {
            d = d.cell(2 + full, 2, kind);
        }
        d.build()
    };
    SeatPlan {
        decks: vec![
            deck(false, lower_full, lower_rear),
            deck(true, upper_full, upper_rear),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::seat_plan::validate;

    fn count(plan: &SeatPlan, deck: usize, kind: CellKind) -> usize {
        plan.decks[deck]
            .cells
            .iter()
            .filter(|c| c.kind == kind)
            .count()
    }

    #[test]
    fn every_preset_is_a_valid_plan_with_its_declared_capacity() {
        let expected = [
            ("car_4", 4),
            ("car_7", 6),
            ("limo_9", 9),
            ("limo_11", 11),
            ("minibus_15", 15),
            ("seat_29", 29),
            ("seat_45", 45),
            ("sleeper_38_wc", 38),
            ("sleeper_40", 40),
            ("sleeper_42", 42),
            ("sleeper_44", 44),
            ("sleeper_46", 46),
            ("limo_bed_34", 34),
            ("cabin_24", 24),
            ("cabin_22", 22),
            ("cabin_22_double", 22),
        ];
        let all = catalog();
        assert_eq!(all.len(), expected.len());
        for (id, capacity) in expected {
            let p = all
                .iter()
                .find(|p| p.id == id)
                .unwrap_or_else(|| panic!("{id} missing"));
            assert_eq!(p.capacity, capacity, "{id} capacity");
            validate(&p.plan).unwrap_or_else(|e| panic!("{id}: {e}"));
            let drivers: usize = (0..p.plan.decks.len())
                .map(|d| count(&p.plan, d, Driver))
                .sum();
            assert_eq!(drivers, 1, "{id} has exactly one driver");
            assert_eq!(
                count(&p.plan, 0, Driver),
                1,
                "{id}: the driver is on the lower deck"
            );
        }
    }

    #[test]
    fn preset_ids_are_unique() {
        let mut ids: Vec<_> = CATALOG.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
    }

    #[test]
    fn sleeper_40_matches_the_real_coach() {
        let p = find("sleeper_40").unwrap().plan;
        assert_eq!(p.decks.len(), 2);
        // cab row + 5 rows of three + a rear bench of five
        assert_eq!((p.decks[0].rows, p.decks[0].cols), (7, 5));
        assert_eq!(count(&p, 0, Bed), 20);
        assert_eq!(count(&p, 1, Bed), 20);
        let rear: Vec<i16> = p.decks[0]
            .cells
            .iter()
            .filter(|c| c.row == 7)
            .map(|c| c.col)
            .collect();
        assert_eq!(rear, vec![1, 2, 3, 4, 5]);
        // A = lower, B = upper; numbering starts at the front-left bed
        let first = p.decks[0].cells.iter().find(|c| c.kind == Bed).unwrap();
        assert_eq!(
            (first.row, first.col, first.label.as_deref()),
            (2, 1, Some("A01"))
        );
        let upper = p.decks[1].cells.iter().find(|c| c.kind == Bed).unwrap();
        assert_eq!(upper.label.as_deref(), Some("B01"));
        assert_eq!(count(&p, 1, Driver), 0, "no driver on the upper deck");
        assert_eq!(count(&p, 1, Stairs), 1);
    }

    #[test]
    fn sleeper_with_wc_puts_the_toilet_on_the_lower_deck_only() {
        let p = find("sleeper_38_wc").unwrap().plan;
        assert_eq!((count(&p, 0, Bed), count(&p, 1, Bed)), (19, 19));
        assert_eq!((count(&p, 0, Wc), count(&p, 1, Wc)), (1, 0));
    }

    #[test]
    fn sleeper_formula_covers_every_even_size() {
        for n in (30..=50).step_by(2) {
            let p = find(&format!("sleeper_{n}")).unwrap_or_else(|| panic!("sleeper_{n}"));
            assert_eq!(p.capacity, n);
            validate(&p.plan).unwrap_or_else(|e| panic!("sleeper_{n}: {e}"));
        }
        assert!(find("sleeper_41").is_none());
        assert!(find("sleeper_52").is_none());
    }

    #[test]
    fn limousine_34_has_three_lanes_of_six_five_six() {
        let p = find("limo_bed_34").unwrap().plan;
        for deck in &p.decks {
            let lane = |col: i16| {
                deck.cells
                    .iter()
                    .filter(|c| c.kind == Bed && c.col == col)
                    .count()
            };
            assert_eq!((lane(1), lane(3), lane(5)), (6, 5, 6));
        }
    }

    #[test]
    fn cabin_variants_split_the_decks_as_documented() {
        let split = |id: &str| {
            let p = find(id).unwrap().plan;
            (
                p.decks[0]
                    .cells
                    .iter()
                    .filter(|c| c.kind.is_sellable())
                    .count(),
                p.decks[1]
                    .cells
                    .iter()
                    .filter(|c| c.kind.is_sellable())
                    .count(),
            )
        };
        assert_eq!(split("cabin_24"), (12, 12));
        assert_eq!(split("cabin_22"), (10, 12));
        assert_eq!(split("cabin_22_double"), (11, 11));
        let wc = find("cabin_22").unwrap().plan;
        assert_eq!(count(&wc, 0, Wc), 1);
        let dbl = find("cabin_22_double").unwrap().plan;
        assert_eq!(
            (count(&dbl, 0, CabinDouble), count(&dbl, 1, CabinDouble)),
            (1, 0)
        );
    }

    #[test]
    fn coaches_and_vans_end_in_a_full_width_rear_bench() {
        let rear_len = |id: &str| {
            let d = &find(id).unwrap().plan.decks[0];
            d.cells.iter().filter(|c| c.row == d.rows).count()
        };
        assert_eq!(rear_len("seat_29"), 5);
        assert_eq!(rear_len("seat_45"), 5);
        assert_eq!(rear_len("minibus_15"), 4);
        assert_eq!(rear_len("limo_9"), 3);
    }

    #[test]
    fn inference_uses_seat_count_and_name_hints() {
        let infer = |name: &str, vt: Option<&str>, n: usize| infer_id(name, vt, n);
        assert_eq!(
            infer("Xe giường nằm 42", Some("sleeper"), 42).as_deref(),
            Some("sleeper_42")
        );
        assert_eq!(
            infer("Giường nằm 36", Some("sleeper"), 36).as_deref(),
            Some("sleeper_36")
        );
        assert_eq!(
            infer("Limousine 24 phòng", None, 24).as_deref(),
            Some("cabin_24")
        );
        assert_eq!(
            infer("Ghế ngồi 29", Some("standard"), 29).as_deref(),
            Some("seat_29")
        );
        assert_eq!(
            infer("Limousine 9 chỗ", Some("limousine"), 9).as_deref(),
            Some("limo_9")
        );

        // variants need their own hint in the name
        assert_eq!(
            infer("Limousine 22 phòng đôi", None, 22).as_deref(),
            Some("cabin_22_double")
        );
        assert_eq!(
            infer("Limousine 22 phòng (WC)", None, 22).as_deref(),
            Some("cabin_22")
        );
        assert_eq!(
            infer("Giường nằm 38 (WC)", Some("sleeper"), 38).as_deref(),
            Some("sleeper_38_wc")
        );
        assert_eq!(
            infer("Giường nằm 38", Some("sleeper"), 38).as_deref(),
            Some("sleeper_38")
        );
        assert_eq!(
            infer("Limousine 22 phòng", None, 22),
            None,
            "a tie the name cannot break"
        );

        // size alone is not enough: plain seats are not berths
        assert_eq!(infer("Ghế ngồi 40", Some("standard"), 40), None);
        assert_eq!(infer("Xe 24", None, 24), None);
        assert_eq!(infer("Ghế ngồi 33", Some("standard"), 33), None);
        assert_eq!(infer("Giường nằm 33", Some("sleeper"), 33), None);
    }
}

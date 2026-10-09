//! Seat-plan logic — storage, validation, and reconciliation with the
//! operational `seat` table.
//!
//! The `seat` table owns ids (trip inventory points at them), so saving a
//! plan never recreates a seat that already exists: [`sync_seats`] maps
//! every sellable cell to an existing row (by id, then by label) and only
//! inserts/deletes what the plan really adds/removes. Once trips sell the
//! seats (`in_use`), adding or removing seats is refused — they can only
//! be moved, relabelled or re-classed.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::dto::seat_plan::{CellKind, DeckPlan, PlanCell, SeatPlan};
use crate::entity::seat;

pub const PLAN_VERSION: u8 = 2;
/// Mirrors the cap `create_bus_layout` has always enforced.
pub const MAX_SEATS: usize = 120;
const MAX_DECKS: usize = 2;
const MAX_ROWS: i16 = 30;
const MAX_COLS: i16 = 9;
/// `seat.seat_label` is `VARCHAR(10)`.
const MAX_LABEL_CHARS: usize = 10;
/// `seat.seat_class` is `VARCHAR(30)`.
const MAX_CLASS_CHARS: usize = 30;
const MAX_DECK_NAME_CHARS: usize = 40;

#[derive(Serialize, Deserialize)]
struct Stored {
    version: u8,
    decks: Vec<DeckPlan>,
}

/// Parse `bus_layout.layout_data`; anything that is not a v2 plan
/// (legacy/empty/garbage) yields `None`.
pub fn parse_stored(raw: Option<&str>) -> Option<SeatPlan> {
    let stored: Stored = serde_json::from_str(raw?).ok()?;
    (stored.version == PLAN_VERSION).then_some(SeatPlan {
        decks: stored.decks,
    })
}

/// Serialize for `layout_data`. Seat ids are operational state, not part
/// of the stored plan.
pub fn to_stored(plan: &SeatPlan) -> String {
    let mut decks = plan.decks.clone();
    for cell in decks.iter_mut().flat_map(|d| d.cells.iter_mut()) {
        cell.seat_id = None;
    }
    serde_json::to_string(&Stored {
        version: PLAN_VERSION,
        decks,
    })
    .expect("a seat plan is always serializable")
}

pub fn sellable_count(plan: &SeatPlan) -> usize {
    plan.decks
        .iter()
        .flat_map(|d| &d.cells)
        .filter(|c| c.kind.is_sellable())
        .count()
}

/// Structural validation. The messages are shown to admins as-is.
pub fn validate(plan: &SeatPlan) -> Result<(), String> {
    if plan.decks.is_empty() || plan.decks.len() > MAX_DECKS {
        return Err(format!("a plan needs 1–{MAX_DECKS} decks"));
    }
    let mut labels = HashSet::new();
    let mut sellable = 0usize;
    for (i, deck) in plan.decks.iter().enumerate() {
        let n = i + 1;
        if !(1..=MAX_ROWS).contains(&deck.rows) || !(1..=MAX_COLS).contains(&deck.cols) {
            return Err(format!(
                "deck {n}: grid must be 1–{MAX_ROWS} rows × 1–{MAX_COLS} columns"
            ));
        }
        if deck
            .name
            .as_deref()
            .is_some_and(|n| n.chars().count() > MAX_DECK_NAME_CHARS)
        {
            return Err(format!(
                "deck {n}: name is longer than {MAX_DECK_NAME_CHARS} characters"
            ));
        }
        let mut positions = HashSet::new();
        let mut drivers = 0;
        for cell in &deck.cells {
            if !(1..=deck.rows).contains(&cell.row) || !(1..=deck.cols).contains(&cell.col) {
                return Err(format!(
                    "deck {n}: cell ({}, {}) is outside the {}×{} grid",
                    cell.row, cell.col, deck.rows, deck.cols
                ));
            }
            if !positions.insert((cell.row, cell.col)) {
                return Err(format!(
                    "deck {n}: two cells at row {}, column {}",
                    cell.row, cell.col
                ));
            }
            if cell.kind == CellKind::Driver {
                drivers += 1;
            }
            if cell.kind.is_sellable() {
                sellable += 1;
                let label = cell.label.as_deref().map(str::trim).unwrap_or_default();
                if label.is_empty() || label.chars().count() > MAX_LABEL_CHARS {
                    return Err(format!(
                        "deck {n}: seat at row {}, column {} needs a label of 1–{MAX_LABEL_CHARS} characters",
                        cell.row, cell.col
                    ));
                }
                if !labels.insert(label.to_lowercase()) {
                    return Err(format!("seat label \"{label}\" is used more than once"));
                }
                if cell
                    .seat_class
                    .as_deref()
                    .is_some_and(|c| c.trim().chars().count() > MAX_CLASS_CHARS)
                {
                    return Err(format!(
                        "seat {label}: class is longer than {MAX_CLASS_CHARS} characters"
                    ));
                }
            }
        }
        if drivers > 1 {
            return Err(format!("deck {n}: only one driver position is allowed"));
        }
    }
    if sellable == 0 {
        return Err("a plan needs at least one seat".into());
    }
    if sellable > MAX_SEATS {
        return Err(format!("seat plan too large — max {MAX_SEATS} seats"));
    }
    Ok(())
}

/// A plain grid for layouts that predate plans, so the editor can open
/// them. Berth classes (`bed_*`) are recognised; no fixtures are invented.
pub fn derive_from_seats(seats: &[seat::Model]) -> SeatPlan {
    let mut sorted: Vec<&seat::Model> = seats.iter().collect();
    sorted.sort_by_key(|s| (s.floor, s.row_num, s.col_num, s.seat_label.clone()));
    let mut decks: Vec<DeckPlan> = Vec::new();
    for deck_no in 1..=MAX_DECKS as i16 {
        let in_deck: Vec<&&seat::Model> = sorted
            .iter()
            .filter(|s| s.floor.clamp(1, MAX_DECKS as i16) == deck_no)
            .collect();
        if in_deck.is_empty() {
            continue;
        }
        // Rows/cols missing on very old seats: fall back to rows of four.
        let placed: Vec<(i16, i16, &seat::Model)> = in_deck
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let row = s.row_num.unwrap_or((i / 4) as i16 + 1).max(1);
                let col = s.col_num.unwrap_or((i % 4) as i16 + 1).max(1);
                (row, col, **s)
            })
            .collect();
        let rows = placed.iter().map(|p| p.0).max().unwrap_or(1).min(MAX_ROWS);
        let cols = placed.iter().map(|p| p.1).max().unwrap_or(1).min(MAX_COLS);
        let cells = placed
            .into_iter()
            .filter(|(r, c, _)| *r <= rows && *c <= cols)
            .map(|(row, col, s)| PlanCell {
                row,
                col,
                kind: if s
                    .seat_class
                    .as_deref()
                    .is_some_and(|c| c.starts_with("bed_"))
                {
                    CellKind::Bed
                } else {
                    CellKind::Seat
                },
                label: Some(s.seat_label.clone()),
                seat_class: s.seat_class.clone(),
                seat_id: Some(s.id),
            })
            .collect();
        decks.push(DeckPlan {
            name: None,
            rows,
            cols,
            cells,
        });
    }
    SeatPlan { decks }
}

/// The stored plan, but only while it still describes the `seat` rows
/// exactly — same labels, on the same decks, in the same cells. Seat ids
/// and classes are filled in from the rows. A plan that has drifted from
/// the seats (direct DB edits, a legacy patch) is not trusted: callers
/// fall back to [`derive_from_seats`].
pub fn trusted_plan(layout_data: Option<&str>, seats: &[seat::Model]) -> Option<SeatPlan> {
    let mut plan = parse_stored(layout_data)?;
    let mut unclaimed: HashMap<(i16, String), &seat::Model> = seats
        .iter()
        .map(|s| ((s.floor, s.seat_label.trim().to_lowercase()), s))
        .collect();
    for (i, deck) in plan.decks.iter_mut().enumerate() {
        let floor = i as i16 + 1;
        for cell in deck.cells.iter_mut().filter(|c| c.kind.is_sellable()) {
            let label = cell.label.as_deref()?.trim().to_lowercase();
            let seat = unclaimed.remove(&(floor, label))?;
            if seat.row_num != Some(cell.row) || seat.col_num != Some(cell.col) {
                return None;
            }
            cell.seat_id = Some(seat.id);
            cell.seat_class = seat.seat_class.clone();
        }
    }
    unclaimed.is_empty().then_some(plan)
}

/// `A2` < `A10` < `B1`: letters first, then the number, then the rest.
fn natural_key(label: &str) -> (String, u64, String) {
    let label = label.trim().to_lowercase();
    let split = label
        .find(|c: char| c.is_ascii_digit())
        .unwrap_or(label.len());
    let (prefix, tail) = label.split_at(split);
    let digits = tail
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(tail.len());
    let (number, rest) = tail.split_at(digits);
    (
        prefix.to_string(),
        number.parse().unwrap_or(0),
        rest.to_string(),
    )
}

/// Split a layout's seats into one group per deck so the group sizes are
/// `wanted`. Tries the recorded floor, then the berth class, then an
/// `A…`/`B…` label prefix — the first that yields exactly those sizes.
fn group_by_deck<'a>(
    seats: &'a [seat::Model],
    wanted: &[usize],
) -> Option<Vec<Vec<&'a seat::Model>>> {
    let mut sorted: Vec<&seat::Model> = seats.iter().collect();
    sorted.sort_by_key(|s| natural_key(&s.seat_label));
    if wanted.len() == 1 {
        return Some(vec![sorted]);
    }
    let by_floor = |s: &seat::Model| usize::from(s.floor >= 2);
    let by_class = |s: &seat::Model| usize::from(s.seat_class.as_deref() == Some("bed_upper"));
    let by_prefix =
        |s: &seat::Model| usize::from(s.seat_label.trim().to_uppercase().starts_with('B'));
    let strategies: [&dyn Fn(&seat::Model) -> usize; 3] = [&by_floor, &by_class, &by_prefix];
    strategies.iter().find_map(|deck_of| {
        let mut groups: Vec<Vec<&seat::Model>> = vec![Vec::new(); wanted.len()];
        for s in &sorted {
            groups[deck_of(s)].push(s);
        }
        groups
            .iter()
            .map(Vec::len)
            .eq(wanted.iter().copied())
            .then_some(groups)
    })
}

/// Lay a template's cells over a layout's existing seats: the template
/// decides where each seat sits, the seats keep their identity (id and
/// label). Seats are matched to cells in natural label order, front to
/// back and left to right. Fails when the template's shape cannot hold
/// exactly these seats.
pub fn fit_to_seats(template: &SeatPlan, seats: &[seat::Model]) -> Result<SeatPlan, String> {
    let wanted: Vec<usize> = template
        .decks
        .iter()
        .map(|d| d.cells.iter().filter(|c| c.kind.is_sellable()).count())
        .collect();
    let total: usize = wanted.iter().sum();
    if total != seats.len() {
        return Err(format!(
            "template holds {total} seats but the layout has {}",
            seats.len()
        ));
    }
    let groups = group_by_deck(seats, &wanted)
        .ok_or_else(|| "cannot tell which seats belong to which deck".to_string())?;
    let mut plan = template.clone();
    for (deck, group) in plan.decks.iter_mut().zip(groups) {
        let mut cells: Vec<&mut PlanCell> = deck
            .cells
            .iter_mut()
            .filter(|c| c.kind.is_sellable())
            .collect();
        cells.sort_by_key(|c| (c.row, c.col));
        for (cell, seat) in cells.into_iter().zip(group) {
            cell.label = Some(seat.seat_label.clone());
            cell.seat_id = Some(seat.id);
            if seat.seat_class.is_some() {
                cell.seat_class = seat.seat_class.clone();
            }
        }
    }
    Ok(plan)
}

// ────────────────────────────────────────────────────────────────
//  Reconciliation with the `seat` table
// ────────────────────────────────────────────────────────────────

/// Target state of one seat row.
#[derive(Debug, Clone, PartialEq)]
pub struct SeatSpec {
    pub label: String,
    pub class: Option<String>,
    pub row: i16,
    pub col: i16,
    pub floor: i16,
    pub is_window: bool,
}

#[derive(Debug, Default, PartialEq)]
pub struct SeatSync {
    pub updates: Vec<(Uuid, SeatSpec)>,
    pub inserts: Vec<SeatSpec>,
    pub deletes: Vec<Uuid>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SyncError {
    /// The plan has seats the layout does not (and trips use the layout).
    SeatsAdded(usize),
    /// The layout has seats the plan dropped (and trips use the layout).
    SeatsRemoved(usize),
}

/// Map `plan` onto the layout's `existing` seats.
pub fn sync_seats(
    existing: &[seat::Model],
    plan: &SeatPlan,
    in_use: bool,
) -> Result<SeatSync, SyncError> {
    let by_id: HashMap<Uuid, &seat::Model> = existing.iter().map(|s| (s.id, s)).collect();
    let by_label: HashMap<String, &seat::Model> = existing
        .iter()
        .map(|s| (s.seat_label.trim().to_lowercase(), s))
        .collect();
    let mut taken: HashSet<Uuid> = HashSet::new();
    let mut sync = SeatSync::default();

    for (deck_idx, deck) in plan.decks.iter().enumerate() {
        let floor = deck_idx as i16 + 1;
        let windows = window_cells(deck);
        for cell in deck.cells.iter().filter(|c| c.kind.is_sellable()) {
            let label = cell.label.as_deref().unwrap_or_default().trim().to_string();
            let spec = SeatSpec {
                label: label.clone(),
                class: cell
                    .seat_class
                    .as_deref()
                    .map(str::trim)
                    .filter(|c| !c.is_empty())
                    .map(str::to_string)
                    .or_else(|| cell.kind.default_class(floor).map(str::to_string)),
                row: cell.row,
                col: cell.col,
                floor,
                is_window: windows.contains(&(cell.row, cell.col)),
            };
            let target = cell
                .seat_id
                .and_then(|id| by_id.get(&id))
                .filter(|s| !taken.contains(&s.id))
                .or_else(|| {
                    by_label
                        .get(&label.to_lowercase())
                        .filter(|s| !taken.contains(&s.id))
                });
            match target {
                Some(seat) => {
                    taken.insert(seat.id);
                    sync.updates.push((seat.id, spec));
                }
                None => sync.inserts.push(spec),
            }
        }
    }
    sync.deletes = existing
        .iter()
        .filter(|s| !taken.contains(&s.id))
        .map(|s| s.id)
        .collect();

    if in_use {
        if !sync.inserts.is_empty() {
            return Err(SyncError::SeatsAdded(sync.inserts.len()));
        }
        if !sync.deletes.is_empty() {
            return Err(SyncError::SeatsRemoved(sync.deletes.len()));
        }
    }
    Ok(sync)
}

/// First and last sellable cell of every row sit by a window.
fn window_cells(deck: &DeckPlan) -> HashSet<(i16, i16)> {
    let mut by_row: HashMap<i16, Vec<i16>> = HashMap::new();
    for c in deck.cells.iter().filter(|c| c.kind.is_sellable()) {
        by_row.entry(c.row).or_default().push(c.col);
    }
    by_row
        .into_iter()
        .flat_map(|(row, cols)| {
            let first = *cols.iter().min().expect("non-empty row");
            let last = *cols.iter().max().expect("non-empty row");
            [(row, first), (row, last)]
        })
        .collect()
}

/// Per-trip view of a plan: the fixtures to draw, and the kind of each
/// seat (deck number is 1-based, matching `seat.floor`).
pub fn kinds_by_label(plan: &SeatPlan) -> HashMap<(i16, String), CellKind> {
    plan.decks
        .iter()
        .enumerate()
        .flat_map(|(i, d)| {
            d.cells
                .iter()
                .filter(|c| c.kind.is_sellable())
                .filter_map(move |c| {
                    c.label
                        .as_ref()
                        .map(|l| ((i as i16 + 1, l.trim().to_lowercase()), c.kind))
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(row: i16, col: i16, kind: CellKind, label: Option<&str>) -> PlanCell {
        PlanCell {
            row,
            col,
            kind,
            label: label.map(str::to_string),
            seat_class: None,
            seat_id: None,
        }
    }

    fn one_deck(rows: i16, cols: i16, cells: Vec<PlanCell>) -> SeatPlan {
        SeatPlan {
            decks: vec![DeckPlan {
                name: None,
                rows,
                cols,
                cells,
            }],
        }
    }

    fn seat_row(label: &str, row: i16, col: i16, floor: i16, class: Option<&str>) -> seat::Model {
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

    #[test]
    fn stored_round_trip_drops_seat_ids() {
        let mut plan = one_deck(1, 2, vec![cell(1, 1, CellKind::Seat, Some("1"))]);
        plan.decks[0].cells[0].seat_id = Some(Uuid::new_v4());
        let raw = to_stored(&plan);
        assert!(raw.starts_with("{\"version\":2"));
        let back = parse_stored(Some(&raw)).expect("v2 plan parses");
        assert_eq!(back.decks[0].cells[0].seat_id, None);
        assert_eq!(back.decks[0].cells[0].label.as_deref(), Some("1"));
    }

    #[test]
    fn legacy_and_garbage_layout_data_is_not_a_plan() {
        assert!(parse_stored(None).is_none());
        assert!(parse_stored(Some("")).is_none());
        assert!(parse_stored(Some("{\"version\":1,\"decks\":[]}")).is_none());
        assert!(parse_stored(Some("not json")).is_none());
    }

    #[test]
    fn validate_rejects_bad_plans() {
        let ok = one_deck(2, 2, vec![cell(1, 1, CellKind::Seat, Some("1"))]);
        assert!(validate(&ok).is_ok());

        let outside = one_deck(1, 1, vec![cell(2, 1, CellKind::Seat, Some("1"))]);
        assert!(validate(&outside).unwrap_err().contains("outside"));

        let overlap = one_deck(
            1,
            2,
            vec![
                cell(1, 1, CellKind::Seat, Some("1")),
                cell(1, 1, CellKind::Seat, Some("2")),
            ],
        );
        assert!(validate(&overlap).unwrap_err().contains("two cells"));

        let dup = one_deck(
            1,
            2,
            vec![
                cell(1, 1, CellKind::Seat, Some("A1")),
                cell(1, 2, CellKind::Seat, Some("a1")),
            ],
        );
        assert!(validate(&dup).unwrap_err().contains("more than once"));

        let unlabeled = one_deck(1, 1, vec![cell(1, 1, CellKind::Bed, None)]);
        assert!(validate(&unlabeled).unwrap_err().contains("label"));

        let no_seats = one_deck(1, 1, vec![cell(1, 1, CellKind::Driver, None)]);
        assert!(validate(&no_seats)
            .unwrap_err()
            .contains("at least one seat"));

        let two_drivers = one_deck(
            1,
            2,
            vec![
                cell(1, 1, CellKind::Driver, None),
                cell(1, 2, CellKind::Driver, None),
            ],
        );
        assert!(validate(&two_drivers).unwrap_err().contains("driver"));
    }

    #[test]
    fn validate_enforces_seat_cap() {
        let cells: Vec<PlanCell> = (0..121)
            .map(|i| cell(i / 9 + 1, i % 9 + 1, CellKind::Seat, Some(&format!("S{i}"))))
            .collect();
        let plan = one_deck(14, 9, cells);
        assert!(validate(&plan).unwrap_err().contains("too large"));
    }

    #[test]
    fn derive_marks_berths_and_keeps_ids() {
        let seats = vec![
            seat_row("A01", 1, 1, 1, Some("bed_lower")),
            seat_row("B01", 1, 2, 1, Some("bed_upper")),
        ];
        let plan = derive_from_seats(&seats);
        assert_eq!(plan.decks.len(), 1);
        assert_eq!((plan.decks[0].rows, plan.decks[0].cols), (1, 2));
        assert!(plan.decks[0].cells.iter().all(|c| c.kind == CellKind::Bed));
        assert!(plan.decks[0].cells.iter().all(|c| c.seat_id.is_some()));
    }

    #[test]
    fn sync_matches_by_label_and_moves_seats_in_use() {
        let a = seat_row("A01", 1, 1, 1, None);
        let b = seat_row("A02", 1, 2, 1, None);
        let plan = one_deck(
            2,
            3,
            vec![
                cell(2, 1, CellKind::Seat, Some("a02")),
                cell(2, 3, CellKind::Seat, Some("A01")),
            ],
        );
        let sync = sync_seats(&[a.clone(), b.clone()], &plan, true).expect("same seat set");
        assert!(sync.inserts.is_empty() && sync.deletes.is_empty());
        let moved: HashMap<Uuid, &SeatSpec> = sync.updates.iter().map(|(id, s)| (*id, s)).collect();
        assert_eq!((moved[&a.id].row, moved[&a.id].col), (2, 3));
        assert_eq!((moved[&b.id].row, moved[&b.id].col), (2, 1));
        // 2 cells in a row → both are window seats.
        assert!(moved[&a.id].is_window && moved[&b.id].is_window);
    }

    #[test]
    fn sync_prefers_explicit_seat_id_over_label() {
        let a = seat_row("A01", 1, 1, 1, None);
        let b = seat_row("A02", 1, 2, 1, None);
        let mut swapped = cell(1, 1, CellKind::Seat, Some("A02"));
        swapped.seat_id = Some(a.id); // relabel seat `a` to A02 …
        let mut other = cell(1, 2, CellKind::Seat, Some("A01"));
        other.seat_id = Some(b.id); // … and seat `b` to A01
        let sync = sync_seats(
            &[a.clone(), b.clone()],
            &one_deck(1, 2, vec![swapped, other]),
            true,
        )
        .expect("swap is allowed");
        let by_id: HashMap<Uuid, &SeatSpec> = sync.updates.iter().map(|(id, s)| (*id, s)).collect();
        assert_eq!(by_id[&a.id].label, "A02");
        assert_eq!(by_id[&b.id].label, "A01");
    }

    #[test]
    fn sync_refuses_to_change_the_seat_set_once_in_use() {
        let a = seat_row("A01", 1, 1, 1, None);
        let grew = one_deck(
            1,
            2,
            vec![
                cell(1, 1, CellKind::Seat, Some("A01")),
                cell(1, 2, CellKind::Seat, Some("A02")),
            ],
        );
        assert_eq!(
            sync_seats(std::slice::from_ref(&a), &grew, true),
            Err(SyncError::SeatsAdded(1))
        );
        let shrank = one_deck(1, 1, vec![cell(1, 1, CellKind::Seat, Some("Z9"))]);
        // "Z9" is new and A01 is dropped: in-use layouts reject the change.
        assert!(sync_seats(std::slice::from_ref(&a), &shrank, true).is_err());
        // Unused layouts may add and remove freely.
        let free = sync_seats(std::slice::from_ref(&a), &grew, false)
            .expect("unused layouts are editable");
        assert_eq!(
            (free.updates.len(), free.inserts.len(), free.deletes.len()),
            (1, 1, 0)
        );
    }

    #[test]
    fn berth_cells_get_deck_classes_by_default() {
        let plan = SeatPlan {
            decks: vec![
                DeckPlan {
                    name: None,
                    rows: 1,
                    cols: 1,
                    cells: vec![cell(1, 1, CellKind::Bed, Some("A01"))],
                },
                DeckPlan {
                    name: None,
                    rows: 1,
                    cols: 1,
                    cells: vec![cell(1, 1, CellKind::Bed, Some("B01"))],
                },
            ],
        };
        let sync = sync_seats(&[], &plan, false).expect("insert-only");
        let classes: Vec<_> = sync.inserts.iter().map(|s| s.class.clone()).collect();
        assert_eq!(
            classes,
            vec![Some("bed_lower".to_string()), Some("bed_upper".to_string())]
        );
        assert_eq!(sync.inserts[1].floor, 2);
    }
}

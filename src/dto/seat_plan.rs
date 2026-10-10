//! Seat-plan DTOs — the physical floor plan of a vehicle.
//!
//! A plan is one uniform grid per deck. Row 1 is the front of the
//! vehicle and column 1 is the driver's side (the left in Vietnam, where
//! the door is on the right). An unoccupied cell is an aisle or a gap, so
//! "3 beds, 2 aisles" is simply `[bed · bed · bed]` on a 5-column grid and
//! a rear bench of five is `[bed bed bed bed bed]`.
//!
//! Cells are either *sellable* (`seat`, `bed`, `cabin`, `cabin_double`) —
//! each backed by one `seat` row — or *fixtures* (`driver`, `door`,
//! `stairs`, `wc`) that only describe the vehicle.
//!
//! The plan is persisted as JSON in `bus_layout.layout_data`
//! (`{"version":2,"decks":[…]}`); the `seat` table stays the operational
//! source of truth for ids, labels and positions.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// What occupies a grid cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CellKind {
    /// Reclining or upright passenger seat.
    Seat,
    /// Sleeper berth (lies along the vehicle).
    Bed,
    /// Private single cabin.
    Cabin,
    /// Wide cabin for two.
    CabinDouble,
    Driver,
    Door,
    Stairs,
    Wc,
}

impl CellKind {
    /// Sellable cells map to a `seat` row; fixtures never do.
    pub fn is_sellable(self) -> bool {
        matches!(
            self,
            Self::Seat | Self::Bed | Self::Cabin | Self::CabinDouble
        )
    }

    /// Default `seat.seat_class` for a sellable cell on `deck` (1-based).
    /// Berths and cabins keep the legacy lower/upper classes.
    pub fn default_class(self, deck: i16) -> Option<&'static str> {
        match self {
            Self::Bed | Self::Cabin | Self::CabinDouble => {
                Some(if deck <= 1 { "bed_lower" } else { "bed_upper" })
            }
            _ => None,
        }
    }
}

/// One occupied grid cell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlanCell {
    /// 1-based, counted from the front.
    pub row: i16,
    /// 1-based, counted from the driver's side.
    pub col: i16,
    pub kind: CellKind,
    /// Customer-facing code of a sellable cell (`A01`, `12`, …), ≤ 10 chars.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Pricing/colour class (`standard`, `vip`, `bed_lower`, …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_class: Option<String>,
    /// Existing `seat` row this cell stands for (admin round-trip only —
    /// never persisted in `layout_data`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<Uuid>,
}

/// One deck's grid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeckPlan {
    /// Optional display name (`Tầng dưới`); clients fall back to the index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Grid height in rows (front → rear).
    pub rows: i16,
    /// Grid width in columns (driver's side → door side).
    pub cols: i16,
    pub cells: Vec<PlanCell>,
}

/// A vehicle's full seat plan: one grid per deck (1 or 2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SeatPlan {
    pub decks: Vec<DeckPlan>,
}

/// A ready-made plan for a common vehicle (admin "create from template").
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BusLayoutPreset {
    pub id: String,
    pub name: String,
    /// Vehicle-type catalog code (`limousine`, `sleeper`, …).
    pub vehicle_type: String,
    /// Sellable units in the plan.
    pub capacity: i16,
    pub description: String,
    pub plan: SeatPlan,
}

/// Response of `GET /api/admin/bus-layouts/presets`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BusLayoutPresetListResponse {
    pub items: Vec<BusLayoutPreset>,
}

/// Response of `GET /api/admin/bus-layouts/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBusLayoutDetail {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_seats: Option<i16>,
    /// The saved plan, or — for layouts created before plans existed — a
    /// plain grid derived from the seat rows (`planned = false`).
    pub plan: SeatPlan,
    /// `true` once a real plan has been saved for this layout.
    pub planned: bool,
    /// Trips already sell these seats: seats can be moved/relabelled but
    /// not added or removed.
    pub in_use: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Body of `PUT /api/admin/bus-layouts/{id}/plan`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSeatPlanRequest {
    pub plan: SeatPlan,
}

/// Body of `POST /api/admin/bus-layouts/{id}/plan/fit`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FitSeatPlanRequest {
    /// Catalog template id (`sleeper_42`, `cabin_24`, …).
    pub preset_id: String,
}

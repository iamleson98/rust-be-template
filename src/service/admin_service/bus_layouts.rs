//! Admin — bus layouts (the seat-map catalog).
//!
//! A layout is a vehicle's seat plan (`dto::seat_plan`) plus the concrete
//! `seat` rows trips sell. The rows stay the operational truth — trips and
//! tickets reference their ids — so a plan is never applied by recreating
//! seats: [`seat_plan::sync_seats`] maps cells onto the existing rows and
//! only adds or removes what the plan really changes, which is refused
//! once trips sell the layout.
//!
//! Writes go through [`seat_plan_db`] (and, for create, entity ops on the
//! transaction directly): the store methods would check out a SECOND
//! pooled connection and deadlock on SQLite's table lock.

use sea_orm::{EntityTrait, Set, TransactionTrait};
use uuid::Uuid;

use super::{now_iso, optional_trimmed, AdminService};
use crate::dto::admin::{
    AdminBusLayoutListResponse, AdminBusLayoutOut, AdminMutationResponse, SeatGridSpec,
    UpsertBusLayoutRequest,
};
use crate::dto::seat_plan::{AdminBusLayoutDetail, BusLayoutPresetListResponse, SeatPlan};
use crate::entity::{bus_layout, seat};
use crate::error::{AppError, AppResult};
use crate::service::seat_plan::{self, SyncError};
use crate::service::{seat_plan_db, seat_plan_presets};

fn internal(e: impl ToString) -> AppError {
    AppError::Internal(e.to_string())
}

impl AdminService {
    /// List bus layouts with an optional brand filter and offset
    /// pagination (`limit=None` returns every matching row — the
    /// schedule form's seat-map picker relies on that).
    pub async fn list_bus_layouts(
        &self,
        brand_id: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> AppResult<AdminBusLayoutListResponse> {
        let limit = limit.map(|l| l.clamp(1, 200));
        let page = self
            .store
            .schedule_store()
            .list_bus_layouts_page(brand_id, limit, offset)
            .await
            .map_err(internal)?;
        let items = page
            .items
            .iter()
            .map(|l| AdminBusLayoutOut {
                id: l.id,
                brand_id: l.brand_id,
                name: l.name.clone(),
                vehicle_type: l.vehicle_type.clone(),
                total_seats: l.total_seats,
                planned: seat_plan::parse_stored(l.layout_data.as_deref()).is_some(),
                created_at: l.created_at.clone(),
                updated_at: l.updated_at.clone(),
            })
            .collect();
        Ok(AdminBusLayoutListResponse {
            items,
            total: Some(page.total),
        })
    }

    /// One layout with its seat plan: the saved plan while it agrees with
    /// the seat rows, else a plain grid derived from them (`planned =
    /// false`) so legacy layouts open in the editor too.
    pub async fn get_bus_layout(&self, id: Uuid) -> AppResult<AdminBusLayoutDetail> {
        let layout = self.find_bus_layout(id).await?;
        let seats = self.layout_seats(id).await?;
        let (plan, planned) = match seat_plan::trusted_plan(layout.layout_data.as_deref(), &seats) {
            Some(plan) => (plan, true),
            None => (seat_plan::derive_from_seats(&seats), false),
        };
        Ok(AdminBusLayoutDetail {
            id,
            brand_id: layout.brand_id,
            name: layout.name,
            vehicle_type: layout.vehicle_type,
            total_seats: layout.total_seats,
            plan,
            planned,
            in_use: self.bus_layout_in_use(id).await?,
            created_at: layout.created_at,
            updated_at: layout.updated_at,
        })
    }

    /// Create a bus layout together with its `seat` rows (the trip
    /// materializer only sells layouts that HAVE seats). A `plan` wins
    /// over `seat_grid`; with neither, a 10×4 single-deck grid is made.
    pub async fn create_bus_layout(
        &self,
        body: &UpsertBusLayoutRequest,
    ) -> AppResult<AdminMutationResponse> {
        let name = optional_trimmed(body.name.as_deref())
            .ok_or_else(|| AppError::BadRequest("name is required".into()))?;
        let id = Uuid::new_v4();
        let now = now_iso();

        let (total_seats, layout_data, seats) = match &body.plan {
            Some(plan) => {
                seat_plan::validate(plan).map_err(AppError::Validation)?;
                let sync = seat_plan::sync_seats(&[], plan, false)
                    .map_err(|_| AppError::Internal("an empty layout rejected a plan".into()))?;
                let seats: Vec<_> = sync
                    .inserts
                    .iter()
                    .map(|spec| seat_plan_db::new_seat(id, spec, &now))
                    .collect();
                (
                    seat_plan::sellable_count(plan) as i16,
                    Some(seat_plan::to_stored(plan)),
                    seats,
                )
            }
            None => {
                let grid = seat_grid_defaults(body.seat_grid.as_ref());
                let total = grid.rows * grid.cols * grid.floors;
                if total as usize > seat_plan::MAX_SEATS {
                    return Err(AppError::Validation(format!(
                        "seat grid too large — max {} seats",
                        seat_plan::MAX_SEATS
                    )));
                }
                (
                    total,
                    optional_trimmed(body.layout_data.as_deref()),
                    generate_seat_grid(id, grid),
                )
            }
        };
        let layout = bus_layout::ActiveModel {
            id: Set(id),
            brand_id: Set(body.brand_id),
            name: Set(Some(name)),
            vehicle_type: Set(optional_trimmed(body.vehicle_type.as_deref())),
            total_seats: Set(Some(total_seats)),
            layout_data: Set(layout_data),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };

        // Layout + seats must land together — a layout whose seat rows
        // are missing would silently sell nothing.
        let txn = self.store.db().begin().await.map_err(internal)?;
        bus_layout::Entity::insert(layout)
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("insert bus layout: {e}")))?;
        seat::Entity::insert_many(seats)
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("insert seats: {e}")))?;
        txn.commit().await.map_err(internal)?;
        Ok(AdminMutationResponse { id })
    }

    /// Metadata patch only. The seats themselves change through
    /// [`Self::replace_bus_layout_plan`], which knows how to keep the ids
    /// trip inventory points at.
    pub async fn update_bus_layout(
        &self,
        id: Uuid,
        body: &UpsertBusLayoutRequest,
    ) -> AppResult<AdminMutationResponse> {
        let mut active: bus_layout::ActiveModel = self.find_bus_layout(id).await?.into();

        if let Some(ref name) = body.name {
            let name = name.trim().to_string();
            if name.is_empty() {
                return Err(AppError::Validation("name cannot be empty".into()));
            }
            active.name = Set(Some(name));
        }
        if let Some(brand_id) = body.brand_id {
            active.brand_id = Set(Some(brand_id));
        }
        if let Some(ref vt) = body.vehicle_type {
            // Patch semantics: `""` clears, non-empty sets the trimmed code.
            active.vehicle_type = Set(optional_trimmed(Some(vt.as_str())));
        }
        if let Some(seats) = body.total_seats {
            active.total_seats = Set(Some(seats));
        }
        if let Some(ref data) = body.layout_data {
            active.layout_data = Set(optional_trimmed(Some(data.as_str())));
        }
        active.updated_at = Set(now_iso());

        self.store
            .schedule_store()
            .update_bus_layout(active)
            .await
            .map_err(internal)?;
        Ok(AdminMutationResponse { id })
    }

    /// Replace the layout's seat plan. Seats are matched to cells by id,
    /// then by label, and keep their identity; cells without a seat add
    /// one and seats without a cell are dropped — both refused while the
    /// layout is in use.
    pub async fn replace_bus_layout_plan(
        &self,
        id: Uuid,
        plan: &SeatPlan,
    ) -> AppResult<AdminMutationResponse> {
        seat_plan::validate(plan).map_err(AppError::Validation)?;
        self.find_bus_layout(id).await?;
        let existing = self.layout_seats(id).await?;
        let in_use = self.bus_layout_in_use(id).await?;
        let sync = seat_plan::sync_seats(&existing, plan, in_use)
            .map_err(|e| AppError::Conflict(in_use_message(&e)))?;
        seat_plan_db::apply_plan(self.store.db(), id, plan, &existing, &sync, &now_iso())
            .await
            .map_err(|e| AppError::Internal(format!("apply seat plan: {e}")))?;
        Ok(AdminMutationResponse { id })
    }

    /// Lay a catalog template over this layout's existing seats (their
    /// ids and labels are kept) and return the result for review — nothing
    /// is saved. Fails when the template cannot hold exactly these seats.
    pub async fn fit_bus_layout_plan(&self, id: Uuid, preset_id: &str) -> AppResult<SeatPlan> {
        let preset = seat_plan_presets::find(preset_id)
            .ok_or_else(|| AppError::NotFound("layout template not found".into()))?;
        self.find_bus_layout(id).await?;
        let seats = self.layout_seats(id).await?;
        seat_plan::fit_to_seats(&preset.plan, &seats)
            .map_err(|reason| AppError::Validation(format!("template does not fit: {reason}")))
    }

    /// The catalog of ready-made plans.
    pub fn bus_layout_presets(&self) -> BusLayoutPresetListResponse {
        BusLayoutPresetListResponse {
            items: seat_plan_presets::catalog(),
        }
    }

    /// Delete a bus layout. Guarded on three fronts because every FK
    /// pointing at a layout (or its seats) is `Restrict`:
    ///
    /// 1. schedules referencing the layout,
    /// 2. `seat_inventory` rows of materialized trips,
    /// 3. `booking_seat` rows of sold tickets.
    ///
    /// Each returns a descriptive 409 instead of a raw FK error.
    /// Unreferenced layouts delete cleanly (their seats cascade).
    pub async fn delete_bus_layout(&self, id: Uuid) -> AppResult<AdminMutationResponse> {
        let store = self.store.schedule_store();
        let schedule_refs = store
            .count_schedules_by_bus_layout(id)
            .await
            .map_err(internal)?;
        if schedule_refs > 0 {
            return Err(AppError::Conflict(format!(
                "{schedule_refs} lịch trình đang dùng sơ đồ ghế này — gỡ sơ đồ khỏi các lịch trình trước khi xoá"
            )));
        }
        if store
            .count_seat_inventory_by_bus_layout(id)
            .await
            .map_err(internal)?
            > 0
        {
            return Err(AppError::Conflict(
                "Sơ đồ ghế đã phát sinh kho ghế cho các chuyến — không thể xoá".into(),
            ));
        }
        if store
            .count_booking_seats_by_bus_layout(id)
            .await
            .map_err(internal)?
            > 0
        {
            return Err(AppError::Conflict(
                "Sơ đồ ghế đã có vé đã bán — không thể xoá".into(),
            ));
        }
        store.delete_bus_layout(id).await.map_err(internal)?;
        Ok(AdminMutationResponse { id })
    }

    // ── helpers ─────────────────────────────────────────────────

    async fn find_bus_layout(&self, id: Uuid) -> AppResult<bus_layout::Model> {
        self.store
            .schedule_store()
            .find_bus_layout_by_id(id)
            .await
            .map_err(internal)?
            .ok_or_else(|| AppError::NotFound("bus layout not found".into()))
    }

    async fn layout_seats(&self, id: Uuid) -> AppResult<Vec<seat::Model>> {
        self.store
            .trip_store()
            .list_seats_by_bus_layout_id(&id.to_string())
            .await
            .map_err(internal)
    }

    /// Trips have been materialized (or tickets sold) from this layout's
    /// seats, so the seat set is frozen.
    async fn bus_layout_in_use(&self, id: Uuid) -> AppResult<bool> {
        seat_plan_db::layout_in_use(self.store.schedule_store().as_ref(), id)
            .await
            .map_err(internal)
    }
}

fn in_use_message(e: &SyncError) -> String {
    let (verb, n) = match e {
        SyncError::SeatsAdded(n) => ("thêm", n),
        SyncError::SeatsRemoved(n) => ("bớt", n),
    };
    format!(
        "Sơ đồ ghế đã có chuyến hoặc vé sử dụng — không thể {verb} {n} ghế (chỉ được di chuyển, đổi tên hoặc đổi hạng các ghế hiện có)"
    )
}

// ────────────────────────────────────────────────────────────────
//  Legacy rectangular grid (`seatGrid`)
// ────────────────────────────────────────────────────────────────

/// Clamped, defaulted grid (`None` fields fall back to a standard 10×4
/// single-deck coach).
struct ResolvedSeatGrid {
    rows: i16,
    cols: i16,
    floors: i16,
}

fn seat_grid_defaults(spec: Option<&SeatGridSpec>) -> ResolvedSeatGrid {
    let s = spec.cloned().unwrap_or_default();
    ResolvedSeatGrid {
        rows: s.rows.unwrap_or(10).clamp(1, 20),
        cols: s.cols.unwrap_or(4).clamp(1, 6),
        floors: s.floors.unwrap_or(1).clamp(1, 2),
    }
}

/// Concrete `seat` rows for a rectangular grid. Single deck: `A1`–`D10`
/// (letter = column, number = row). Two decks: `A01…` lower / `B01…`
/// upper. First and last columns are window seats.
fn generate_seat_grid(layout_id: Uuid, grid: ResolvedSeatGrid) -> Vec<seat::ActiveModel> {
    let now = now_iso();
    let mut seats = Vec::with_capacity((grid.rows * grid.cols * grid.floors) as usize);
    for floor in 1..=grid.floors {
        for row in 1..=grid.rows {
            for col in 1..=grid.cols {
                let label = if grid.floors > 1 {
                    let deck_letter = if floor == 1 { 'A' } else { 'B' };
                    format!("{deck_letter}{:02}", (row - 1) * grid.cols + col)
                } else {
                    format!("{}{row}", (b'A' + (col - 1) as u8) as char)
                };
                seats.push(seat::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    bus_layout_id: Set(layout_id),
                    seat_label: Set(label),
                    seat_class: Set(None),
                    row_num: Set(Some(row)),
                    col_num: Set(Some(col)),
                    is_window: Set(col == 1 || col == grid.cols),
                    floor: Set(floor),
                    created_at: Set(now.clone()),
                });
            }
        }
    }
    seats
}

//! Departure schedules and their ordered stop points.

use sea_orm::Set;
use uuid::Uuid;

use super::addresses::address_out;
use super::validate::{is_days_of_week, regex_like_hhmm};
use super::vehicle_types::vehicle_type_out;
use super::{now_iso, optional_trimmed, AdminService};
use crate::dto::admin::{
    AdminMutationResponse, AdminScheduleListResponse, AdminScheduleOut, AdminSchedulePointOut,
    UpsertSchedulePointItem, UpsertScheduleRequest,
};
use crate::entity::{address, schedule, schedule_point, vehicle_type};
use crate::error::{AppError, AppResult};

impl AdminService {
    /// List schedules for a route, including each schedule's ordered
    /// address points (batch-loaded — two extra queries total, no N+1).
    pub async fn list_schedules(&self, route_id: &str) -> AppResult<AdminScheduleListResponse> {
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_route(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if schedules.is_empty() {
            return Ok(AdminScheduleListResponse { items: Vec::new() });
        }

        let schedule_ids: Vec<Uuid> = schedules.iter().map(|s| s.id).collect();
        let points = self
            .store
            .address_store()
            .list_points_by_schedules(schedule_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let address_ids: Vec<Uuid> = points.iter().map(|p| p.address_id).collect();
        let addresses = self
            .store
            .address_store()
            .list_addresses_by_ids(address_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let address_map: std::collections::HashMap<Uuid, address::Model> =
            addresses.into_iter().map(|a| (a.id, a)).collect();

        // Batch-resolve the schedules' explicit vehicle classes (one
        // query for the whole page).
        let vehicle_type_ids: Vec<Uuid> =
            schedules.iter().filter_map(|s| s.vehicle_type_id).collect();
        let vehicle_type_map: std::collections::HashMap<Uuid, vehicle_type::Model> =
            if vehicle_type_ids.is_empty() {
                std::collections::HashMap::new()
            } else {
                self.store
                    .vehicle_type_store()
                    .find_vehicle_types_by_ids(vehicle_type_ids)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                    .into_iter()
                    .map(|v| (v.id, v))
                    .collect()
            };

        let items: Vec<AdminScheduleOut> = schedules
            .iter()
            .map(|s| {
                // `list_points_by_schedules` orders by stop_order; the
                // per-schedule filter keeps that ordering stable.
                let schedule_points: Vec<AdminSchedulePointOut> = points
                    .iter()
                    .filter(|p| p.schedule_id == s.id)
                    .filter_map(|p| {
                        address_map
                            .get(&p.address_id)
                            .map(|a| AdminSchedulePointOut {
                                id: p.id,
                                schedule_id: p.schedule_id,
                                address_id: p.address_id,
                                stop_order: p.stop_order,
                                kind: p.kind.clone(),
                                arrival_time: p.arrival_time.clone(),
                                address: address_out(a),
                            })
                    })
                    .collect();
                AdminScheduleOut {
                    id: s.id,
                    route_id: s.route_id,
                    departure_time: s.departure_time.clone(),
                    effective_from: s.effective_from.clone(),
                    effective_to: s.effective_to.clone(),
                    days_of_week: s.days_of_week.clone(),
                    bus_layout_id: s.bus_layout_id,
                    vehicle_type_id: s.vehicle_type_id,
                    vehicle_type: s
                        .vehicle_type_id
                        .as_ref()
                        .and_then(|id| vehicle_type_map.get(id))
                        .map(vehicle_type_out),
                    base_price_adult: s.base_price_adult,
                    base_price_child: s.base_price_child,
                    amenities: s.amenities.clone(),
                    points: schedule_points,
                    created_at: s.created_at.clone(),
                }
            })
            .collect();
        Ok(AdminScheduleListResponse { items })
    }

    /// Create a new schedule.
    pub async fn create_schedule(
        &self,
        body: &UpsertScheduleRequest,
    ) -> AppResult<AdminMutationResponse> {
        let route_id = body
            .route_id
            .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?;
        let departure_time = body
            .departure_time
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("departureTime is required".into()))?
            .to_string();

        if !regex_like_hhmm(&departure_time) {
            return Err(AppError::Validation(
                "departureTime must be HH:MM (00:00–23:59)".into(),
            ));
        }

        let days_of_week = body.days_of_week.clone();
        if let Some(ref d) = days_of_week {
            if !is_days_of_week(d) {
                return Err(AppError::Validation(
                    "daysOfWeek must be 7-char 0/1 bitmask".into(),
                ));
            }
        }

        // Validate the vehicle type reference BEFORE inserting so a bad
        // id can't wedge the FK (and reads as a friendly 4xx, not 500).
        if let Some(vt_id) = body.vehicle_type_id {
            self.ensure_vehicle_type_exists(vt_id).await?;
        }

        let id = Uuid::new_v4();
        // Validate the point sequence BEFORE inserting the schedule so a
        // rejected payload can't leave a half-configured schedule behind.
        let point_models = match &body.points {
            Some(items) => Some(self.build_schedule_points(route_id, id, items).await?),
            None => None,
        };

        let now = now_iso();
        let model = schedule::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            departure_time: Set(departure_time),
            effective_from: Set(body.effective_from.clone()),
            effective_to: Set(body.effective_to.clone()),
            days_of_week: Set(days_of_week),
            bus_layout_id: Set(body.bus_layout_id),
            vehicle_type_id: Set(body.vehicle_type_id),
            base_price_adult: Set(body.base_price_adult.unwrap_or(0)),
            base_price_child: Set(body.base_price_child),
            amenities: Set(body.amenities.clone()),
            created_at: Set(now),
        };

        self.store
            .schedule_store()
            .insert_schedule(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if let Some(models) = point_models {
            self.insert_points(models).await?;
        }

        Ok(AdminMutationResponse { id })
    }

    /// Update a schedule by id.
    pub async fn update_schedule(
        &self,
        id: Uuid,
        body: &UpsertScheduleRequest,
    ) -> AppResult<AdminMutationResponse> {
        let existing = self
            .store
            .schedule_store()
            .find_schedule_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        let original_route_id = existing.route_id;
        let mut active: schedule::ActiveModel = existing.into();

        // The (possibly updated) route scopes point validation — resolve it
        // before applying field updates.
        let final_route_id = body.route_id.unwrap_or(original_route_id);
        // Validate the new point sequence BEFORE mutating the schedule row.
        let point_models = match &body.points {
            Some(items) => Some(
                self.build_schedule_points(final_route_id, id, items)
                    .await?,
            ),
            None => None,
        };

        if let Some(v) = body.route_id {
            active.route_id = Set(v);
        }
        if let Some(ref v) = body.departure_time {
            if !regex_like_hhmm(v) {
                return Err(AppError::Validation("departureTime must be HH:MM".into()));
            }
            active.departure_time = Set(v.clone());
        }
        if let Some(ref v) = body.effective_from {
            active.effective_from = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.effective_to {
            active.effective_to = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.days_of_week {
            active.days_of_week = Set(Some(v.clone()));
        }
        if let Some(v) = body.bus_layout_id {
            active.bus_layout_id = Set(Some(v));
        }
        if let Some(v) = body.vehicle_type_id {
            self.ensure_vehicle_type_exists(v).await?;
            active.vehicle_type_id = Set(Some(v));
        }
        if let Some(v) = body.base_price_adult {
            active.base_price_adult = Set(v);
        }
        if let Some(v) = body.base_price_child {
            active.base_price_child = Set(Some(v));
        }
        if let Some(ref v) = body.amenities {
            active.amenities = Set(Some(v.clone()));
        }

        self.store
            .schedule_store()
            .update_schedule(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if let Some(models) = point_models {
            self.replace_points(id, models).await?;
        }

        Ok(AdminMutationResponse { id })
    }

    /// Delete a schedule by id.
    pub async fn delete_schedule(&self, id: Uuid) -> AppResult<()> {
        self.store
            .schedule_store()
            .delete_schedule(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    /// A schedule's `vehicleType` reference must point at a real catalog
    /// row. Validated on create/update so a bad id reads as a friendly
    /// 4xx instead of an FK 500 (and to keep SQLite — no FK on the added
    /// column — standard SQL semantics).
    async fn ensure_vehicle_type_exists(&self, id: Uuid) -> AppResult<()> {
        if self
            .store
            .vehicle_type_store()
            .find_vehicle_type_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .is_none()
        {
            return Err(AppError::NotFound(format!(
                "vehicle type {id} does not exist"
            )));
        }
        Ok(())
    }

    /// Validate + build the ordered `schedule_point` rows for a schedule.
    ///
    /// Rules:
    /// - at least 2 entries (departure + destination),
    /// - every entry references an existing address,
    /// - every address belongs to the route's brand (points are
    ///   brand-scoped so one brand can never build a route out of
    ///   another brand's stops),
    /// - `kind` derives from position (first `pickup`, last `drop`,
    ///   otherwise `middle`) and `stop_order` equals the array index.
    async fn build_schedule_points(
        &self,
        route_id: Uuid,
        schedule_id: Uuid,
        items: &[UpsertSchedulePointItem],
    ) -> AppResult<Vec<schedule_point::ActiveModel>> {
        if items.len() < 2 {
            return Err(AppError::Validation(
                "points must contain at least the departure and destination addresses (2 items)"
                    .into(),
            ));
        }

        // The route's brand scopes which addresses may be used.
        let route_model = self
            .store
            .route_store()
            .find_route_by_id(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;
        let brand_id = route_model.brand_id.ok_or_else(|| {
            AppError::Validation(
                "route has no brand — assign a brand to the route before configuring points".into(),
            )
        })?;

        let address_ids: Option<Vec<Uuid>> = items.iter().map(|p| p.address_id).collect();
        let address_ids = address_ids
            .ok_or_else(|| AppError::Validation("every point must reference an address".into()))?;

        let addresses = self
            .store
            .address_store()
            .list_addresses_by_ids(address_ids.clone())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Dedupe before the existence check — `IN (...)` returns one row
        // per address, so a repeated address in the sequence (legal,
        // e.g. circular routes) must not look like a missing one.
        let distinct_ids: std::collections::HashSet<Uuid> = address_ids.iter().copied().collect();
        if addresses.len() != distinct_ids.len() {
            return Err(AppError::Validation(
                "one or more point addresses do not exist".into(),
            ));
        }
        for a in &addresses {
            if a.brand_id != brand_id {
                return Err(AppError::Validation(
                    "point addresses must belong to the route's brand".into(),
                ));
            }
        }

        // Arrival times are optional but must be `HH:MM` when present
        // (same vocabulary as `departure_time`).
        for (i, p) in items.iter().enumerate() {
            if let Some(t) = p.arrival_time.as_deref() {
                let t = t.trim();
                if !t.is_empty() && !regex_like_hhmm(t) {
                    return Err(AppError::Validation(format!(
                        "points[{i}].arrivalTime must be HH:MM (00:00-23:59)"
                    )));
                }
            }
        }

        let now = now_iso();
        let total = items.len();
        Ok(items
            .iter()
            .enumerate()
            .map(|(index, p)| schedule_point::ActiveModel {
                id: Set(Uuid::new_v4()),
                schedule_id: Set(schedule_id),
                address_id: Set(p.address_id.expect("checked above")),
                stop_order: Set(index as i64),
                kind: Set(point_kind(index, total).to_string()),
                arrival_time: Set(optional_trimmed(p.arrival_time.as_deref())),
                created_at: Set(now.clone()),
            })
            .collect())
    }

    /// Insert freshly built points inside a single transaction.
    async fn insert_points(&self, models: Vec<schedule_point::ActiveModel>) -> AppResult<()> {
        if models.is_empty() {
            return Ok(());
        }
        use sea_orm::{DatabaseTransaction, EntityTrait, TransactionTrait};
        let txn: DatabaseTransaction = self
            .store
            .db()
            .begin()
            .await
            .map_err(|e| AppError::Internal(format!("begin txn: {e}")))?;
        schedule_point::Entity::insert_many(models)
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("insert points: {e}")))?;
        txn.commit()
            .await
            .map_err(|e| AppError::Internal(format!("commit txn: {e}")))?;
        Ok(())
    }

    /// Atomically replace a schedule's whole point sequence
    /// (delete-then-insert in one transaction).
    async fn replace_points(
        &self,
        schedule_id: Uuid,
        models: Vec<schedule_point::ActiveModel>,
    ) -> AppResult<()> {
        use sea_orm::{
            ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, TransactionTrait,
        };
        let txn: DatabaseTransaction = self
            .store
            .db()
            .begin()
            .await
            .map_err(|e| AppError::Internal(format!("begin txn: {e}")))?;
        schedule_point::Entity::delete_many()
            .filter(schedule_point::Column::ScheduleId.eq(schedule_id))
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("delete points: {e}")))?;
        if !models.is_empty() {
            schedule_point::Entity::insert_many(models)
                .exec(&txn)
                .await
                .map_err(|e| AppError::Internal(format!("insert points: {e}")))?;
        }
        txn.commit()
            .await
            .map_err(|e| AppError::Internal(format!("commit txn: {e}")))?;
        Ok(())
    }
}

/// Point kind derived from its position in the sequence.
fn point_kind(index: usize, total: usize) -> &'static str {
    if index == 0 {
        "pickup"
    } else if index + 1 == total {
        "drop"
    } else {
        "middle"
    }
}

//! Departure schedules and their ordered stop points.

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set};
use uuid::Uuid;

use super::addresses::address_out;
use super::validate::{is_days_of_week, regex_like_hhmm};
use super::vehicle_types::vehicle_type_out;
use super::{now_iso, optional_trimmed, AdminService};
use crate::db::write::with_write;
use crate::dto::admin::{
    AdminMutationResponse, AdminScheduleListResponse, AdminScheduleOut, AdminSchedulePointOut,
    UpsertSchedulePointItem, UpsertScheduleRequest,
};
use crate::dto::fares::SeatClassFare;
use crate::entity::{address, schedule, schedule_fare, schedule_point, vehicle_type};
use crate::error::{AppError, AppResult};
use crate::service::fares::{self, normalize_class, MAX_CLASS_CHARS};

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
        let class_fares = self
            .store
            .schedule_store()
            .list_fares(schedule_ids.clone())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
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
                    class_fares: fares::class_fares_out(
                        &class_fares
                            .iter()
                            .filter(|f| f.schedule_id == s.id)
                            .cloned()
                            .collect::<Vec<_>>(),
                    ),
                    amenities: s.amenities.clone(),
                    points: schedule_points,
                    created_at: s.created_at.clone(),
                }
            })
            .collect();
        Ok(AdminScheduleListResponse { items })
    }

    /// Create a schedule together with its points and fares, in one
    /// transaction: a failure part-way never leaves a schedule without its
    /// stops or prices.
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
        self.ensure_route_exists(route_id).await?;

        let days_of_week = days_of_week(body.days_of_week.as_deref())?;
        let effective_from = effective_date("effectiveFrom", body.effective_from.as_deref())?;
        let effective_to = effective_date("effectiveTo", body.effective_to.as_deref())?;
        check_date_order(effective_from.as_deref(), effective_to.as_deref())?;

        // Validate the vehicle type reference BEFORE inserting so a bad
        // id can't wedge the FK (and reads as a friendly 4xx, not 500).
        let posted_vehicle_type = body.vehicle_type_id.flatten();
        if let Some(vt_id) = posted_vehicle_type {
            self.ensure_vehicle_type_exists(vt_id).await?;
        }
        // The layout is the single vehicle choice: its class wins over
        // any separately-posted vehicleType so the search facets and
        // the seat map can never disagree.
        let bus_layout_id = body.bus_layout_id.flatten();
        let vehicle_type_id = match bus_layout_id {
            Some(layout_id) => self
                .vehicle_type_of_layout(layout_id)
                .await?
                // A layout without a class keeps the posted type —
                // legacy layouts before canonicalization.
                .or(posted_vehicle_type),
            None => posted_vehicle_type,
        };

        let id = Uuid::new_v4();
        let base_price_adult = body.base_price_adult.unwrap_or(0);
        let base_price_child = child_override(body.base_price_child);
        check_child_price("basePriceChild", base_price_child, base_price_adult)?;
        // Validate the point sequence and fares BEFORE writing anything so
        // a rejected payload can't leave a half-configured schedule behind.
        let fare_models = body
            .class_fares
            .as_deref()
            .map(|items| fare_rows(id, items))
            .transpose()?;
        let point_models = match &body.points {
            Some(items) => Some(self.build_schedule_points(route_id, id, items).await?),
            None => None,
        };

        let model = schedule::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            departure_time: Set(departure_time),
            effective_from: Set(effective_from),
            effective_to: Set(effective_to),
            days_of_week: Set(days_of_week),
            bus_layout_id: Set(bus_layout_id),
            vehicle_type_id: Set(vehicle_type_id),
            base_price_adult: Set(base_price_adult),
            base_price_child: Set(base_price_child),
            amenities: Set(optional_trimmed(body.amenities.as_deref())),
            created_at: Set(now_iso()),
        };

        with_write(self.store.db(), |tx| {
            let (model, point_models, fare_models) =
                (model.clone(), point_models.clone(), fare_models.clone());
            Box::pin(async move {
                schedule::Entity::insert(model).exec(tx).await?;
                if let Some(points) = point_models.filter(|p| !p.is_empty()) {
                    schedule_point::Entity::insert_many(points).exec(tx).await?;
                }
                if let Some(fares) = fare_models.filter(|f| !f.is_empty()) {
                    schedule_fare::Entity::insert_many(fares).exec(tx).await?;
                }
                Ok(())
            })
        })
        .await
        .map_err(|e| AppError::Internal(format!("insert schedule: {e}")))?;

        Ok(AdminMutationResponse { id })
    }

    /// Update a schedule by id. A field left out keeps its value, `null`
    /// clears an optional one, and `points` / `classFares`, when present,
    /// replace the whole list. The row and its lists are written in one
    /// transaction.
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
        let base_price_adult = body.base_price_adult.unwrap_or(existing.base_price_adult);
        let base_price_child = match body.base_price_child {
            Some(v) => child_override(Some(v)),
            None => existing.base_price_child,
        };
        check_child_price("basePriceChild", base_price_child, base_price_adult)?;
        let fare_models = body
            .class_fares
            .as_deref()
            .map(|items| fare_rows(id, items))
            .transpose()?;
        let mut active: schedule::ActiveModel = existing.into();

        // The (possibly updated) route scopes point validation — resolve it
        // before applying field updates.
        if let Some(route_id) = body.route_id {
            self.ensure_route_exists(route_id).await?;
        }
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
        let effective_from = body
            .effective_from
            .as_deref()
            .map(|v| effective_date("effectiveFrom", Some(v)))
            .transpose()?;
        let effective_to = body
            .effective_to
            .as_deref()
            .map(|v| effective_date("effectiveTo", Some(v)))
            .transpose()?;
        if let (Some(from), Some(to)) = (&effective_from, &effective_to) {
            check_date_order(from.as_deref(), to.as_deref())?;
        }
        if let Some(v) = effective_from {
            active.effective_from = Set(v);
        }
        if let Some(v) = effective_to {
            active.effective_to = Set(v);
        }
        if body.days_of_week.is_some() {
            active.days_of_week = Set(days_of_week(body.days_of_week.as_deref())?);
        }
        let mut layout_class_applied = false;
        if let Some(layout) = body.bus_layout_id {
            active.bus_layout_id = Set(layout);
            // The layout's class follows the re-point so the facets and
            // the seat map stay in agreement.
            if let Some(derived) = match layout {
                Some(layout_id) => self.vehicle_type_of_layout(layout_id).await?,
                None => None,
            } {
                active.vehicle_type_id = Set(Some(derived));
                layout_class_applied = true;
            }
        }
        if let Some(vehicle_type) = body.vehicle_type_id {
            if let Some(v) = vehicle_type {
                self.ensure_vehicle_type_exists(v).await?;
            }
            // Applied only when no layout class overrode it above —
            // the layout is the single source of the schedule's class.
            if !layout_class_applied {
                active.vehicle_type_id = Set(vehicle_type);
            }
        }
        active.base_price_adult = Set(base_price_adult);
        active.base_price_child = Set(base_price_child);
        if body.amenities.is_some() {
            active.amenities = Set(optional_trimmed(body.amenities.as_deref()));
        }

        let updated = with_write(self.store.db(), |tx| {
            let (active, point_models, fare_models) =
                (active.clone(), point_models.clone(), fare_models.clone());
            Box::pin(async move {
                let updated = schedule::Entity::update(active).exec(tx).await?;
                if let Some(points) = point_models {
                    schedule_point::Entity::delete_many()
                        .filter(schedule_point::Column::ScheduleId.eq(id))
                        .exec(tx)
                        .await?;
                    if !points.is_empty() {
                        schedule_point::Entity::insert_many(points).exec(tx).await?;
                    }
                }
                if let Some(fares) = fare_models {
                    schedule_fare::Entity::delete_many()
                        .filter(schedule_fare::Column::ScheduleId.eq(id))
                        .exec(tx)
                        .await?;
                    if !fares.is_empty() {
                        schedule_fare::Entity::insert_many(fares).exec(tx).await?;
                    }
                }
                Ok(updated)
            })
        })
        .await
        .map_err(|e| AppError::Internal(format!("update schedule: {e}")))?;

        // Seats still for sale on upcoming trips follow the new prices.
        fares::reprice_upcoming(&self.store, &updated).await?;

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

    /// Schedules and pickup points belong to a route that exists — a bad
    /// id reads as a friendly 4xx, not an FK failure.
    pub(super) async fn ensure_route_exists(&self, route_id: Uuid) -> AppResult<()> {
        if self
            .store
            .route_store()
            .find_route_by_id(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .is_none()
        {
            return Err(AppError::Validation("routeId names no route".into()));
        }
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

    /// The class of the bus a schedule runs: its LAYOUT's vehicle type,
    /// resolved to a catalog row. The layout is the single choice an
    /// admin makes; `vehicle_type_id` follows it so the search facets
    /// can never disagree with the seat map. `None` when the layout
    /// carries no code or the code left the catalog.
    async fn vehicle_type_of_layout(&self, layout_id: Uuid) -> AppResult<Option<Uuid>> {
        let layout = self
            .store
            .schedule_store()
            .find_bus_layout_by_id(layout_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound(format!("bus layout {layout_id} does not exist")))?;
        let Some(code) = layout.vehicle_type else {
            return Ok(None);
        };
        let vt = self
            .store
            .vehicle_type_store()
            .find_vehicle_type_by_code(&code)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(vt.map(|v| v.id))
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

/// The `daysOfWeek` mask a request carries; blank clears it (every day).
fn days_of_week(raw: Option<&str>) -> AppResult<Option<String>> {
    let mask = optional_trimmed(raw);
    if let Some(mask) = &mask {
        if !is_days_of_week(mask) {
            return Err(AppError::Validation(
                "daysOfWeek must be 7-char 0/1 bitmask".into(),
            ));
        }
    }
    Ok(mask)
}

/// An `effectiveFrom` / `effectiveTo` date (`YYYY-MM-DD`); blank clears it.
fn effective_date(field: &str, raw: Option<&str>) -> AppResult<Option<String>> {
    let date = optional_trimmed(raw);
    if let Some(date) = &date {
        let well_formed =
            date.len() == 10 && chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok();
        if !well_formed {
            return Err(AppError::Validation(format!("{field} must be YYYY-MM-DD")));
        }
    }
    Ok(date)
}

fn check_date_order(from: Option<&str>, to: Option<&str>) -> AppResult<()> {
    match (from, to) {
        (Some(from), Some(to)) if from > to => Err(AppError::Validation(
            "effectiveFrom must not be after effectiveTo".into(),
        )),
        _ => Ok(()),
    }
}

/// A child price of 0 (or none) means "use the brand's child discount".
fn child_override(price: Option<i64>) -> Option<i64> {
    price.filter(|&p| p > 0)
}

fn check_child_price(field: &str, child: Option<i64>, adult: i64) -> AppResult<()> {
    match child {
        Some(child) if child > adult => Err(AppError::Validation(format!(
            "{field} cannot be higher than the adult price"
        ))),
        _ => Ok(()),
    }
}

/// Rows for a schedule's class fares: one per class, never `standard`
/// (that is the base price), a child price no higher than the adult one.
fn fare_rows(
    schedule_id: Uuid,
    items: &[SeatClassFare],
) -> AppResult<Vec<schedule_fare::ActiveModel>> {
    let now = now_iso();
    let mut seen = std::collections::HashSet::new();
    items
        .iter()
        .map(|item| {
            let class = normalize_class(Some(&item.seat_class)).ok_or_else(|| {
                AppError::Validation(
                    "classFares: standard seats are priced by basePriceAdult".into(),
                )
            })?;
            if class.chars().count() > MAX_CLASS_CHARS {
                return Err(AppError::Validation(format!(
                    "classFares: seat class `{class}` is too long"
                )));
            }
            if !seen.insert(class.clone()) {
                return Err(AppError::Validation(format!(
                    "classFares: `{class}` is priced twice"
                )));
            }
            let child = child_override(item.price_child);
            check_child_price(
                &format!("classFares.{class}.priceChild"),
                child,
                item.price_adult,
            )?;
            Ok(schedule_fare::ActiveModel {
                id: Set(Uuid::new_v4()),
                schedule_id: Set(schedule_id),
                seat_class: Set(class),
                price_adult: Set(item.price_adult),
                price_child: Set(child),
                created_at: Set(now.clone()),
                updated_at: Set(now.clone()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fare(class: &str, adult: i64, child: Option<i64>) -> SeatClassFare {
        SeatClassFare {
            seat_class: class.into(),
            price_adult: adult,
            price_child: child,
        }
    }

    fn rejected(items: &[SeatClassFare]) -> bool {
        matches!(
            fare_rows(Uuid::new_v4(), items),
            Err(AppError::Validation(_))
        )
    }

    #[test]
    fn class_fares_are_normalized_and_zero_child_prices_dropped() {
        let rows = fare_rows(
            Uuid::new_v4(),
            &[
                fare(" VIP ", 500_000, Some(0)),
                fare("bed_upper", 300_000, Some(250_000)),
            ],
        )
        .unwrap();
        let read = |r: &schedule_fare::ActiveModel| {
            (
                r.seat_class.clone().unwrap(),
                r.price_child.clone().unwrap(),
            )
        };
        assert_eq!(read(&rows[0]), ("vip".into(), None));
        assert_eq!(read(&rows[1]), ("bed_upper".into(), Some(250_000)));
    }

    #[test]
    fn standard_duplicates_and_dear_child_prices_are_rejected() {
        assert!(rejected(&[fare("standard", 300_000, None)]));
        assert!(rejected(&[fare("vip", 1, None), fare("VIP", 2, None)]));
        assert!(rejected(&[fare("vip", 400_000, Some(400_001))]));
        assert!(rejected(&[fare(&"x".repeat(31), 1, None)]));
    }
}

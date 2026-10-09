//! The vehicle-type catalog schedules pick from.

use sea_orm::Set;
use uuid::Uuid;

use super::validate::{slugify, valid_slug};
use super::{now_iso, optional_trimmed, AdminService};
use crate::dto::admin::{
    AdminMutationResponse, AdminVehicleTypeListResponse, AdminVehicleTypeOut,
    UpsertVehicleTypeRequest,
};
use crate::entity::{schedule, vehicle_type};
use crate::error::{AppError, AppResult};

impl AdminService {
    /// List the vehicle-type catalog with optional label/code filter +
    /// offset pagination (the admin page + the schedule form's
    /// infinite-scroll picker).
    pub async fn list_vehicle_types(
        &self,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> AppResult<AdminVehicleTypeListResponse> {
        let limit = limit.map(|l| l.clamp(1, 200));
        let page = self
            .store
            .vehicle_type_store()
            .list_vehicle_types(q, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(AdminVehicleTypeListResponse {
            items: page.items.iter().map(vehicle_type_out).collect(),
            total: page.total,
        })
    }

    /// Create a vehicle type. `code` is slugified (Vietnamese-aware) and
    /// must stay unique — the public search filter depends on it.
    pub async fn create_vehicle_type(
        &self,
        body: &UpsertVehicleTypeRequest,
    ) -> AppResult<AdminMutationResponse> {
        let label = optional_trimmed(body.label.as_deref())
            .ok_or_else(|| AppError::BadRequest("label is required".into()))?;
        let code = body
            .code
            .as_deref()
            .map(slugify)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("code is required".into()))?;
        if !valid_slug(&code) {
            return Err(AppError::Validation(
                "code must be lowercase letters, digits and dashes".into(),
            ));
        }
        let status = valid_vehicle_type_status(body.status.as_deref())
            .ok_or_else(|| AppError::Validation("status must be `active` or `disabled`".into()))?;

        // Duplicate guard (unique index also enforces it, but this gives
        // a 409 with a human message instead of a 500).
        if self
            .store
            .vehicle_type_store()
            .find_vehicle_type_by_code(&code)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .is_some()
        {
            return Err(AppError::Conflict(format!(
                "vehicle type code {code:?} already exists"
            )));
        }

        let id = Uuid::new_v4();
        let now = now_iso();
        self.store
            .vehicle_type_store()
            .insert_vehicle_type(vehicle_type::ActiveModel {
                id: Set(id),
                code: Set(code),
                label: Set(label),
                description: Set(optional_trimmed(body.description.as_deref())),
                total_seats: Set(body.total_seats),
                sort_order: Set(body.sort_order.unwrap_or(0)),
                status: Set(status.to_string()),
                created_at: Set(now.clone()),
                updated_at: Set(now),
            })
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(AdminMutationResponse { id })
    }

    /// Update a vehicle type (patch semantics — only provided fields).
    pub async fn update_vehicle_type(
        &self,
        id: Uuid,
        body: &UpsertVehicleTypeRequest,
    ) -> AppResult<AdminMutationResponse> {
        let existing = self
            .store
            .vehicle_type_store()
            .find_vehicle_type_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("vehicle type not found".into()))?;

        let original_code = existing.code.clone();
        let mut active: vehicle_type::ActiveModel = existing.into();

        if let Some(ref code) = body.code {
            let code = slugify(code);
            if !valid_slug(&code) {
                return Err(AppError::Validation(
                    "code must be lowercase letters, digits and dashes".into(),
                ));
            }
            // Uniqueness when the code actually changes.
            if !code.eq_ignore_ascii_case(&original_code) {
                if let Some(dup) = self
                    .store
                    .vehicle_type_store()
                    .find_vehicle_type_by_code(&code)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                {
                    if dup.id != id {
                        return Err(AppError::Conflict(format!(
                            "vehicle type code {code:?} already exists"
                        )));
                    }
                }
            }
            active.code = Set(code);
        }
        if let Some(ref label) = body.label {
            let label = label.trim().to_string();
            if label.is_empty() {
                return Err(AppError::Validation("label cannot be empty".into()));
            }
            active.label = Set(label);
        }
        if let Some(ref desc) = body.description {
            // Patch semantics: `""` clears, non-empty sets the trimmed text.
            active.description = Set(optional_trimmed(Some(desc.as_str())));
        }
        if let Some(seats) = body.total_seats {
            active.total_seats = Set(Some(seats));
        }
        if let Some(sort) = body.sort_order {
            active.sort_order = Set(sort);
        }
        if let Some(ref status) = body.status {
            let status = valid_vehicle_type_status(Some(status)).ok_or_else(|| {
                AppError::Validation("status must be `active` or `disabled`".into())
            })?;
            active.status = Set(status.to_string());
        }
        active.updated_at = Set(now_iso());

        self.store
            .vehicle_type_store()
            .update_vehicle_type(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(AdminMutationResponse { id })
    }

    /// Delete a vehicle type. Referencing schedules fall back to their
    /// bus layout (`ON DELETE SET NULL` semantics) — the reference is
    /// cleared explicitly in one transaction so SQLite (no FK on the
    /// added column) matches standard SQL engines.
    pub async fn delete_vehicle_type(&self, id: Uuid) -> AppResult<()> {
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};

        let txn = self
            .store
            .db()
            .begin()
            .await
            .map_err(|e| AppError::Internal(format!("begin txn: {e}")))?;
        schedule::Entity::update_many()
            .col_expr(
                schedule::Column::VehicleTypeId,
                sea_orm::sea_query::Expr::value(Option::<Uuid>::None),
            )
            .filter(schedule::Column::VehicleTypeId.eq(id))
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("clear schedule references: {e}")))?;
        vehicle_type::Entity::delete_by_id(id)
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("delete vehicle type: {e}")))?;
        txn.commit()
            .await
            .map_err(|e| AppError::Internal(format!("commit txn: {e}")))?;
        Ok(())
    }
}

/// Map a `vehicle_type` row to its admin DTO.
pub(super) fn vehicle_type_out(v: &vehicle_type::Model) -> AdminVehicleTypeOut {
    AdminVehicleTypeOut {
        id: v.id,
        code: v.code.clone(),
        label: v.label.clone(),
        description: v.description.clone(),
        total_seats: v.total_seats,
        sort_order: v.sort_order,
        status: v.status.clone(),
        created_at: v.created_at.clone(),
        updated_at: v.updated_at.clone(),
    }
}

/// `active` | `disabled` (catalog status vocabulary).
fn valid_vehicle_type_status(s: Option<&str>) -> Option<&'static str> {
    match s.unwrap_or("active") {
        "active" => Some("active"),
        "disabled" => Some("disabled"),
        _ => None,
    }
}

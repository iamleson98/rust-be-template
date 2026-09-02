//! `SeaORM` Entity — the admin-managed vehicle type catalog.
//!
//! Hand-written (following the codegen style) because the table ships in
//! `m20260904_000001_vehicle_types_schedule_times`: `limousine`,
//! `sleeper`, `standard`, … plus operator-created classes ("xe 45 chỗ").
//! Schedules reference a row via `schedule.vehicle_type_id`.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "vehicle_type")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// Stable slug — matches the legacy `bus_layout.vehicle_type` codes
    /// (`limousine`, `sleeper`, …) and the public search filter values.
    pub code: String,
    /// Display name (Vietnamese, e.g. "Giường nằm").
    pub label: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub description: Option<String>,
    /// Typical seat count (informational; the bus layout's concrete
    /// `total_seats` wins for seat maps).
    pub total_seats: Option<i16>,
    /// Display order (ascending) in pickers.
    pub sort_order: i16,
    /// `active` | `disabled` — disabled types are hidden from pickers.
    pub status: String,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::schedule::Entity")]
    Schedule,
}

impl Related<super::schedule::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Schedule.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

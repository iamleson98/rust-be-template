//! `SeaORM` Entity — ordered address points of a schedule.
//!
//! A schedule's journey is described as an ordered sequence of addresses:
//! the first row (`kind = "pickup"`) is the departure point, the last row
//! (`kind = "drop"`) is the final destination, and everything in between
//! (`kind = "middle"`) is a midway stop where passengers can be picked up
//! or dropped off. `stop_order` is the 0-based position in the sequence.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "schedule_point")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub schedule_id: Uuid,
    pub address_id: Uuid,
    pub stop_order: i64,
    pub kind: String,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::address::Entity",
        from = "Column::AddressId",
        to = "super::address::Column::Id",
        on_update = "Cascade",
        on_delete = "Restrict"
    )]
    Address,
    #[sea_orm(
        belongs_to = "super::schedule::Entity",
        from = "Column::ScheduleId",
        to = "super::schedule::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Schedule,
}

impl Related<super::address::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Address.def()
    }
}

impl Related<super::schedule::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Schedule.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

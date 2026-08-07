use chrono::{NaiveDateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "permissions")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: Uuid,
    /// Codename, e.g. `posts:write`, `users:read`. Used by the RBAC checker.
    #[sea_orm(unique)]
    pub name: String,
    #[sea_orm(nullable)]
    pub description: Option<String>,
    #[sea_orm(default_expr = "Utc::now().naive_utc()")]
    pub created_at: NaiveDateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::role_permission::Entity")]
    RolePermission,
}

impl Related<super::role_permission::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RolePermission.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

use chrono::{NaiveDateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub email: String,
    #[sea_orm(unique)]
    pub username: String,
    #[sea_orm(column_name = "password_hash")]
    pub password_hash: String,
    #[sea_orm(default_expr = "Utc::now().naive_utc()")]
    pub created_at: NaiveDateTime,
    #[sea_orm(default_expr = "Utc::now().naive_utc()")]
    pub updated_at: NaiveDateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::refresh_token::Entity")]
    RefreshToken,
    #[sea_orm(has_many = "super::post::Entity")]
    Post,
    #[sea_orm(has_many = "super::user_role::Entity")]
    UserRole,
}

impl Related<super::refresh_token::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RefreshToken.def()
    }
}

impl Related<super::post::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Post.def()
    }
}

impl Related<super::user_role::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserRole.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

use chrono::NaiveDateTime;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Opaque, rotating refresh-token record. Each refresh produces a new row
/// and revokes the previous one (rotating refresh tokens).
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "refresh_tokens")]
pub struct Model {
    /// The opaque token id stored in the HttpOnly cookie.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "user_id")]
    pub user_id: Uuid,
    /// SHA-256 hash of the cookie value; we never store the raw token.
    #[sea_orm(column_name = "token_hash")]
    pub token_hash: String,
    pub issued_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
    pub revoked: bool,
    #[sea_orm(nullable)]
    pub user_agent: Option<String>,
    #[sea_orm(nullable)]
    pub ip: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id"
    )]
    User,
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

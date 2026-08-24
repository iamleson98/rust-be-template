//! `SeaORM` Entity for `chat_channel_member`.
//!
//! Tracks explicit channel membership. Each row links a `user` to a
//! `chat_channel` with a role:
//!   - `"user"`      — the customer who started the channel.
//!   - `"employee"` — a support-staff member assigned to the channel.
//!   - `"bot"`       — a bot participant (e.g. ZeroClaw AI).
//!
//! Channels auto-create rows for the customer (`role="user"`) and the
//! ZeroClaw bot (`role="bot"`) on channel creation; employees are added
//! when assigned via the admin UI.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "chat_channel_member")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    #[sea_orm(column_type = "Text")]
    pub joined_at: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub left_at: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::chat_channel::Entity",
        from = "Column::ChannelId",
        to = "super::chat_channel::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    ChatChannel,
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    User,
}

impl Related<super::chat_channel::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ChatChannel.def()
    }
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

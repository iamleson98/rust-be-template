//! One claimed slot of a discount campaign — and, once redeemed, a line
//! of the operator payout ledger.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "coupon")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub code: String,
    pub campaign_id: Uuid,
    pub tier_id: Uuid,
    pub user_id: Option<Uuid>,
    /// The discount frozen at claim time, in VND.
    pub amount: i64,
    /// `held`, `reserved`, `redeemed`, `settled`, `expired`, `released`
    /// or `rejected`.
    pub status: String,
    /// The owner while `held`/`reserved`, else NULL (unique).
    pub active_holder: Option<Uuid>,
    /// Book before this (ISO-8601 UTC); NULL = no end.
    #[sea_orm(column_type = "Text", nullable)]
    pub valid_until: Option<String>,
    #[sea_orm(unique)]
    pub booking_id: Option<Uuid>,
    /// The operator of the booking it was used on (who gets paid).
    pub brand_id: Option<Uuid>,
    pub claim_ip: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub claimed_at: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub reserved_at: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub redeemed_at: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub settled_at: Option<String>,
    pub settled_by: Option<Uuid>,
    #[sea_orm(column_type = "Text", nullable)]
    pub settlement_note: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::discount_campaign::Entity",
        from = "Column::CampaignId",
        to = "super::discount_campaign::Column::Id"
    )]
    DiscountCampaign,
    #[sea_orm(
        belongs_to = "super::discount_tier::Entity",
        from = "Column::TierId",
        to = "super::discount_tier::Column::Id"
    )]
    DiscountTier,
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_delete = "SetNull"
    )]
    User,
    #[sea_orm(
        belongs_to = "super::booking::Entity",
        from = "Column::BookingId",
        to = "super::booking::Column::Id",
        on_delete = "SetNull"
    )]
    Booking,
    #[sea_orm(
        belongs_to = "super::brand::Entity",
        from = "Column::BrandId",
        to = "super::brand::Column::Id",
        on_delete = "SetNull"
    )]
    Brand,
}

impl Related<super::discount_campaign::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::DiscountCampaign.def()
    }
}

impl Related<super::discount_tier::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::DiscountTier.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

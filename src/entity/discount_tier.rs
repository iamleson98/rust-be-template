//! One "amount × slots" line of a discount campaign.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "discount_tier")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub campaign_id: Uuid,
    /// The discount, in VND.
    pub amount: i64,
    pub total_slots: i32,
    /// Coupons handed out (and not given back); `<= total_slots`.
    pub claimed_slots: i32,
    pub position: i16,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::discount_campaign::Entity",
        from = "Column::CampaignId",
        to = "super::discount_campaign::Column::Id",
        on_delete = "Cascade"
    )]
    DiscountCampaign,
    #[sea_orm(has_many = "super::coupon::Entity")]
    Coupon,
}

impl Related<super::discount_campaign::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::DiscountCampaign.def()
    }
}

impl Related<super::coupon::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Coupon.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

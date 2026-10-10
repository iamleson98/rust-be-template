//! A discount campaign (see `docs/CAMPAIGNS.md`).

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "discount_campaign")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub description: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub starts_at: String,
    #[sea_orm(column_type = "Text")]
    pub ends_at: String,
    /// `campaign` (coupons must be booked before `ends_at`) or `permanent`.
    pub coupon_validity: String,
    pub all_brands: bool,
    pub paused: bool,
    pub created_by: Option<Uuid>,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::discount_tier::Entity")]
    DiscountTier,
    #[sea_orm(has_many = "super::discount_campaign_brand::Entity")]
    DiscountCampaignBrand,
    #[sea_orm(has_many = "super::coupon::Entity")]
    Coupon,
}

impl Related<super::discount_tier::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::DiscountTier.def()
    }
}

impl Related<super::discount_campaign_brand::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::DiscountCampaignBrand.def()
    }
}

impl Related<super::coupon::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Coupon.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

//! An operator a discount campaign covers (when it does not cover all).

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "discount_campaign_brand")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub campaign_id: Uuid,
    #[sea_orm(primary_key, auto_increment = false)]
    pub brand_id: Uuid,
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
    #[sea_orm(
        belongs_to = "super::brand::Entity",
        from = "Column::BrandId",
        to = "super::brand::Column::Id",
        on_delete = "Cascade"
    )]
    Brand,
}

impl Related<super::discount_campaign::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::DiscountCampaign.def()
    }
}

impl Related<super::brand::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Brand.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

//! Discount campaign store — campaigns, tiers, coupons and the payout
//! ledger (see `docs/CAMPAIGNS.md`). The money rules are enforced here,
//! in single statements or transactions, so no caller can break them:
//!
//! * a slot is taken with `claimed_slots = claimed_slots + 1 WHERE
//!   claimed_slots < total_slots` — never more coupons than slots;
//! * one held coupon per account and one coupon per account per campaign
//!   are unique indexes (`active_holder`, `(campaign_id, user_id)`);
//! * every status change is conditional on the status it leaves, so two
//!   racing actions can never both apply.
//!
//! Timestamps are second-precision ISO-8601 UTC strings (fixed width, so
//! text order is time order), like the booking store's.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, DbErr,
    EntityTrait, JoinType, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, RelationTrait,
    Set, SqlErr, TransactionTrait,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::{
    booking, coupon, discount_campaign, discount_campaign_brand as campaign_brand, discount_tier,
};

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

/// Coupon statuses.
pub mod coupon_status {
    /// Claimed, not used yet.
    pub const HELD: &str = "held";
    /// On a booking that has not travelled yet.
    pub const RESERVED: &str = "reserved";
    /// The trip happened: the platform owes the operator the amount.
    pub const REDEEMED: &str = "redeemed";
    /// An admin paid the operator.
    pub const SETTLED: &str = "settled";
    /// An admin refused the payout after review.
    pub const REJECTED: &str = "rejected";
    /// Its window passed before it was used.
    pub const EXPIRED: &str = "expired";
    /// Its owner gave it up.
    pub const RELEASED: &str = "released";
}

/// How long a campaign's coupons stay usable.
pub mod coupon_validity {
    /// Book before the campaign ends.
    pub const CAMPAIGN: &str = "campaign";
    /// No end.
    pub const PERMANENT: &str = "permanent";
}

use coupon_status::*;

/// A campaign with its tiers (by position) and operators.
#[derive(Debug, Clone)]
pub struct CampaignBundle {
    pub campaign: discount_campaign::Model,
    pub tiers: Vec<discount_tier::Model>,
    /// Empty when the campaign covers every operator.
    pub brand_ids: Vec<Uuid>,
}

/// A tier as the admin wants it after an edit. `id` is `None` for a new
/// tier.
#[derive(Debug, Clone)]
pub struct TierSpec {
    pub id: Option<Uuid>,
    pub amount: i64,
    pub total_slots: i64,
    pub position: i16,
}

/// Everything an admin edit changes, applied in one transaction.
#[derive(Debug, Clone)]
pub struct CampaignEdit {
    /// The campaign columns to write (unchanged ones left `NotSet`).
    pub campaign: discount_campaign::ActiveModel,
    /// The new operator list; `None` keeps it.
    pub brand_ids: Option<Vec<Uuid>>,
    /// Tiers to create or update.
    pub tiers: Vec<TierSpec>,
    /// Tiers to delete (only possible while nobody claimed them).
    pub delete_tiers: Vec<Uuid>,
    /// The campaign's new end, when it moved and its coupons end with it:
    /// outstanding coupons follow.
    pub coupons_valid_until: Option<String>,
}

/// A claim request; the service has checked who may claim.
#[derive(Debug, Clone)]
pub struct NewClaim {
    pub user_id: Uuid,
    pub campaign_id: Uuid,
    pub tier_id: Uuid,
    pub code: String,
    pub claim_ip: Option<String>,
    pub now: String,
}

#[derive(Debug, Clone)]
pub enum ClaimOutcome {
    /// The coupon, and the slots its tier has left.
    Claimed {
        coupon: coupon::Model,
        remaining: i64,
    },
    /// The account already holds this coupon.
    AlreadyHolding(coupon::Model),
    /// The account already had a coupon from this campaign.
    AlreadyClaimedCampaign,
    SoldOut,
    /// Paused, not started, ended, or the tier is not the campaign's.
    NotRunning,
}

/// Which coupons an admin list shows.
#[derive(Debug, Clone, Default)]
pub struct CouponFilter {
    pub campaign_id: Option<Uuid>,
    pub brand_id: Option<Uuid>,
    pub statuses: Vec<String>,
    pub limit: u64,
    pub offset: u64,
}

/// Count and total amount of one campaign's coupons in one status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusTotal {
    pub campaign_id: Uuid,
    pub status: String,
    pub count: i64,
    pub amount: i64,
}

/// Count and total amount owed (`redeemed`) or paid (`settled`) to one
/// operator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayoutTotal {
    pub brand_id: Option<Uuid>,
    pub status: String,
    pub count: i64,
    pub amount: i64,
}

#[async_trait]
pub trait CampaignStore: Send + Sync {
    async fn create_campaign(
        &self,
        campaign: discount_campaign::ActiveModel,
        brand_ids: Vec<Uuid>,
        tiers: Vec<discount_tier::ActiveModel>,
    ) -> StoreResult<()>;

    /// Apply an admin edit. `Conflict` when a tier changed under it (a
    /// claim made a shrink or amount change invalid).
    async fn update_campaign(&self, id: Uuid, edit: CampaignEdit) -> StoreResult<()>;

    /// Delete a campaign nobody claimed from. `false` when it has coupons.
    async fn delete_campaign(&self, id: Uuid) -> StoreResult<bool>;

    async fn find_campaign(&self, id: Uuid) -> StoreResult<Option<CampaignBundle>>;

    /// Every campaign, newest start first (the admin list).
    async fn list_campaigns(&self) -> StoreResult<Vec<CampaignBundle>>;

    /// Campaigns that have not ended and are not paused, soonest start
    /// first (the home page).
    async fn list_live_campaigns(&self, now: &str) -> StoreResult<Vec<CampaignBundle>>;

    /// Coupon counts and amounts per campaign and status.
    async fn status_totals(&self, campaign_ids: &[Uuid]) -> StoreResult<Vec<StatusTotal>>;

    /// Take a slot of `tier_id` for `user_id`.
    async fn claim(&self, claim: NewClaim) -> StoreResult<ClaimOutcome>;

    /// The coupon `user_id` holds (`held` or `reserved`), after expiring
    /// a held one whose window passed.
    async fn active_coupon(&self, user_id: Uuid, now: &str) -> StoreResult<Option<coupon::Model>>;

    /// Campaigns `user_id` has claimed from.
    async fn claimed_campaign_ids(&self, user_id: Uuid) -> StoreResult<Vec<Uuid>>;

    /// Give up the held coupon of `user_id`; its slot goes back while the
    /// campaign still runs. The released coupon, if there was one.
    async fn release_coupon(&self, user_id: Uuid, now: &str) -> StoreResult<Option<coupon::Model>>;

    /// Put `coupon_id` on a booking. `false` when it is no longer the
    /// held, valid coupon of `user_id`.
    async fn reserve_coupon(
        &self,
        coupon_id: Uuid,
        user_id: Uuid,
        booking_id: Uuid,
        brand_id: Option<Uuid>,
        now: &str,
    ) -> StoreResult<bool>;

    /// Undo `reserve_coupon` for a booking that was never placed.
    async fn unreserve_coupon(&self, booking_id: Uuid, now: &str) -> StoreResult<()>;

    async fn find_coupon(&self, id: Uuid) -> StoreResult<Option<coupon::Model>>;

    /// The coupon used on `booking_id`, if any.
    async fn coupon_of_booking(&self, booking_id: Uuid) -> StoreResult<Option<coupon::Model>>;

    /// A page of coupons, latest change first, and the total.
    async fn list_coupons(&self, filter: &CouponFilter) -> StoreResult<(Vec<coupon::Model>, u64)>;

    /// How many coupons of each `(campaign, ip)` were claimed.
    async fn claims_per_ip(
        &self,
        campaign_ids: &[Uuid],
        ips: &[String],
    ) -> StoreResult<HashMap<(Uuid, String), i64>>;

    /// How many coupons of each `(campaign, contact phone)` were used on
    /// bookings (reserved or later).
    async fn uses_per_phone(
        &self,
        campaign_ids: &[Uuid],
        phones: &[String],
    ) -> StoreResult<HashMap<(Uuid, String), i64>>;

    /// Owed and paid totals per operator.
    async fn payout_totals(&self) -> StoreResult<Vec<PayoutTotal>>;

    /// Mark redeemed coupons paid. How many were.
    async fn settle_coupons(
        &self,
        ids: &[Uuid],
        admin: Uuid,
        note: Option<String>,
        now: &str,
    ) -> StoreResult<u64>;

    /// Refuse the payout of a redeemed coupon. `false` when it is not
    /// redeemed (any more).
    async fn reject_coupon(
        &self,
        id: Uuid,
        admin: Uuid,
        reason: String,
        now: &str,
    ) -> StoreResult<bool>;

    /// Expire held coupons whose window passed. How many.
    async fn expire_stale(&self, now: &str) -> StoreResult<u64>;
}

#[derive(Clone)]
pub struct DbCampaignStore {
    db: Arc<DatabaseConnection>,
}

impl DbCampaignStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbCampaignStore {}

fn is_unique_violation(e: &DbErr) -> bool {
    matches!(e.sql_err(), Some(SqlErr::UniqueConstraintViolation(_)))
}

/// Coupons still usable at `now`.
fn still_valid(now: &str) -> Condition {
    Condition::any()
        .add(coupon::Column::ValidUntil.is_null())
        .add(coupon::Column::ValidUntil.gt(now))
}

/// Expire the held coupons of `user_id` (or of everyone) whose window
/// passed.
async fn expire_held<C: ConnectionTrait>(
    conn: &C,
    user_id: Option<Uuid>,
    now: &str,
) -> Result<u64, DbErr> {
    let mut q = coupon::Entity::update_many()
        .col_expr(coupon::Column::Status, Expr::value(EXPIRED))
        .col_expr(coupon::Column::ActiveHolder, Expr::value(None::<Uuid>))
        .col_expr(coupon::Column::UpdatedAt, Expr::value(now))
        .filter(coupon::Column::Status.eq(HELD))
        .filter(coupon::Column::ValidUntil.lte(now));
    if let Some(user_id) = user_id {
        q = q.filter(coupon::Column::ActiveHolder.eq(user_id));
    }
    Ok(q.exec(conn).await?.rows_affected)
}

/// Inside the transaction that cancels or expires `booking_id`: its
/// coupon goes back to its owner while still valid, else it expires
/// (which frees the owner to claim another).
pub(crate) async fn return_booking_coupon<C: ConnectionTrait>(
    conn: &C,
    booking_id: Uuid,
    now: &str,
) -> Result<(), DbErr> {
    coupon::Entity::update_many()
        .col_expr(coupon::Column::Status, Expr::value(HELD))
        .col_expr(coupon::Column::BookingId, Expr::value(None::<Uuid>))
        .col_expr(coupon::Column::BrandId, Expr::value(None::<Uuid>))
        .col_expr(coupon::Column::ReservedAt, Expr::value(None::<String>))
        .col_expr(coupon::Column::UpdatedAt, Expr::value(now))
        .filter(coupon::Column::BookingId.eq(booking_id))
        .filter(coupon::Column::Status.eq(RESERVED))
        .filter(still_valid(now))
        .exec(conn)
        .await?;
    coupon::Entity::update_many()
        .col_expr(coupon::Column::Status, Expr::value(EXPIRED))
        .col_expr(coupon::Column::ActiveHolder, Expr::value(None::<Uuid>))
        .col_expr(coupon::Column::UpdatedAt, Expr::value(now))
        .filter(coupon::Column::BookingId.eq(booking_id))
        .filter(coupon::Column::Status.eq(RESERVED))
        .exec(conn)
        .await?;
    Ok(())
}

/// Inside the transaction that completes `booking_id`: the trip happened,
/// so its coupon becomes payable to the operator (pending admin review),
/// and its owner may claim again.
pub(crate) async fn redeem_booking_coupon<C: ConnectionTrait>(
    conn: &C,
    booking_id: Uuid,
    now: &str,
) -> Result<(), DbErr> {
    coupon::Entity::update_many()
        .col_expr(coupon::Column::Status, Expr::value(REDEEMED))
        .col_expr(coupon::Column::ActiveHolder, Expr::value(None::<Uuid>))
        .col_expr(
            coupon::Column::RedeemedAt,
            Expr::value(Some(now.to_string())),
        )
        .col_expr(coupon::Column::UpdatedAt, Expr::value(now))
        .filter(coupon::Column::BookingId.eq(booking_id))
        .filter(coupon::Column::Status.eq(RESERVED))
        .exec(conn)
        .await?;
    Ok(())
}

/// Attach tiers (by position) and operators to campaigns.
async fn bundle<C: ConnectionTrait>(
    conn: &C,
    campaigns: Vec<discount_campaign::Model>,
) -> Result<Vec<CampaignBundle>, DbErr> {
    if campaigns.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = campaigns.iter().map(|c| c.id).collect();
    let tiers = discount_tier::Entity::find()
        .filter(discount_tier::Column::CampaignId.is_in(ids.clone()))
        .order_by_asc(discount_tier::Column::Position)
        .order_by_desc(discount_tier::Column::Amount)
        .all(conn)
        .await?;
    let brands = campaign_brand::Entity::find()
        .filter(campaign_brand::Column::CampaignId.is_in(ids))
        .all(conn)
        .await?;
    Ok(campaigns
        .into_iter()
        .map(|campaign| CampaignBundle {
            tiers: tiers
                .iter()
                .filter(|t| t.campaign_id == campaign.id)
                .cloned()
                .collect(),
            brand_ids: brands
                .iter()
                .filter(|b| b.campaign_id == campaign.id)
                .map(|b| b.brand_id)
                .collect(),
            campaign,
        })
        .collect())
}

async fn insert_brands<C: ConnectionTrait>(
    conn: &C,
    campaign_id: Uuid,
    brand_ids: &[Uuid],
) -> Result<(), DbErr> {
    if brand_ids.is_empty() {
        return Ok(());
    }
    campaign_brand::Entity::insert_many(brand_ids.iter().map(|&brand_id| {
        campaign_brand::ActiveModel {
            campaign_id: Set(campaign_id),
            brand_id: Set(brand_id),
        }
    }))
    .exec_without_returning(conn)
    .await?;
    Ok(())
}

#[async_trait]
#[retry]
impl CampaignStore for DbCampaignStore {
    async fn create_campaign(
        &self,
        campaign: discount_campaign::ActiveModel,
        brand_ids: Vec<Uuid>,
        tiers: Vec<discount_tier::ActiveModel>,
    ) -> StoreResult<()> {
        self.db
            .transaction::<_, (), StoreError>(|txn| {
                Box::pin(async move {
                    let campaign_id = *campaign.id.try_as_ref().ok_or_else(|| {
                        StoreError::Validation("a new campaign needs its id".into())
                    })?;
                    discount_campaign::Entity::insert(campaign)
                        .exec_without_returning(txn)
                        .await?;
                    insert_brands(txn, campaign_id, &brand_ids).await?;
                    if !tiers.is_empty() {
                        discount_tier::Entity::insert_many(tiers)
                            .exec_without_returning(txn)
                            .await?;
                    }
                    Ok(())
                })
            })
            .await
            .map_err(StoreError::from)
    }

    async fn update_campaign(&self, id: Uuid, edit: CampaignEdit) -> StoreResult<()> {
        self.db
            .transaction::<_, (), StoreError>(|txn| {
                Box::pin(async move {
                    let CampaignEdit {
                        campaign,
                        brand_ids,
                        tiers,
                        delete_tiers,
                        coupons_valid_until,
                    } = edit;
                    campaign.update(txn).await?;
                    if let Some(valid_until) = coupons_valid_until {
                        coupon::Entity::update_many()
                            .col_expr(coupon::Column::ValidUntil, Expr::value(Some(valid_until)))
                            .filter(coupon::Column::CampaignId.eq(id))
                            .filter(coupon::Column::Status.is_in([HELD, RESERVED]))
                            .filter(coupon::Column::ValidUntil.is_not_null())
                            .exec(txn)
                            .await?;
                    }
                    if let Some(brand_ids) = brand_ids {
                        campaign_brand::Entity::delete_many()
                            .filter(campaign_brand::Column::CampaignId.eq(id))
                            .exec(txn)
                            .await?;
                        insert_brands(txn, id, &brand_ids).await?;
                    }
                    for tier_id in delete_tiers {
                        let gone = discount_tier::Entity::delete_many()
                            .filter(discount_tier::Column::Id.eq(tier_id))
                            .filter(discount_tier::Column::CampaignId.eq(id))
                            .filter(discount_tier::Column::ClaimedSlots.eq(0))
                            .exec(txn)
                            .await?
                            .rows_affected;
                        if gone == 0 {
                            return Err(StoreError::Conflict(
                                "a tier with claimed coupons cannot be removed".into(),
                            ));
                        }
                    }
                    let now = super::now_iso();
                    for tier in tiers {
                        match tier.id {
                            Some(tier_id) => {
                                // Slots may shrink only down to what is
                                // claimed; a claimed tier keeps its amount.
                                let changed = discount_tier::Entity::update_many()
                                    .col_expr(
                                        discount_tier::Column::Amount,
                                        Expr::value(tier.amount),
                                    )
                                    .col_expr(
                                        discount_tier::Column::TotalSlots,
                                        Expr::value(tier.total_slots),
                                    )
                                    .col_expr(
                                        discount_tier::Column::Position,
                                        Expr::value(tier.position),
                                    )
                                    .filter(discount_tier::Column::Id.eq(tier_id))
                                    .filter(discount_tier::Column::CampaignId.eq(id))
                                    .filter(
                                        discount_tier::Column::ClaimedSlots.lte(tier.total_slots),
                                    )
                                    .filter(
                                        Condition::any()
                                            .add(discount_tier::Column::ClaimedSlots.eq(0))
                                            .add(discount_tier::Column::Amount.eq(tier.amount)),
                                    )
                                    .exec(txn)
                                    .await?
                                    .rows_affected;
                                if changed == 0 {
                                    return Err(StoreError::Conflict(
                                        "coupons were claimed meanwhile: a tier cannot drop below \
                                         its claimed slots or change its amount"
                                            .into(),
                                    ));
                                }
                            }
                            None => {
                                discount_tier::Entity::insert(discount_tier::ActiveModel {
                                    id: Set(Uuid::new_v4()),
                                    campaign_id: Set(id),
                                    amount: Set(tier.amount),
                                    total_slots: Set(tier.total_slots),
                                    claimed_slots: Set(0),
                                    position: Set(tier.position),
                                    created_at: Set(now.clone()),
                                })
                                .exec_without_returning(txn)
                                .await?;
                            }
                        }
                    }
                    Ok(())
                })
            })
            .await
            .map_err(|e| match StoreError::from(e) {
                StoreError::Database(msg) if msg.to_lowercase().contains("unique") => {
                    StoreError::Conflict("two tiers cannot have the same amount".into())
                }
                other => other,
            })
    }

    async fn delete_campaign(&self, id: Uuid) -> StoreResult<bool> {
        self.db
            .transaction::<_, bool, StoreError>(|txn| {
                Box::pin(async move {
                    let claimed = coupon::Entity::find()
                        .filter(coupon::Column::CampaignId.eq(id))
                        .count(txn)
                        .await?;
                    if claimed > 0 {
                        return Ok(false);
                    }
                    discount_campaign::Entity::delete_by_id(id)
                        .exec(txn)
                        .await?;
                    Ok(true)
                })
            })
            .await
            .map_err(StoreError::from)
    }

    async fn find_campaign(&self, id: Uuid) -> StoreResult<Option<CampaignBundle>> {
        let Some(campaign) = discount_campaign::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
        else {
            return Ok(None);
        };
        Ok(bundle(self.db.as_ref(), vec![campaign]).await?.pop())
    }

    async fn list_campaigns(&self) -> StoreResult<Vec<CampaignBundle>> {
        let campaigns = discount_campaign::Entity::find()
            .order_by_desc(discount_campaign::Column::StartsAt)
            .all(self.db.as_ref())
            .await?;
        Ok(bundle(self.db.as_ref(), campaigns).await?)
    }

    async fn list_live_campaigns(&self, now: &str) -> StoreResult<Vec<CampaignBundle>> {
        let campaigns = discount_campaign::Entity::find()
            .filter(discount_campaign::Column::EndsAt.gt(now))
            .filter(discount_campaign::Column::Paused.eq(false))
            .order_by_asc(discount_campaign::Column::StartsAt)
            .all(self.db.as_ref())
            .await?;
        Ok(bundle(self.db.as_ref(), campaigns).await?)
    }

    async fn status_totals(&self, campaign_ids: &[Uuid]) -> StoreResult<Vec<StatusTotal>> {
        if campaign_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = coupon::Entity::find()
            .select_only()
            .column(coupon::Column::CampaignId)
            .column(coupon::Column::Status)
            .column_as(coupon::Column::Id.count(), "n")
            .column_as(coupon::Column::Amount.sum(), "total")
            .filter(coupon::Column::CampaignId.is_in(campaign_ids.to_vec()))
            .group_by(coupon::Column::CampaignId)
            .group_by(coupon::Column::Status)
            .into_tuple::<(Uuid, String, i64, Option<i64>)>()
            .all(self.db.as_ref())
            .await?;
        Ok(rows
            .into_iter()
            .map(|(campaign_id, status, count, amount)| StatusTotal {
                campaign_id,
                status,
                count,
                amount: amount.unwrap_or(0),
            })
            .collect())
    }

    async fn claim(&self, claim: NewClaim) -> StoreResult<ClaimOutcome> {
        self.db
            .transaction::<_, ClaimOutcome, StoreError>(|txn| {
                Box::pin(async move {
                    // Writing first takes the write lock for the whole claim.
                    expire_held(txn, Some(claim.user_id), &claim.now).await?;

                    let Some(campaign) = discount_campaign::Entity::find_by_id(claim.campaign_id)
                        .one(txn)
                        .await?
                    else {
                        return Ok(ClaimOutcome::NotRunning);
                    };
                    let running = !campaign.paused
                        && campaign.starts_at.as_str() <= claim.now.as_str()
                        && claim.now.as_str() < campaign.ends_at.as_str();
                    if !running {
                        return Ok(ClaimOutcome::NotRunning);
                    }
                    if let Some(held) = coupon::Entity::find()
                        .filter(coupon::Column::ActiveHolder.eq(claim.user_id))
                        .one(txn)
                        .await?
                    {
                        return Ok(ClaimOutcome::AlreadyHolding(held));
                    }
                    let before = coupon::Entity::find()
                        .filter(coupon::Column::CampaignId.eq(claim.campaign_id))
                        .filter(coupon::Column::UserId.eq(claim.user_id))
                        .count(txn)
                        .await?;
                    if before > 0 {
                        return Ok(ClaimOutcome::AlreadyClaimedCampaign);
                    }

                    let Some(tier) = discount_tier::Entity::find_by_id(claim.tier_id)
                        .filter(discount_tier::Column::CampaignId.eq(claim.campaign_id))
                        .one(txn)
                        .await?
                    else {
                        return Ok(ClaimOutcome::NotRunning);
                    };
                    // The slot: one atomic check-and-take.
                    let taken = discount_tier::Entity::update_many()
                        .col_expr(
                            discount_tier::Column::ClaimedSlots,
                            Expr::col(discount_tier::Column::ClaimedSlots).add(1),
                        )
                        .filter(discount_tier::Column::Id.eq(tier.id))
                        .filter(
                            Expr::col(discount_tier::Column::ClaimedSlots)
                                .lt(Expr::col(discount_tier::Column::TotalSlots)),
                        )
                        .exec(txn)
                        .await?
                        .rows_affected;
                    if taken == 0 {
                        return Ok(ClaimOutcome::SoldOut);
                    }

                    let id = Uuid::new_v4();
                    let valid_until = (campaign.coupon_validity == coupon_validity::CAMPAIGN)
                        .then(|| campaign.ends_at.clone());
                    let inserted = coupon::Entity::insert(coupon::ActiveModel {
                        id: Set(id),
                        code: Set(claim.code),
                        campaign_id: Set(campaign.id),
                        tier_id: Set(tier.id),
                        user_id: Set(Some(claim.user_id)),
                        amount: Set(tier.amount),
                        status: Set(HELD.into()),
                        active_holder: Set(Some(claim.user_id)),
                        valid_until: Set(valid_until),
                        booking_id: Set(None),
                        brand_id: Set(None),
                        claim_ip: Set(claim.claim_ip),
                        claimed_at: Set(claim.now.clone()),
                        reserved_at: Set(None),
                        redeemed_at: Set(None),
                        settled_at: Set(None),
                        settled_by: Set(None),
                        settlement_note: Set(None),
                        updated_at: Set(claim.now),
                    })
                    .exec_without_returning(txn)
                    .await;
                    match inserted {
                        Ok(_) => {}
                        // A racing claim of the same account (or a code
                        // collision): roll the slot back, the caller retries.
                        Err(e) if is_unique_violation(&e) => {
                            return Err(StoreError::Conflict("coupon claim raced".into()))
                        }
                        Err(e) => return Err(e.into()),
                    }
                    let coupon = coupon::Entity::find_by_id(id)
                        .one(txn)
                        .await?
                        .ok_or_else(|| StoreError::NotFound("claimed coupon".into()))?;
                    // Exact: this transaction holds the write lock.
                    let remaining = tier.total_slots - tier.claimed_slots - 1;
                    Ok(ClaimOutcome::Claimed { coupon, remaining })
                })
            })
            .await
            .map_err(StoreError::from)
    }

    async fn active_coupon(&self, user_id: Uuid, now: &str) -> StoreResult<Option<coupon::Model>> {
        expire_held(self.db.as_ref(), Some(user_id), now).await?;
        Ok(coupon::Entity::find()
            .filter(coupon::Column::ActiveHolder.eq(user_id))
            .one(self.db.as_ref())
            .await?)
    }

    async fn claimed_campaign_ids(&self, user_id: Uuid) -> StoreResult<Vec<Uuid>> {
        Ok(coupon::Entity::find()
            .select_only()
            .column(coupon::Column::CampaignId)
            .filter(coupon::Column::UserId.eq(user_id))
            .into_tuple::<Uuid>()
            .all(self.db.as_ref())
            .await?)
    }

    async fn release_coupon(&self, user_id: Uuid, now: &str) -> StoreResult<Option<coupon::Model>> {
        let now = now.to_string();
        self.db
            .transaction::<_, Option<coupon::Model>, StoreError>(|txn| {
                Box::pin(async move {
                    let Some(held) = coupon::Entity::find()
                        .filter(coupon::Column::ActiveHolder.eq(user_id))
                        .filter(coupon::Column::Status.eq(HELD))
                        .one(txn)
                        .await?
                    else {
                        return Ok(None);
                    };
                    let released = coupon::Entity::update_many()
                        .col_expr(coupon::Column::Status, Expr::value(RELEASED))
                        .col_expr(coupon::Column::ActiveHolder, Expr::value(None::<Uuid>))
                        .col_expr(coupon::Column::UpdatedAt, Expr::value(now.clone()))
                        .filter(coupon::Column::Id.eq(held.id))
                        .filter(coupon::Column::Status.eq(HELD))
                        .exec(txn)
                        .await?
                        .rows_affected;
                    if released == 0 {
                        return Ok(None);
                    }
                    // While the campaign runs, someone else can have the slot.
                    let running = discount_campaign::Entity::find_by_id(held.campaign_id)
                        .filter(discount_campaign::Column::EndsAt.gt(now.as_str()))
                        .count(txn)
                        .await?
                        > 0;
                    if running {
                        discount_tier::Entity::update_many()
                            .col_expr(
                                discount_tier::Column::ClaimedSlots,
                                Expr::col(discount_tier::Column::ClaimedSlots).sub(1),
                            )
                            .filter(discount_tier::Column::Id.eq(held.tier_id))
                            .filter(discount_tier::Column::ClaimedSlots.gt(0))
                            .exec(txn)
                            .await?;
                    }
                    Ok(Some(held))
                })
            })
            .await
            .map_err(StoreError::from)
    }

    async fn reserve_coupon(
        &self,
        coupon_id: Uuid,
        user_id: Uuid,
        booking_id: Uuid,
        brand_id: Option<Uuid>,
        now: &str,
    ) -> StoreResult<bool> {
        let reserved = coupon::Entity::update_many()
            .col_expr(coupon::Column::Status, Expr::value(RESERVED))
            .col_expr(coupon::Column::BookingId, Expr::value(Some(booking_id)))
            .col_expr(coupon::Column::BrandId, Expr::value(brand_id))
            .col_expr(
                coupon::Column::ReservedAt,
                Expr::value(Some(now.to_string())),
            )
            .col_expr(coupon::Column::UpdatedAt, Expr::value(now))
            .filter(coupon::Column::Id.eq(coupon_id))
            .filter(coupon::Column::ActiveHolder.eq(user_id))
            .filter(coupon::Column::Status.eq(HELD))
            .filter(still_valid(now))
            .exec(self.db.as_ref())
            .await?
            .rows_affected;
        Ok(reserved == 1)
    }

    async fn unreserve_coupon(&self, booking_id: Uuid, now: &str) -> StoreResult<()> {
        return_booking_coupon(self.db.as_ref(), booking_id, now).await?;
        Ok(())
    }

    async fn find_coupon(&self, id: Uuid) -> StoreResult<Option<coupon::Model>> {
        Ok(coupon::Entity::find_by_id(id).one(self.db.as_ref()).await?)
    }

    async fn coupon_of_booking(&self, booking_id: Uuid) -> StoreResult<Option<coupon::Model>> {
        Ok(coupon::Entity::find()
            .filter(coupon::Column::BookingId.eq(booking_id))
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_coupons(&self, filter: &CouponFilter) -> StoreResult<(Vec<coupon::Model>, u64)> {
        let mut q = coupon::Entity::find();
        if let Some(campaign_id) = filter.campaign_id {
            q = q.filter(coupon::Column::CampaignId.eq(campaign_id));
        }
        if let Some(brand_id) = filter.brand_id {
            q = q.filter(coupon::Column::BrandId.eq(brand_id));
        }
        if !filter.statuses.is_empty() {
            q = q.filter(coupon::Column::Status.is_in(filter.statuses.clone()));
        }
        let total = q.clone().count(self.db.as_ref()).await?;
        let items = q
            .order_by_desc(coupon::Column::UpdatedAt)
            .order_by_desc(coupon::Column::Id)
            .limit(filter.limit)
            .offset(filter.offset)
            .all(self.db.as_ref())
            .await?;
        Ok((items, total))
    }

    async fn claims_per_ip(
        &self,
        campaign_ids: &[Uuid],
        ips: &[String],
    ) -> StoreResult<HashMap<(Uuid, String), i64>> {
        if campaign_ids.is_empty() || ips.is_empty() {
            return Ok(HashMap::new());
        }
        let rows = coupon::Entity::find()
            .select_only()
            .column(coupon::Column::CampaignId)
            .column(coupon::Column::ClaimIp)
            .column_as(coupon::Column::Id.count(), "n")
            .filter(coupon::Column::CampaignId.is_in(campaign_ids.to_vec()))
            .filter(coupon::Column::ClaimIp.is_in(ips.to_vec()))
            .group_by(coupon::Column::CampaignId)
            .group_by(coupon::Column::ClaimIp)
            .into_tuple::<(Uuid, String, i64)>()
            .all(self.db.as_ref())
            .await?;
        Ok(rows.into_iter().map(|(c, ip, n)| ((c, ip), n)).collect())
    }

    async fn uses_per_phone(
        &self,
        campaign_ids: &[Uuid],
        phones: &[String],
    ) -> StoreResult<HashMap<(Uuid, String), i64>> {
        if campaign_ids.is_empty() || phones.is_empty() {
            return Ok(HashMap::new());
        }
        let rows = coupon::Entity::find()
            .select_only()
            .column(coupon::Column::CampaignId)
            .column_as(booking::Column::ContactPhone, "phone")
            .column_as(coupon::Column::Id.count(), "n")
            .join(JoinType::InnerJoin, coupon::Relation::Booking.def())
            .filter(coupon::Column::CampaignId.is_in(campaign_ids.to_vec()))
            .filter(booking::Column::ContactPhone.is_in(phones.to_vec()))
            .group_by(coupon::Column::CampaignId)
            .group_by(booking::Column::ContactPhone)
            .into_tuple::<(Uuid, String, i64)>()
            .all(self.db.as_ref())
            .await?;
        Ok(rows
            .into_iter()
            .map(|(c, phone, n)| ((c, phone), n))
            .collect())
    }

    async fn payout_totals(&self) -> StoreResult<Vec<PayoutTotal>> {
        let rows = coupon::Entity::find()
            .select_only()
            .column(coupon::Column::BrandId)
            .column(coupon::Column::Status)
            .column_as(coupon::Column::Id.count(), "n")
            .column_as(coupon::Column::Amount.sum(), "total")
            .filter(coupon::Column::Status.is_in([REDEEMED, SETTLED]))
            .group_by(coupon::Column::BrandId)
            .group_by(coupon::Column::Status)
            .into_tuple::<(Option<Uuid>, String, i64, Option<i64>)>()
            .all(self.db.as_ref())
            .await?;
        Ok(rows
            .into_iter()
            .map(|(brand_id, status, count, amount)| PayoutTotal {
                brand_id,
                status,
                count,
                amount: amount.unwrap_or(0),
            })
            .collect())
    }

    async fn settle_coupons(
        &self,
        ids: &[Uuid],
        admin: Uuid,
        note: Option<String>,
        now: &str,
    ) -> StoreResult<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        Ok(coupon::Entity::update_many()
            .col_expr(coupon::Column::Status, Expr::value(SETTLED))
            .col_expr(
                coupon::Column::SettledAt,
                Expr::value(Some(now.to_string())),
            )
            .col_expr(coupon::Column::SettledBy, Expr::value(Some(admin)))
            .col_expr(coupon::Column::SettlementNote, Expr::value(note))
            .col_expr(coupon::Column::UpdatedAt, Expr::value(now))
            .filter(coupon::Column::Id.is_in(ids.to_vec()))
            .filter(coupon::Column::Status.eq(REDEEMED))
            .exec(self.db.as_ref())
            .await?
            .rows_affected)
    }

    async fn reject_coupon(
        &self,
        id: Uuid,
        admin: Uuid,
        reason: String,
        now: &str,
    ) -> StoreResult<bool> {
        let rejected = coupon::Entity::update_many()
            .col_expr(coupon::Column::Status, Expr::value(REJECTED))
            .col_expr(
                coupon::Column::SettledAt,
                Expr::value(Some(now.to_string())),
            )
            .col_expr(coupon::Column::SettledBy, Expr::value(Some(admin)))
            .col_expr(coupon::Column::SettlementNote, Expr::value(Some(reason)))
            .col_expr(coupon::Column::UpdatedAt, Expr::value(now))
            .filter(coupon::Column::Id.eq(id))
            .filter(coupon::Column::Status.eq(REDEEMED))
            .exec(self.db.as_ref())
            .await?
            .rows_affected;
        Ok(rejected == 1)
    }

    async fn expire_stale(&self, now: &str) -> StoreResult<u64> {
        Ok(expire_held(self.db.as_ref(), None, now).await?)
    }
}

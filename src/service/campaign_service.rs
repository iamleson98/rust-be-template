//! Discount campaigns: the home-page list (cached), claiming a coupon,
//! using it on a booking, and the admin side — campaigns, payout review
//! and settlement. The rules are in `docs/CAMPAIGNS.md`; the store
//! enforces the ones money depends on.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use rand::Rng;
use sea_orm::{ActiveValue::NotSet, Set};
use uuid::Uuid;

use crate::cache::{get_or_fetch, get_serializable, set_serializable, CacheBackend};
use crate::dto::campaign::*;
use crate::entity::{audit_log, brand, coupon, discount_campaign, discount_tier};
use crate::error::{AppError, AppResult};
use crate::store::campaigns::{
    coupon_status, coupon_validity, CampaignBundle, CampaignEdit, ClaimOutcome, CouponFilter,
    NewClaim, TierSpec,
};
use crate::store::{CompositeStore, StoreError};

const PUBLIC_KEY: &str = "campaigns:public:v1";
/// How long the home page's list is cached. Claims write their slot count
/// through (`note_remaining`); other changes invalidate it.
const PUBLIC_TTL: Duration = Duration::from_secs(15);
/// An account younger than this when it claims is flagged for review.
const NEW_ACCOUNT_HOURS: i64 = 24;
const MAX_TIERS: usize = 20;
const MAX_SLOTS: i64 = 1_000_000;
const MIN_AMOUNT: i64 = 1_000;
const MAX_AMOUNT: i64 = 10_000_000;
const MAX_DAYS: i64 = 366;

/// Stable error codes the apps translate (the `message` of the error).
pub mod codes {
    pub const CUSTOMERS_ONLY: &str = "customers_only";
    pub const NOT_RUNNING: &str = "campaign_not_running";
    pub const ALREADY_HELD: &str = "coupon_already_held";
    pub const ALREADY_CLAIMED: &str = "campaign_already_claimed";
    pub const SOLD_OUT: &str = "tier_sold_out";
    pub const TRY_AGAIN: &str = "try_again";
    pub const UNAVAILABLE: &str = "coupon_unavailable";
    pub const EXPIRED: &str = "coupon_expired";
    pub const WRONG_OPERATOR: &str = "coupon_not_for_this_operator";
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn iso(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// A readable coupon code: `DXV` + 7 characters without 0/O/1/I.
fn new_code() -> String {
    const ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let mut rng = rand::thread_rng();
    let tail: String = (0..7)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect();
    format!("DXV{tail}")
}

fn brand_out(b: &brand::Model) -> CampaignBrandOut {
    CampaignBrandOut {
        id: b.id,
        name: b.name.clone(),
        slug: b.slug.clone(),
        logo_url: b.logo_url.clone(),
    }
}

/// `upcoming`, `running`, `paused` or `ended` at `now`.
fn state_of(c: &discount_campaign::Model, now: &str) -> &'static str {
    if c.ends_at.as_str() <= now {
        "ended"
    } else if c.paused {
        "paused"
    } else if now < c.starts_at.as_str() {
        "upcoming"
    } else {
        "running"
    }
}

fn store_err(e: StoreError) -> AppError {
    match e {
        StoreError::Conflict(msg) => AppError::Conflict(msg),
        other => AppError::Store(other),
    }
}

/// The discount `coupon_id` gives on a booking of `subtotal` with
/// operator `brand_id`, after checking `user_id` may use it there.
/// Reserving it is the booking's last step (`CampaignStore::reserve_coupon`).
pub(crate) async fn coupon_discount(
    store: &CompositeStore,
    user_id: Option<Uuid>,
    coupon_id: Uuid,
    brand_id: Option<Uuid>,
    subtotal: i64,
) -> AppResult<i64> {
    let user_id =
        user_id.ok_or_else(|| AppError::Unauthorized("sign in to use a coupon".into()))?;
    let now = now_iso();
    let coupon = store
        .campaign_store()
        .find_coupon(coupon_id)
        .await?
        .filter(|c| c.active_holder == Some(user_id) && c.status == coupon_status::HELD)
        .ok_or_else(|| AppError::BadRequest(codes::UNAVAILABLE.into()))?;
    if coupon
        .valid_until
        .as_deref()
        .is_some_and(|until| until <= now.as_str())
    {
        return Err(AppError::BadRequest(codes::EXPIRED.into()));
    }
    let bundle = store
        .campaign_store()
        .find_campaign(coupon.campaign_id)
        .await?
        .ok_or_else(|| AppError::BadRequest(codes::UNAVAILABLE.into()))?;
    let covered =
        bundle.campaign.all_brands || brand_id.is_some_and(|b| bundle.brand_ids.contains(&b));
    if !covered {
        return Err(AppError::BadRequest(codes::WRONG_OPERATOR.into()));
    }
    Ok(coupon.amount.clamp(0, subtotal.max(0)))
}

/// A validated create/update request.
struct Valid {
    name: String,
    description: Option<String>,
    starts_at: String,
    ends_at: String,
    coupon_validity: String,
    all_brands: bool,
    brand_ids: Vec<Uuid>,
    tiers: Vec<TierInput>,
    paused: bool,
}

pub struct CampaignService {
    store: Arc<CompositeStore>,
    cache: Arc<dyn CacheBackend>,
}

impl CampaignService {
    pub fn new(store: Arc<CompositeStore>, cache: Arc<dyn CacheBackend>) -> Self {
        Self { store, cache }
    }

    // ── Public ────────────────────────────────────────────────────

    /// Running and upcoming campaigns, from the cache (one database
    /// query per `PUBLIC_TTL` per process at most).
    pub async fn public_campaigns(&self) -> AppResult<PublicCampaignListResponse> {
        let store = self.store.clone();
        let mut list = get_or_fetch(self.cache.as_ref(), PUBLIC_KEY, PUBLIC_TTL, || async move {
            load_public(&store).await
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
        let now = now_iso();
        // One that ended since it was cached is gone.
        list.items.retain(|c| c.ends_at > now);
        list.server_time = now;
        Ok(list)
    }

    async fn invalidate_public(&self) {
        if let Err(e) = self.cache.delete(PUBLIC_KEY).await {
            tracing::warn!(error = %e, "campaign cache invalidation failed; it expires on its own");
        }
    }

    /// Writes a claim's exact slot count into the cached list, so the next
    /// reader (usually the claimer) sees the slot gone without a database
    /// query. Counts only go down here, so a racing claim that read an older
    /// count never raises it (slots coming back invalidate the entry
    /// instead), and the entry keeps the expiry it was loaded with.
    async fn note_remaining(&self, tier_id: Uuid, remaining: i64) {
        let cache = self.cache.as_ref();
        let Ok(Some(mut list)) =
            get_serializable::<PublicCampaignListResponse>(cache, PUBLIC_KEY).await
        else {
            return; // Nothing cached: the next read loads fresh counts.
        };
        let Some(tier) = list
            .items
            .iter_mut()
            .flat_map(|c| c.tiers.iter_mut())
            .find(|t| t.id == tier_id)
        else {
            return;
        };
        if remaining >= tier.remaining {
            return;
        }
        tier.remaining = remaining.max(0);
        // The cached copy's `server_time` is when it was loaded.
        let age = DateTime::parse_from_rfc3339(&list.server_time)
            .map(|loaded| (Utc::now() - loaded.with_timezone(&Utc)).num_seconds())
            .unwrap_or(i64::MAX);
        let Some(left) = (PUBLIC_TTL.as_secs() as i64)
            .checked_sub(age)
            .filter(|s| *s > 0)
        else {
            return;
        };
        let ttl = Some(Duration::from_secs(left as u64));
        if let Err(e) = set_serializable(cache, PUBLIC_KEY, &list, ttl).await {
            tracing::warn!(error = %e, "campaign cache update failed; it expires on its own");
        }
    }

    // ── Customer ──────────────────────────────────────────────────

    pub async fn my_coupons(&self, user_id: Uuid) -> AppResult<MyCouponsResponse> {
        let campaigns = self.store.campaign_store();
        let active = match campaigns.active_coupon(user_id, &now_iso()).await? {
            Some(c) => Some(self.coupon_out(c).await?),
            None => None,
        };
        Ok(MyCouponsResponse {
            active,
            claimed_campaign_ids: campaigns.claimed_campaign_ids(user_id).await?,
        })
    }

    /// Claim a slot of `tier_id`. Customers only; one held coupon at a
    /// time and one per campaign.
    pub async fn claim(
        &self,
        user_id: Uuid,
        claim_ip: Option<String>,
        campaign_id: Uuid,
        tier_id: Uuid,
    ) -> AppResult<CouponOut> {
        let user = self.store.user_store().get_user(user_id).await?;
        // Staff and admins cannot award themselves coupons; bots, guests
        // and blocked accounts cannot claim either.
        if user.role != "user" || user.is_guest || user.is_bot || user.status != "active" {
            return Err(AppError::Forbidden(codes::CUSTOMERS_ONLY.into()));
        }
        let claim_ip = claim_ip.map(|ip| ip.chars().take(64).collect::<String>());
        let mut attempt = 0;
        let outcome = loop {
            attempt += 1;
            let result = self
                .store
                .campaign_store()
                .claim(NewClaim {
                    user_id,
                    campaign_id,
                    tier_id,
                    code: new_code(),
                    claim_ip: claim_ip.clone(),
                    now: now_iso(),
                })
                .await;
            match result {
                Ok(outcome) => break outcome,
                // A code collision or a racing claim: the state is fresh
                // on the second try.
                Err(StoreError::Conflict(_)) if attempt < 2 => continue,
                Err(StoreError::Conflict(_)) => {
                    return Err(AppError::Conflict(codes::TRY_AGAIN.into()))
                }
                Err(e) => return Err(e.into()),
            }
        };
        match outcome {
            ClaimOutcome::Claimed { coupon, remaining } => {
                if remaining <= 0 {
                    self.invalidate_public().await;
                } else {
                    self.note_remaining(tier_id, remaining).await;
                }
                self.coupon_out(coupon).await
            }
            ClaimOutcome::AlreadyHolding(_) => Err(AppError::Conflict(codes::ALREADY_HELD.into())),
            ClaimOutcome::AlreadyClaimedCampaign => {
                Err(AppError::Conflict(codes::ALREADY_CLAIMED.into()))
            }
            ClaimOutcome::SoldOut => {
                self.invalidate_public().await;
                Err(AppError::Gone(codes::SOLD_OUT.into()))
            }
            ClaimOutcome::NotRunning => Err(AppError::BadRequest(codes::NOT_RUNNING.into())),
        }
    }

    /// Give up the held coupon (to claim from another campaign). A coupon
    /// on a booking cannot be given up; cancel the booking first.
    pub async fn give_up(&self, user_id: Uuid) -> AppResult<()> {
        let released = self
            .store
            .campaign_store()
            .release_coupon(user_id, &now_iso())
            .await?;
        match released {
            Some(_) => {
                // A slot may be free again.
                self.invalidate_public().await;
                Ok(())
            }
            None => Err(AppError::NotFound("no unused coupon to give up".into())),
        }
    }

    async fn coupon_out(&self, c: coupon::Model) -> AppResult<CouponOut> {
        let bundle = self
            .store
            .campaign_store()
            .find_campaign(c.campaign_id)
            .await?
            .ok_or_else(|| AppError::NotFound("campaign".into()))?;
        let brands = self.brands(&bundle.brand_ids).await?;
        let booking_code = match (c.status.as_str(), c.booking_id) {
            (coupon_status::RESERVED, Some(id)) => self
                .store
                .booking_store()
                .find_booking_by_id(id)
                .await?
                .map(|b| b.code),
            _ => None,
        };
        Ok(CouponOut {
            id: c.id,
            code: c.code,
            campaign_id: c.campaign_id,
            campaign_name: bundle.campaign.name,
            amount: c.amount,
            status: c.status,
            valid_until: c.valid_until,
            all_brands: bundle.campaign.all_brands,
            brands: bundle
                .brand_ids
                .iter()
                .filter_map(|id| brands.get(id).cloned())
                .collect(),
            booking_code,
            claimed_at: c.claimed_at,
        })
    }

    async fn brands(&self, ids: &[Uuid]) -> AppResult<HashMap<Uuid, CampaignBrandOut>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        Ok(self
            .store
            .brand_store()
            .list_brands_by_ids(ids.to_vec())
            .await?
            .iter()
            .map(|b| (b.id, brand_out(b)))
            .collect())
    }

    // ── Admin: campaigns ──────────────────────────────────────────

    pub async fn admin_list(&self) -> AppResult<AdminCampaignListResponse> {
        let bundles = self.store.campaign_store().list_campaigns().await?;
        Ok(AdminCampaignListResponse {
            items: self.admin_out(bundles).await?,
        })
    }

    pub async fn admin_get(&self, id: Uuid) -> AppResult<AdminCampaignOut> {
        let bundle = self.find(id).await?;
        Ok(self.admin_out(vec![bundle]).await?.remove(0))
    }

    pub async fn create(&self, admin: Uuid, input: CampaignInput) -> AppResult<AdminCampaignOut> {
        let now = now_iso();
        let v = self.validate(input).await?;
        if v.ends_at.as_str() <= now.as_str() {
            return Err(AppError::Validation(
                "the end time must be in the future".into(),
            ));
        }
        let id = Uuid::new_v4();
        let campaign = discount_campaign::ActiveModel {
            id: Set(id),
            name: Set(v.name),
            description: Set(v.description),
            starts_at: Set(v.starts_at),
            ends_at: Set(v.ends_at),
            coupon_validity: Set(v.coupon_validity),
            all_brands: Set(v.all_brands),
            paused: Set(v.paused),
            created_by: Set(Some(admin)),
            created_at: Set(now.clone()),
            updated_at: Set(now.clone()),
        };
        let tiers = v
            .tiers
            .iter()
            .enumerate()
            .map(|(i, t)| discount_tier::ActiveModel {
                id: Set(Uuid::new_v4()),
                campaign_id: Set(id),
                amount: Set(t.amount),
                total_slots: Set(t.total_slots),
                claimed_slots: Set(0),
                position: Set(i as i16),
                created_at: Set(now.clone()),
            })
            .collect();
        self.store
            .campaign_store()
            .create_campaign(campaign, v.brand_ids, tiers)
            .await?;
        self.audit(admin, "campaign_created", Some(id), None).await;
        self.invalidate_public().await;
        self.admin_get(id).await
    }

    pub async fn update(
        &self,
        admin: Uuid,
        id: Uuid,
        input: CampaignInput,
    ) -> AppResult<AdminCampaignOut> {
        let now = now_iso();
        let current = self.find(id).await?;
        let v = self.validate(input).await?;
        let c = &current.campaign;
        let claimed = current.tiers.iter().any(|t| t.claimed_slots > 0);
        let started = c.starts_at.as_str() <= now.as_str();

        if (started || claimed) && v.starts_at != c.starts_at {
            return Err(AppError::Validation(
                "the start time cannot change once the campaign started or has claims".into(),
            ));
        }
        if claimed && v.coupon_validity != c.coupon_validity {
            return Err(AppError::Validation(
                "coupon validity cannot change once coupons were claimed".into(),
            ));
        }
        if v.ends_at != c.ends_at && v.ends_at.as_str() <= now.as_str() {
            return Err(AppError::Validation(
                "the end time cannot move into the past".into(),
            ));
        }

        // Tiers: the request is the whole set; missing ones are removed.
        let existing: HashMap<Uuid, &discount_tier::Model> =
            current.tiers.iter().map(|t| (t.id, t)).collect();
        let mut specs = Vec::with_capacity(v.tiers.len());
        for (i, t) in v.tiers.iter().enumerate() {
            if let Some(tier_id) = t.id {
                let Some(old) = existing.get(&tier_id) else {
                    return Err(AppError::Validation("unknown tier".into()));
                };
                if t.total_slots < old.claimed_slots {
                    return Err(AppError::Validation(format!(
                        "the {} đ tier already has {} claimed slots",
                        old.amount, old.claimed_slots
                    )));
                }
                if old.claimed_slots > 0 && t.amount != old.amount {
                    return Err(AppError::Validation(
                        "a tier with claimed coupons keeps its amount".into(),
                    ));
                }
            }
            specs.push(TierSpec {
                id: t.id,
                amount: t.amount,
                total_slots: t.total_slots,
                position: i as i16,
            });
        }
        let kept: HashSet<Uuid> = v.tiers.iter().filter_map(|t| t.id).collect();
        let mut delete_tiers = Vec::new();
        for t in &current.tiers {
            if !kept.contains(&t.id) {
                if t.claimed_slots > 0 {
                    return Err(AppError::Validation(
                        "a tier with claimed coupons cannot be removed".into(),
                    ));
                }
                delete_tiers.push(t.id);
            }
        }

        let coupons_valid_until = (v.ends_at != c.ends_at
            && v.coupon_validity == coupon_validity::CAMPAIGN)
            .then(|| v.ends_at.clone());
        let edit = CampaignEdit {
            campaign: discount_campaign::ActiveModel {
                id: sea_orm::ActiveValue::Unchanged(id),
                name: Set(v.name),
                description: Set(v.description),
                starts_at: Set(v.starts_at),
                ends_at: Set(v.ends_at),
                coupon_validity: Set(v.coupon_validity),
                all_brands: Set(v.all_brands),
                paused: Set(v.paused),
                created_by: NotSet,
                created_at: NotSet,
                updated_at: Set(now),
            },
            brand_ids: Some(v.brand_ids),
            tiers: specs,
            delete_tiers,
            coupons_valid_until,
        };
        self.store
            .campaign_store()
            .update_campaign(id, edit)
            .await
            .map_err(store_err)?;
        self.audit(admin, "campaign_updated", Some(id), None).await;
        self.invalidate_public().await;
        self.admin_get(id).await
    }

    pub async fn delete(&self, admin: Uuid, id: Uuid) -> AppResult<()> {
        self.find(id).await?;
        if !self.store.campaign_store().delete_campaign(id).await? {
            return Err(AppError::Conflict(
                "coupons were claimed from this campaign; pause or end it instead".into(),
            ));
        }
        self.audit(admin, "campaign_deleted", Some(id), None).await;
        self.invalidate_public().await;
        Ok(())
    }

    async fn find(&self, id: Uuid) -> AppResult<CampaignBundle> {
        self.store
            .campaign_store()
            .find_campaign(id)
            .await?
            .ok_or_else(|| AppError::NotFound("campaign not found".into()))
    }

    async fn validate(&self, input: CampaignInput) -> AppResult<Valid> {
        let name = input.name.trim().to_string();
        if !(3..=120).contains(&name.chars().count()) {
            return Err(AppError::Validation(
                "the name needs 3 to 120 characters".into(),
            ));
        }
        let description = input
            .description
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty());
        if description
            .as_ref()
            .is_some_and(|d| d.chars().count() > 1000)
        {
            return Err(AppError::Validation("the description is too long".into()));
        }
        let parse = |s: &str, what: &str| {
            DateTime::parse_from_rfc3339(s.trim())
                .map(|d| d.with_timezone(&Utc))
                .map_err(|_| AppError::Validation(format!("{what} is not a valid date and time")))
        };
        let starts = parse(&input.starts_at, "the start")?;
        let ends = parse(&input.ends_at, "the end")?;
        if ends <= starts {
            return Err(AppError::Validation(
                "the end must come after the start".into(),
            ));
        }
        if ends - starts > chrono::Duration::days(MAX_DAYS) {
            return Err(AppError::Validation(
                "a campaign runs at most a year".into(),
            ));
        }
        if !matches!(
            input.coupon_validity.as_str(),
            coupon_validity::CAMPAIGN | coupon_validity::PERMANENT
        ) {
            return Err(AppError::Validation(
                "coupon validity must be campaign or permanent".into(),
            ));
        }

        let mut brand_ids: Vec<Uuid> = Vec::new();
        if !input.all_brands {
            for id in input.brand_ids {
                if !brand_ids.contains(&id) {
                    brand_ids.push(id);
                }
            }
            if brand_ids.is_empty() {
                return Err(AppError::Validation("choose at least one operator".into()));
            }
            let found = self
                .store
                .brand_store()
                .list_brands_by_ids(brand_ids.clone())
                .await?;
            if found.len() != brand_ids.len() {
                return Err(AppError::Validation("unknown operator".into()));
            }
        }

        if input.tiers.is_empty() || input.tiers.len() > MAX_TIERS {
            return Err(AppError::Validation(format!(
                "add 1 to {MAX_TIERS} discount tiers"
            )));
        }
        let mut amounts = HashSet::new();
        for t in &input.tiers {
            if !(MIN_AMOUNT..=MAX_AMOUNT).contains(&t.amount) || t.amount % 1_000 != 0 {
                return Err(AppError::Validation(
                    "a discount is 1.000 đ to 10.000.000 đ, in thousands".into(),
                ));
            }
            if !(1..=MAX_SLOTS).contains(&t.total_slots) {
                return Err(AppError::Validation(
                    "a tier has 1 to 1.000.000 slots".into(),
                ));
            }
            if !amounts.insert(t.amount) {
                return Err(AppError::Validation(
                    "two tiers cannot have the same amount".into(),
                ));
            }
        }
        // Biggest discount first, as customers see it.
        let mut tiers = input.tiers;
        tiers.sort_by_key(|t| std::cmp::Reverse(t.amount));

        Ok(Valid {
            name,
            description,
            starts_at: iso(starts),
            ends_at: iso(ends),
            coupon_validity: input.coupon_validity,
            all_brands: input.all_brands,
            brand_ids,
            tiers,
            paused: input.paused,
        })
    }

    async fn admin_out(&self, bundles: Vec<CampaignBundle>) -> AppResult<Vec<AdminCampaignOut>> {
        let now = now_iso();
        let ids: Vec<Uuid> = bundles.iter().map(|b| b.campaign.id).collect();
        let totals = self.store.campaign_store().status_totals(&ids).await?;
        let all_brand_ids: Vec<Uuid> = bundles
            .iter()
            .flat_map(|b| b.brand_ids.iter().copied())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let brands = self.brands(&all_brand_ids).await?;
        Ok(bundles
            .into_iter()
            .map(|b| {
                let mut t = CampaignTotalsOut {
                    budget: b.tiers.iter().map(|t| t.amount * t.total_slots).sum(),
                    claimed: b.tiers.iter().map(|t| t.claimed_slots).sum(),
                    ..Default::default()
                };
                for s in totals.iter().filter(|s| s.campaign_id == b.campaign.id) {
                    match s.status.as_str() {
                        coupon_status::RESERVED => t.in_use = s.count,
                        coupon_status::REDEEMED => {
                            t.owed_count = s.count;
                            t.owed_amount = s.amount;
                        }
                        coupon_status::SETTLED => {
                            t.paid_count = s.count;
                            t.paid_amount = s.amount;
                        }
                        coupon_status::REJECTED => t.rejected_count = s.count,
                        coupon_status::EXPIRED => t.expired_count = s.count,
                        _ => {}
                    }
                }
                let c = b.campaign;
                AdminCampaignOut {
                    state: state_of(&c, &now).into(),
                    id: c.id,
                    name: c.name,
                    description: c.description,
                    starts_at: c.starts_at,
                    ends_at: c.ends_at,
                    coupon_validity: c.coupon_validity,
                    all_brands: c.all_brands,
                    brands: b
                        .brand_ids
                        .iter()
                        .filter_map(|id| brands.get(id).cloned())
                        .collect(),
                    paused: c.paused,
                    tiers: b
                        .tiers
                        .into_iter()
                        .map(|t| AdminTierOut {
                            id: t.id,
                            amount: t.amount,
                            total_slots: t.total_slots,
                            claimed_slots: t.claimed_slots,
                        })
                        .collect(),
                    totals: t,
                    created_at: c.created_at,
                    updated_at: c.updated_at,
                }
            })
            .collect())
    }

    // ── Admin: coupons and payouts ────────────────────────────────

    /// Coupons with what to review before paying them out.
    pub async fn coupons(&self, q: AdminCouponQuery) -> AppResult<AdminCouponListResponse> {
        let statuses: Vec<String> = q
            .status
            .as_deref()
            .unwrap_or("")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let filter = CouponFilter {
            campaign_id: q.campaign_id,
            brand_id: q.brand_id,
            statuses,
            limit: q.limit.unwrap_or(50).clamp(1, 200),
            offset: q.offset.unwrap_or(0),
        };
        let campaigns = self.store.campaign_store();
        let (page, total) = campaigns.list_coupons(&filter).await?;

        let booking_ids: Vec<Uuid> = page.iter().filter_map(|c| c.booking_id).collect();
        let bookings: HashMap<Uuid, crate::entity::booking::Model> = self
            .store
            .booking_store()
            .find_bookings_by_ids(booking_ids)
            .await?
            .into_iter()
            .map(|b| (b.id, b))
            .collect();
        let mut owners = HashMap::new();
        for user_id in page
            .iter()
            .filter_map(|c| c.user_id)
            .collect::<HashSet<_>>()
        {
            if let Ok(u) = self.store.user_store().get_user(user_id).await {
                owners.insert(user_id, u);
            }
        }
        let brand_ids: Vec<Uuid> = page
            .iter()
            .filter_map(|c| c.brand_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let brands = self.brands(&brand_ids).await?;
        let mut names = HashMap::new();
        for campaign_id in page.iter().map(|c| c.campaign_id).collect::<HashSet<_>>() {
            if let Some(b) = campaigns.find_campaign(campaign_id).await? {
                names.insert(campaign_id, b.campaign.name);
            }
        }

        // Review signals, counted over the whole campaign.
        let campaign_ids: Vec<Uuid> = names.keys().copied().collect();
        let ips: Vec<String> = page
            .iter()
            .filter_map(|c| c.claim_ip.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let phones: Vec<String> = bookings
            .values()
            .filter_map(|b| b.contact_phone.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let per_ip = campaigns.claims_per_ip(&campaign_ids, &ips).await?;
        let per_phone = campaigns.uses_per_phone(&campaign_ids, &phones).await?;

        let items = page
            .into_iter()
            .map(|c| {
                let booking = c.booking_id.and_then(|id| bookings.get(&id));
                let owner = c.user_id.and_then(|id| owners.get(&id));
                let shared_ip = c
                    .claim_ip
                    .as_ref()
                    .and_then(|ip| per_ip.get(&(c.campaign_id, ip.clone())))
                    .map_or(0, |n| (n - 1).max(0));
                let shared_phone = booking
                    .and_then(|b| b.contact_phone.as_ref())
                    .and_then(|p| per_phone.get(&(c.campaign_id, p.clone())))
                    .map_or(0, |n| (n - 1).max(0));
                let new_account = owner.is_some_and(|u| {
                    DateTime::parse_from_rfc3339(&c.claimed_at)
                        .map(|claimed| {
                            claimed.with_timezone(&Utc) - u.created_at
                                < chrono::Duration::hours(NEW_ACCOUNT_HOURS)
                        })
                        .unwrap_or(false)
                });
                AdminCouponOut {
                    id: c.id,
                    code: c.code,
                    campaign_name: names.get(&c.campaign_id).cloned().unwrap_or_default(),
                    campaign_id: c.campaign_id,
                    amount: c.amount,
                    status: c.status,
                    owner: owner.map(|u| CouponOwnerOut {
                        id: u.id,
                        name: u.full_name.clone(),
                        email: u.email.clone(),
                    }),
                    booking: booking.map(|b| CouponBookingOut {
                        id: b.id,
                        code: b.code.clone(),
                        status: b.status.clone(),
                        contact_phone: b.contact_phone.clone(),
                    }),
                    brand: c.brand_id.and_then(|id| brands.get(&id).cloned()),
                    claimed_at: c.claimed_at,
                    redeemed_at: c.redeemed_at,
                    settled_at: c.settled_at,
                    settlement_note: c.settlement_note,
                    shared_phone,
                    shared_ip,
                    new_account,
                }
            })
            .collect();
        Ok(AdminCouponListResponse { items, total })
    }

    /// What the platform owes and paid each operator.
    pub async fn payouts(&self) -> AppResult<PayoutListResponse> {
        let totals = self.store.campaign_store().payout_totals().await?;
        let brand_ids: Vec<Uuid> = totals
            .iter()
            .filter_map(|t| t.brand_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let brands = self.brands(&brand_ids).await?;
        let mut by_brand: HashMap<Option<Uuid>, PayoutOut> = HashMap::new();
        for t in totals {
            let row = by_brand.entry(t.brand_id).or_insert_with(|| PayoutOut {
                brand: t.brand_id.and_then(|id| brands.get(&id).cloned()),
                owed_count: 0,
                owed_amount: 0,
                paid_count: 0,
                paid_amount: 0,
            });
            if t.status == coupon_status::REDEEMED {
                row.owed_count += t.count;
                row.owed_amount += t.amount;
            } else {
                row.paid_count += t.count;
                row.paid_amount += t.amount;
            }
        }
        let mut items: Vec<PayoutOut> = by_brand.into_values().collect();
        items.sort_by(|a, b| {
            b.owed_amount
                .cmp(&a.owed_amount)
                .then(b.paid_amount.cmp(&a.paid_amount))
        });
        Ok(PayoutListResponse {
            total_owed: items.iter().map(|p| p.owed_amount).sum(),
            total_paid: items.iter().map(|p| p.paid_amount).sum(),
            items,
        })
    }

    /// Record that the platform paid these redeemed coupons to their
    /// operators. Coupons that are not redeemed are skipped.
    pub async fn settle(
        &self,
        admin: Uuid,
        req: SettleCouponsRequest,
    ) -> AppResult<SettleCouponsResponse> {
        let mut ids = req.coupon_ids;
        ids.sort();
        ids.dedup();
        if ids.is_empty() || ids.len() > 500 {
            return Err(AppError::Validation(
                "settle 1 to 500 coupons at a time".into(),
            ));
        }
        let note = req
            .note
            .map(|n| n.trim().chars().take(500).collect::<String>())
            .filter(|n| !n.is_empty());
        let settled = self
            .store
            .campaign_store()
            .settle_coupons(&ids, admin, note.clone(), &now_iso())
            .await?;
        let detail = serde_json::json!({ "coupons": ids, "settled": settled, "note": note });
        self.audit(admin, "coupons_settled", None, Some(detail.to_string()))
            .await;
        Ok(SettleCouponsResponse { settled })
    }

    /// Refuse to pay a redeemed coupon out (after review), with a reason.
    pub async fn reject(&self, admin: Uuid, id: Uuid, reason: String) -> AppResult<()> {
        let reason = reason.trim().chars().take(500).collect::<String>();
        if reason.chars().count() < 3 {
            return Err(AppError::Validation("give a reason".into()));
        }
        let campaigns = self.store.campaign_store();
        campaigns
            .find_coupon(id)
            .await?
            .ok_or_else(|| AppError::NotFound("coupon not found".into()))?;
        if !campaigns
            .reject_coupon(id, admin, reason.clone(), &now_iso())
            .await?
        {
            return Err(AppError::Conflict(
                "only a redeemed coupon can be rejected".into(),
            ));
        }
        self.audit(admin, "coupon_rejected", Some(id), Some(reason))
            .await;
        Ok(())
    }

    /// Who did what to which campaign or coupon (best-effort).
    async fn audit(
        &self,
        admin: Uuid,
        action: &str,
        target: Option<Uuid>,
        metadata: Option<String>,
    ) {
        let target_type = if action.starts_with("campaign") {
            "discount_campaign"
        } else {
            "coupon"
        };
        let _ = self
            .store
            .audit_store()
            .insert_audit_log(audit_log::ActiveModel {
                id: Set(Uuid::new_v4()),
                actor_type: Set(Some("staff".to_string())),
                actor_id: Set(Some(admin)),
                action: Set(action.to_string()),
                target_type: Set(Some(target_type.to_string())),
                target_id: Set(target),
                metadata: Set(metadata),
                created_at: Set(now_iso()),
                ..Default::default()
            })
            .await;
    }
}

/// The public list, built from the database (cached by the caller).
async fn load_public(store: &CompositeStore) -> anyhow::Result<PublicCampaignListResponse> {
    let now = now_iso();
    let bundles = store.campaign_store().list_live_campaigns(&now).await?;
    let brand_ids: Vec<Uuid> = bundles
        .iter()
        .flat_map(|b| b.brand_ids.iter().copied())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let brands: HashMap<Uuid, CampaignBrandOut> = if brand_ids.is_empty() {
        HashMap::new()
    } else {
        store
            .brand_store()
            .list_brands_by_ids(brand_ids)
            .await?
            .iter()
            .map(|b| (b.id, brand_out(b)))
            .collect()
    };
    let items = bundles
        .into_iter()
        .map(|b| {
            let mut tiers: Vec<CampaignTierOut> = b
                .tiers
                .iter()
                .map(|t| CampaignTierOut {
                    id: t.id,
                    amount: t.amount,
                    total_slots: t.total_slots,
                    remaining: (t.total_slots - t.claimed_slots).max(0),
                })
                .collect();
            tiers.sort_by_key(|t| std::cmp::Reverse(t.amount));
            PublicCampaignOut {
                id: b.campaign.id,
                name: b.campaign.name,
                description: b.campaign.description,
                starts_at: b.campaign.starts_at,
                ends_at: b.campaign.ends_at,
                coupon_validity: b.campaign.coupon_validity,
                all_brands: b.campaign.all_brands,
                brands: b
                    .brand_ids
                    .iter()
                    .filter_map(|id| brands.get(id).cloned())
                    .collect(),
                tiers,
            }
        })
        .collect();
    Ok(PublicCampaignListResponse {
        items,
        server_time: now,
    })
}

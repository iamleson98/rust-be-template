//! Discount campaigns end to end: who may claim, the per-account limits,
//! slots under concurrency, a coupon following its booking to the payout
//! ledger, editing rules, the cached home list and the review signals.

use std::sync::Arc;
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use uuid::Uuid;

use crate::cache::MokaBackend;
use crate::dto::campaign::{
    AdminCouponQuery, CampaignInput, PublicCampaignOut, SettleCouponsRequest, TierInput,
};
use crate::entity::{coupon, discount_campaign, discount_tier};
use crate::error::AppError;
use crate::service::campaign_service::codes;
use crate::service::test_support::{fixture, hold_req, Fixture};
use crate::service::CampaignService;
use crate::store::campaigns::coupon_status;

fn at(offset: chrono::Duration) -> String {
    (Utc::now() + offset).to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn input(tiers: &[(i64, i32)]) -> CampaignInput {
    CampaignInput {
        name: "Khai trương".into(),
        description: Some("Giảm giá mừng khai trương".into()),
        starts_at: at(-chrono::Duration::hours(1)),
        ends_at: at(chrono::Duration::days(7)),
        coupon_validity: "campaign".into(),
        all_brands: true,
        brand_ids: vec![],
        tiers: tiers
            .iter()
            .map(|&(amount, total_slots)| TierInput {
                id: None,
                amount,
                total_slots,
            })
            .collect(),
        paused: false,
    }
}

struct Env {
    f: Fixture,
    svc: CampaignService,
    admin: Uuid,
}

impl Env {
    async fn user(&self, role: &str) -> Uuid {
        self.f
            .store
            .user_store()
            .create_user(
                format!("{}@test.dev", Uuid::new_v4().simple()),
                "Khách".into(),
                "x".into(),
                role.into(),
            )
            .await
            .unwrap()
            .id
    }

    /// A campaign; returns it with its tier ids, biggest amount first.
    async fn campaign(&self, input: CampaignInput) -> (Uuid, Vec<Uuid>) {
        let c = self.svc.create(self.admin, input).await.unwrap();
        (c.id, c.tiers.iter().map(|t| t.id).collect())
    }

    async fn coupon(&self, id: Uuid) -> coupon::Model {
        coupon::Entity::find_by_id(id)
            .one(self.f.store.db())
            .await
            .unwrap()
            .unwrap()
    }

    async fn claimed_slots(&self, tier: Uuid) -> i32 {
        discount_tier::Entity::find_by_id(tier)
            .one(self.f.store.db())
            .await
            .unwrap()
            .unwrap()
            .claimed_slots
    }

    /// Hold one seat for `owner` with `coupon`.
    async fn book(
        &self,
        owner: Uuid,
        seat: usize,
        coupon: Option<Uuid>,
    ) -> Result<crate::dto::booking::BookingHoldResponse, AppError> {
        let mut req = hold_req(self.f.trip, vec![self.f.seats[seat]], self.f.stops);
        req.coupon_id = coupon;
        self.f.svc.hold_with_user(owner, &req).await
    }

    /// Staff confirm and complete a booking (the trip happened).
    async fn travel(&self, booking: Uuid) {
        let bookings = self.f.store.booking_store();
        bookings.confirm_pending(booking, "cod").await.unwrap();
        assert!(bookings.complete_booking(booking).await.unwrap());
    }
}

async fn env(seats: usize) -> Env {
    let f = fixture(seats).await;
    let cache = Arc::new(MokaBackend::new(1_000_000, Duration::from_secs(60)));
    let svc = CampaignService::new(f.store.clone(), cache);
    let admin = f
        .store
        .user_store()
        .create_user(
            "admin@test.dev".into(),
            "Admin".into(),
            "x".into(),
            "admin".into(),
        )
        .await
        .unwrap()
        .id;
    Env { f, svc, admin }
}

fn is(err: &AppError, code: &str) -> bool {
    err.to_string().ends_with(code)
}

#[tokio::test]
async fn only_customer_accounts_can_claim() {
    let e = env(1).await;
    let (campaign, tiers) = e.campaign(input(&[(50_000, 10)])).await;
    for role in ["employee", "admin"] {
        let staff = e.user(role).await;
        let err = e
            .svc
            .claim(staff, None, campaign, tiers[0])
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Forbidden(_)) && is(&err, codes::CUSTOMERS_ONLY),
            "{err:?}"
        );
    }
    assert_eq!(e.claimed_slots(tiers[0]).await, 0);
}

#[tokio::test]
async fn one_coupon_held_at_a_time_and_one_per_campaign() {
    let e = env(1).await;
    let (first, tiers) = e.campaign(input(&[(50_000, 10), (20_000, 10)])).await;
    let (second, second_tiers) = e.campaign(input(&[(30_000, 10)])).await;
    let customer = e.user("user").await;

    let coupon = e.svc.claim(customer, None, first, tiers[0]).await.unwrap();
    assert_eq!(
        (coupon.amount, coupon.status.as_str()),
        (50_000, coupon_status::HELD)
    );
    assert!(coupon.code.starts_with("DXV") && coupon.code.len() == 10);

    // Holding one: no second coupon, from any campaign.
    let err = e
        .svc
        .claim(customer, None, first, tiers[1])
        .await
        .unwrap_err();
    assert!(is(&err, codes::ALREADY_HELD), "{err:?}");
    let err = e
        .svc
        .claim(customer, None, second, second_tiers[0])
        .await
        .unwrap_err();
    assert!(is(&err, codes::ALREADY_HELD), "{err:?}");

    // Giving it up frees the account (and the slot) but not the campaign.
    e.svc.give_up(customer).await.unwrap();
    assert_eq!(
        e.claimed_slots(tiers[0]).await,
        0,
        "slot back while it runs"
    );
    let err = e
        .svc
        .claim(customer, None, first, tiers[1])
        .await
        .unwrap_err();
    assert!(is(&err, codes::ALREADY_CLAIMED), "{err:?}");
    e.svc
        .claim(customer, None, second, second_tiers[0])
        .await
        .unwrap();

    let mine = e.svc.my_coupons(customer).await.unwrap();
    assert_eq!(mine.active.unwrap().campaign_id, second);
    assert_eq!(mine.claimed_campaign_ids.len(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_claims_never_oversell() {
    let e = Arc::new(env(1).await);
    let (campaign, tiers) = e.campaign(input(&[(50_000, 3)])).await;
    let mut customers = Vec::new();
    for _ in 0..12 {
        customers.push(e.user("user").await);
    }
    let tasks: Vec<_> = customers
        .into_iter()
        .map(|c| {
            let e = e.clone();
            let tier = tiers[0];
            tokio::spawn(async move { e.svc.claim(c, None, campaign, tier).await })
        })
        .collect();
    let mut won = 0;
    for t in tasks {
        match t.await.unwrap() {
            Ok(_) => won += 1,
            Err(err) => assert!(is(&err, codes::SOLD_OUT), "{err:?}"),
        }
    }
    assert_eq!(won, 3);
    assert_eq!(e.claimed_slots(tiers[0]).await, 3);
    let issued = coupon::Entity::find()
        .filter(coupon::Column::TierId.eq(tiers[0]))
        .all(e.f.store.db())
        .await
        .unwrap();
    assert_eq!(issued.len(), 3, "coupons issued = slots taken");
}

#[tokio::test]
async fn a_campaign_that_is_not_running_takes_no_claims() {
    let e = env(1).await;
    let customer = e.user("user").await;

    let mut upcoming = input(&[(50_000, 5)]);
    upcoming.starts_at = at(chrono::Duration::days(1));
    let (c, t) = e.campaign(upcoming).await;
    let err = e.svc.claim(customer, None, c, t[0]).await.unwrap_err();
    assert!(is(&err, codes::NOT_RUNNING), "{err:?}");

    let mut paused = input(&[(50_000, 5)]);
    paused.paused = true;
    let (c, t) = e.campaign(paused).await;
    let err = e.svc.claim(customer, None, c, t[0]).await.unwrap_err();
    assert!(is(&err, codes::NOT_RUNNING), "{err:?}");

    // A tier of another campaign is not this campaign's.
    let (open, _) = e.campaign(input(&[(40_000, 5)])).await;
    let err = e.svc.claim(customer, None, open, t[0]).await.unwrap_err();
    assert!(is(&err, codes::NOT_RUNNING), "{err:?}");
}

#[tokio::test]
async fn a_coupon_comes_off_the_ticket_and_follows_the_trip_to_the_payout() {
    let e = env(2).await;
    let (campaign, tiers) = e.campaign(input(&[(50_000, 5)])).await;
    let customer = e.user("user").await;
    let coupon = e
        .svc
        .claim(customer, None, campaign, tiers[0])
        .await
        .unwrap();

    // Someone else cannot use it.
    let stranger = e.user("user").await;
    let err = e.book(stranger, 0, Some(coupon.id)).await.unwrap_err();
    assert!(is(&err, codes::UNAVAILABLE), "{err:?}");

    let held = e.book(customer, 0, Some(coupon.id)).await.unwrap();
    assert_eq!(
        (held.subtotal, held.discount, held.total),
        (350_000, 50_000, 300_000)
    );
    assert_eq!(held.coupon_id, Some(coupon.id));
    let row = e.coupon(coupon.id).await;
    assert_eq!(
        (row.status.as_str(), row.booking_id),
        (coupon_status::RESERVED, Some(held.booking_id))
    );
    let mine = e.svc.my_coupons(customer).await.unwrap().active.unwrap();
    assert_eq!(mine.booking_code.as_deref(), Some(held.code.as_str()));

    // On one booking only.
    let err = e.book(customer, 1, Some(coupon.id)).await.unwrap_err();
    assert!(is(&err, codes::UNAVAILABLE), "{err:?}");

    // Cancelled: it comes back, and can be used again.
    e.f.svc
        .cancel(customer, held.booking_id, None)
        .await
        .unwrap();
    assert_eq!(e.coupon(coupon.id).await.status, coupon_status::HELD);
    let again = e.book(customer, 1, Some(coupon.id)).await.unwrap();

    // The trip happened: payable to the operator, the customer is free.
    e.travel(again.booking_id).await;
    let row = e.coupon(coupon.id).await;
    assert_eq!(
        (row.status.as_str(), row.active_holder),
        (coupon_status::REDEEMED, None)
    );
    assert_eq!(row.brand_id, Some(e.f.brand_of_trip().await));
    assert!(e.svc.my_coupons(customer).await.unwrap().active.is_none());

    let payouts = e.svc.payouts().await.unwrap();
    assert_eq!((payouts.total_owed, payouts.total_paid), (50_000, 0));

    // Paid once; a paid coupon can no longer be rejected or paid again.
    let settled = e
        .svc
        .settle(
            e.admin,
            SettleCouponsRequest {
                coupon_ids: vec![coupon.id, coupon.id],
                note: Some("CK 10/10".into()),
            },
        )
        .await
        .unwrap();
    assert_eq!(settled.settled, 1);
    let again = e
        .svc
        .settle(
            e.admin,
            SettleCouponsRequest {
                coupon_ids: vec![coupon.id],
                note: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(again.settled, 0);
    let err = e
        .svc
        .reject(e.admin, coupon.id, "fake trip".into())
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    let payouts = e.svc.payouts().await.unwrap();
    assert_eq!((payouts.total_owed, payouts.total_paid), (0, 50_000));
}

#[tokio::test]
async fn a_discount_never_exceeds_the_ticket_and_a_rejected_payout_is_final() {
    let e = env(1).await;
    let (campaign, tiers) = e.campaign(input(&[(1_000_000, 1)])).await;
    let customer = e.user("user").await;
    let coupon = e
        .svc
        .claim(customer, None, campaign, tiers[0])
        .await
        .unwrap();
    let held = e.book(customer, 0, Some(coupon.id)).await.unwrap();
    assert_eq!((held.discount, held.total), (350_000, 0));

    e.travel(held.booking_id).await;
    let err = e
        .svc
        .reject(e.admin, coupon.id, "x".into())
        .await
        .unwrap_err();
    assert!(
        matches!(err, AppError::Validation(_)),
        "a reason is required: {err:?}"
    );
    e.svc
        .reject(e.admin, coupon.id, "trip not verified".into())
        .await
        .unwrap();
    assert_eq!(e.coupon(coupon.id).await.status, coupon_status::REJECTED);
    let settled = e
        .svc
        .settle(
            e.admin,
            SettleCouponsRequest {
                coupon_ids: vec![coupon.id],
                note: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(settled.settled, 0, "rejected is final");
}

#[tokio::test]
async fn a_coupon_only_works_with_its_operators() {
    let e = env(1).await;
    let other =
        e.f.store
            .brand_store()
            .create("nha-xe-khac".into(), "Nhà xe khác".into())
            .await
            .unwrap();
    let mut scoped = input(&[(50_000, 5)]);
    scoped.all_brands = false;
    scoped.brand_ids = vec![other.id];
    let (campaign, tiers) = e.campaign(scoped).await;
    let customer = e.user("user").await;
    let coupon = e
        .svc
        .claim(customer, None, campaign, tiers[0])
        .await
        .unwrap();
    assert_eq!(coupon.brands.len(), 1);

    let err = e.book(customer, 0, Some(coupon.id)).await.unwrap_err();
    assert!(is(&err, codes::WRONG_OPERATOR), "{err:?}");
    assert_eq!(
        e.coupon(coupon.id).await.status,
        coupon_status::HELD,
        "untouched"
    );
}

#[tokio::test]
async fn a_window_coupon_expires_with_its_campaign_and_frees_the_account() {
    let e = env(2).await;
    let (first, tiers) = e.campaign(input(&[(50_000, 5)])).await;
    let (second, second_tiers) = e.campaign(input(&[(20_000, 5)])).await;
    let customer = e.user("user").await;
    let coupon = e.svc.claim(customer, None, first, tiers[0]).await.unwrap();
    assert!(coupon.valid_until.is_some());

    // A booking placed in the window keeps it even after the window.
    let held = e.book(customer, 0, Some(coupon.id)).await.unwrap();
    expire_window(&e, coupon.id).await;
    // Cancelled after the window: expired, not back.
    e.f.svc
        .cancel(customer, held.booking_id, None)
        .await
        .unwrap();
    let row = e.coupon(coupon.id).await;
    assert_eq!(
        (row.status.as_str(), row.active_holder),
        (coupon_status::EXPIRED, None)
    );

    let err = e.book(customer, 1, Some(coupon.id)).await.unwrap_err();
    assert!(is(&err, codes::UNAVAILABLE), "{err:?}");
    e.svc
        .claim(customer, None, second, second_tiers[0])
        .await
        .unwrap();
}

#[tokio::test]
async fn an_unused_coupon_past_its_window_is_expired_on_read_and_by_the_job() {
    let e = env(1).await;
    let (first, tiers) = e.campaign(input(&[(50_000, 5)])).await;
    let a = e.user("user").await;
    let b = e.user("user").await;
    let ca = e.svc.claim(a, None, first, tiers[0]).await.unwrap();
    let cb = e.svc.claim(b, None, first, tiers[0]).await.unwrap();
    expire_window(&e, ca.id).await;
    expire_window(&e, cb.id).await;

    assert!(e.svc.my_coupons(a).await.unwrap().active.is_none());
    assert_eq!(e.coupon(ca.id).await.status, coupon_status::EXPIRED);
    let swept =
        e.f.store
            .campaign_store()
            .expire_stale(&at(chrono::Duration::zero()))
            .await
            .unwrap();
    assert_eq!(swept, 1, "only b was left");
    assert_eq!(e.coupon(cb.id).await.status, coupon_status::EXPIRED);
}

#[tokio::test]
async fn a_permanent_coupon_outlives_its_campaign() {
    let e = env(1).await;
    let mut forever = input(&[(50_000, 5)]);
    forever.coupon_validity = "permanent".into();
    let (campaign, tiers) = e.campaign(forever).await;
    let customer = e.user("user").await;
    let coupon = e
        .svc
        .claim(customer, None, campaign, tiers[0])
        .await
        .unwrap();
    assert!(coupon.valid_until.is_none());
    e.f.store
        .campaign_store()
        .expire_stale(&at(chrono::Duration::days(30)))
        .await
        .unwrap();
    assert_eq!(e.coupon(coupon.id).await.status, coupon_status::HELD);
}

#[tokio::test]
async fn editing_a_claimed_campaign_keeps_the_promises_made() {
    let e = env(1).await;
    let created = e
        .svc
        .create(e.admin, input(&[(50_000, 2), (20_000, 5)]))
        .await
        .unwrap();
    let (big, small) = (created.tiers[0].id, created.tiers[1].id);
    let customer = e.user("user").await;
    let coupon = e.svc.claim(customer, None, created.id, big).await.unwrap();

    let edit = |f: &dyn Fn(&mut CampaignInput)| {
        let mut i = input(&[]);
        i.starts_at = created.starts_at.clone();
        i.ends_at = created.ends_at.clone();
        i.tiers = vec![
            TierInput {
                id: Some(big),
                amount: 50_000,
                total_slots: 2,
            },
            TierInput {
                id: Some(small),
                amount: 20_000,
                total_slots: 5,
            },
        ];
        f(&mut i);
        i
    };
    let refused = [
        edit(&|i| i.tiers[0].total_slots = 0),
        edit(&|i| i.tiers[0].amount = 60_000),
        edit(&|i| i.tiers.clear()),
        edit(&|i| {
            i.tiers.remove(0);
        }),
        edit(&|i| i.starts_at = at(chrono::Duration::hours(2))),
        edit(&|i| i.coupon_validity = "permanent".into()),
        edit(&|i| i.ends_at = at(-chrono::Duration::minutes(1))),
        edit(&|i| i.tiers[1].amount = 50_000),
    ];
    for bad in refused {
        let err = e.svc.update(e.admin, created.id, bad).await.unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    }

    // Allowed: grow, shrink to the claimed count, drop an unclaimed tier,
    // add one, and extend the end (outstanding coupons follow).
    let new_end = at(chrono::Duration::days(14));
    let updated = e
        .svc
        .update(
            e.admin,
            created.id,
            edit(&|i| {
                i.tiers = vec![
                    TierInput {
                        id: Some(big),
                        amount: 50_000,
                        total_slots: 1,
                    },
                    TierInput {
                        id: None,
                        amount: 10_000,
                        total_slots: 100,
                    },
                ];
                i.ends_at = new_end.clone();
                i.name = "Khai trương (gia hạn)".into();
            }),
        )
        .await
        .unwrap();
    assert_eq!(updated.tiers.len(), 2);
    assert_eq!(
        e.coupon(coupon.id).await.valid_until.as_deref(),
        Some(new_end.as_str())
    );

    let err = e.svc.delete(e.admin, created.id).await.unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    let (unused, _) = e.campaign(input(&[(30_000, 3)])).await;
    e.svc.delete(e.admin, unused).await.unwrap();
}

#[tokio::test]
async fn invalid_campaigns_are_refused() {
    let e = env(1).await;
    let mut cases = vec![
        input(&[]),
        input(&[(50_000, 0)]),
        input(&[(50_500, 5)]),
        input(&[(50_000, 5), (50_000, 3)]),
        input(&[(500, 5)]),
    ];
    let mut no_brands = input(&[(50_000, 5)]);
    no_brands.all_brands = false;
    cases.push(no_brands);
    let mut unknown_brand = input(&[(50_000, 5)]);
    unknown_brand.all_brands = false;
    unknown_brand.brand_ids = vec![Uuid::new_v4()];
    cases.push(unknown_brand);
    let mut backwards = input(&[(50_000, 5)]);
    backwards.ends_at = backwards.starts_at.clone();
    cases.push(backwards);
    let mut over = input(&[(50_000, 5)]);
    over.ends_at = at(-chrono::Duration::minutes(5));
    over.starts_at = at(-chrono::Duration::days(2));
    cases.push(over);
    let mut validity = input(&[(50_000, 5)]);
    validity.coupon_validity = "forever".into();
    cases.push(validity);
    for bad in cases {
        assert!(matches!(
            e.svc.create(e.admin, bad).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }
}

/// The campaign as the home page lists it.
async fn listed(e: &Env, id: Uuid) -> PublicCampaignOut {
    e.svc
        .public_campaigns()
        .await
        .unwrap()
        .items
        .into_iter()
        .find(|c| c.id == id)
        .unwrap()
}

#[tokio::test]
async fn the_home_list_is_cached_kept_current_by_claims_and_reloaded_on_sell_out() {
    let e = env(1).await;
    let (campaign, tiers) = e.campaign(input(&[(50_000, 3)])).await;
    assert_eq!(listed(&e, campaign).await.tiers[0].remaining, 3);

    // Renamed behind the service's back: reads keep coming from the cache.
    discount_campaign::Entity::update_many()
        .col_expr(discount_campaign::Column::Name, Expr::value("Đổi tên"))
        .filter(discount_campaign::Column::Id.eq(campaign))
        .exec(e.f.store.db())
        .await
        .unwrap();

    // A claim writes its exact count into the cached list without a reload.
    e.svc
        .claim(e.user("user").await, None, campaign, tiers[0])
        .await
        .unwrap();
    let c = listed(&e, campaign).await;
    assert_eq!((c.name.as_str(), c.tiers[0].remaining), ("Khai trương", 2));

    // Selling the tier out clears the cache: the next read loads afresh.
    for _ in 0..2 {
        e.svc
            .claim(e.user("user").await, None, campaign, tiers[0])
            .await
            .unwrap();
    }
    let c = listed(&e, campaign).await;
    assert_eq!((c.name.as_str(), c.tiers[0].remaining), ("Đổi tên", 0));

    // Upcoming campaigns show; paused and ended ones do not.
    let mut upcoming = input(&[(10_000, 5)]);
    upcoming.starts_at = at(chrono::Duration::days(2));
    upcoming.ends_at = at(chrono::Duration::days(3));
    let (soon, _) = e.campaign(upcoming).await;
    let mut paused = input(&[(10_000, 5)]);
    paused.paused = true;
    let (hidden, _) = e.campaign(paused).await;
    let ids: Vec<Uuid> = e
        .svc
        .public_campaigns()
        .await
        .unwrap()
        .items
        .iter()
        .map(|c| c.id)
        .collect();
    assert!(ids.contains(&soon) && !ids.contains(&hidden));
}

#[tokio::test]
async fn payout_review_flags_shared_phones_networks_and_new_accounts() {
    let e = env(2).await;
    let (campaign, tiers) = e.campaign(input(&[(50_000, 5)])).await;
    let ip = Some("203.0.113.7".to_string());
    let mut bookings = Vec::new();
    for seat in 0..2 {
        let customer = e.user("user").await;
        let coupon = e
            .svc
            .claim(customer, ip.clone(), campaign, tiers[0])
            .await
            .unwrap();
        // Both book with the same contact phone (hold_req's default).
        let held = e.book(customer, seat, Some(coupon.id)).await.unwrap();
        e.travel(held.booking_id).await;
        bookings.push(held.booking_id);
    }
    let list = e
        .svc
        .coupons(AdminCouponQuery {
            campaign_id: Some(campaign),
            status: Some("redeemed".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(list.total, 2);
    for c in &list.items {
        assert_eq!(
            (c.shared_ip, c.shared_phone, c.new_account),
            (1, 1, true),
            "{c:?}"
        );
        assert!(c.booking.as_ref().is_some_and(|b| bookings.contains(&b.id)));
        assert!(c.brand.is_some() && c.owner.is_some());
    }
}

#[tokio::test]
async fn only_admins_hold_the_campaign_permission() {
    use crate::entity::{permissions, role_permissions, roles};
    let e = env(1).await;
    let perm = permissions::Entity::find()
        .filter(permissions::Column::Name.eq("admin:campaigns:manage"))
        .one(e.f.store.db())
        .await
        .unwrap()
        .expect("permission seeded by the migration");
    let grants = role_permissions::Entity::find()
        .filter(role_permissions::Column::PermissionId.eq(perm.id))
        .all(e.f.store.db())
        .await
        .unwrap();
    let mut names = Vec::new();
    for g in grants {
        names.push(
            roles::Entity::find_by_id(g.role_id)
                .one(e.f.store.db())
                .await
                .unwrap()
                .unwrap()
                .name,
        );
    }
    assert_eq!(names, vec!["admin".to_string()]);
}

/// Pretend the coupon's window ended a minute ago.
async fn expire_window(e: &Env, coupon: Uuid) {
    coupon::Entity::update_many()
        .col_expr(
            coupon::Column::ValidUntil,
            Expr::value(Some(at(-chrono::Duration::minutes(1)))),
        )
        .filter(coupon::Column::Id.eq(coupon))
        .exec(e.f.store.db())
        .await
        .unwrap();
}

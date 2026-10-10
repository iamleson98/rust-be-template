# Discount campaigns

Admins run discount campaigns; customers claim a coupon from one and it
comes off their next ticket. The platform funds the discount and pays it
to the operator (brand) only after the trip happened and an admin
approved the payout.

## Rules

| Rule | Where it is enforced |
| --- | --- |
| Only admins create and edit campaigns | `admin:campaigns:manage` (granted to the `admin` role only) |
| A campaign runs from `starts_at` to `ends_at` | claim checks `starts_at <= now < ends_at`; a paused campaign takes no claims |
| A campaign applies to every operator or to a chosen list | `all_brands` or `discount_campaign_brand`; checked when a booking uses the coupon |
| Discounts come as tiers: "X đ × N slots", as many as the admin wants | `discount_tier` (`amount`, `total_slots`, `claimed_slots`); one tier per amount |
| The customer picks the tier | each tier is its own voucher card with the slots left |
| A coupon is valid within the campaign window, or permanently | `coupon_validity` = `campaign` (book before `ends_at`) or `permanent` (no end) |
| One coupon held at a time per account | unique `coupon.active_holder` (= `user_id` while `held`/`reserved`, else NULL) |
| One coupon per account per campaign, ever | unique `(campaign_id, user_id)` |
| The platform pays only after the trip happened and an admin confirmed it | `redeemed` on ticket completion (staff, after departure), `settled` only by an admin |

## Coupon life

```
claim ──▶ held ──book──▶ reserved ──ticket completed──▶ redeemed ──admin pays──▶ settled
            │  ▲              │                              │
            │  └──cancelled ──┘ (still valid)                └──admin rejects──▶ rejected
            │                 └─cancelled after the window──▶ expired
            ├──window passed──▶ expired
            └──customer gives it up──▶ released (slot back if the campaign still runs)
```

- **held → reserved** happens as the last step of placing a booking, with a
  conditional update (`status = 'held'`, same owner, still valid); losing
  that race rolls the whole booking back.
- **reserved → held / expired** happens inside the transaction that
  cancels or expires the booking.
- **reserved → redeemed** happens inside the transaction that completes
  the ticket. Completion is only possible after departure.
- **redeemed → settled / rejected** is an admin decision on the payouts
  page; nothing pays out automatically.
- Coupons are expired lazily on every read and by the nightly
  `coupons.expire` job, so a stale coupon never blocks a new claim.

## Claiming without overselling

One transaction:

1. expire the account's stale coupons;
2. refuse if it still holds one, or already claimed from this campaign;
3. `UPDATE discount_tier SET claimed_slots = claimed_slots + 1
   WHERE id = ? AND claimed_slots < total_slots` — zero rows means sold out;
4. insert the coupon.

The unique indexes back up steps 2 and 4, so two taps at once can never
yield two coupons, and the conditional update can never hand out a slot
that does not exist. `claimed_slots` always equals the number of coupons
of the tier that were not given back.

## Abuse ("cheating") controls

- **Who can claim:** signed-in customer accounts that are active, not
  guests and not bots. Staff and admins cannot claim, so nobody can award
  coupons to themselves.
- **Limits in the database**, not only in code: one held coupon per
  account, one coupon per account per campaign, one coupon per booking,
  and slots that cannot go below zero.
- **Prices are server-side:** the discount is the amount frozen on the
  coupon at claim time, never more than the ticket subtotal, and only for
  an operator in the campaign's scope. The client only says which coupon
  to use.
- **Payout review:** each redeemed coupon shows signals for the admin:
  the same contact phone used with other coupons of the campaign, the
  same network (IP) used for other claims, or an account created less
  than a day before claiming. The admin settles or rejects with a note;
  both are recorded in the audit log.
- **Rate limits:** the global per-IP limiter covers the claim endpoint;
  the database limits make retries harmless.

## Editing a running campaign

- Name, description, end time, operators and pause can always change.
  The end time cannot move into the past.
- The start time and the coupon validity are fixed once the campaign has
  started or has claims.
- Tiers can be added; a tier's slots can grow, or shrink down to what was
  already claimed; a tier with claims keeps its amount and cannot be
  removed.
- A campaign can be deleted only while nobody has claimed from it.

## Caching

The public list (running and upcoming campaigns with their tiers, slots
left and operators) is served from the shared cache with stampede
protection: one database query per 15 seconds per process at most.
Admin edits, a coupon given up and a claim that sells a tier out clear it
at once. Every other claim writes its exact slot count into the cached
list (counts there only go down, and the entry keeps its original expiry),
so the claimer sees the slot gone without another query. Claims always
go to the database, so a cached count can only be a little behind (a
claim served by another process with a per-process cache) and can never
oversell.

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/campaigns` | everyone (cached) |
| GET | `/api/coupons/mine` | customer |
| POST | `/api/campaigns/{id}/tiers/{tier_id}/claim` | customer |
| DELETE | `/api/coupons/mine` | customer (gives up the held coupon) |
| GET, POST | `/api/admin/campaigns` | admin |
| GET, PATCH, DELETE | `/api/admin/campaigns/{id}` | admin |
| GET | `/api/admin/coupons` | admin (with review signals) |
| GET | `/api/admin/coupons/payouts` | admin (owed and paid per operator) |
| POST | `/api/admin/coupons/settle` | admin |
| POST | `/api/admin/coupons/{id}/reject` | admin |

Bookings take `couponId` instead of the retired typed promo code.

//! Discount campaigns for customers — `/api/campaigns` and
//! `/api/coupons` (see `docs/CAMPAIGNS.md`).
//!
//! Claim errors carry a stable code in `message` for the apps to
//! translate: `customers_only` (403), `campaign_not_running` (400),
//! `coupon_already_held` / `campaign_already_claimed` / `try_again`
//! (409), `tier_sold_out` (410).

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use uuid::Uuid;

use crate::dto::campaign::{CouponOut, MyCouponsResponse, PublicCampaignListResponse};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;

/// `GET /api/campaigns` — running and upcoming campaigns with their tiers
/// and slots left (served from the cache, which claims keep current;
/// claiming itself is exact).
#[utoipa::path(
    get,
    path = "/api/campaigns",
    tag = "campaigns",
    responses(
        (status = 200, description = "Running and upcoming campaigns", body = PublicCampaignListResponse),
    )
)]
pub async fn list(
    State(st): State<AppState>,
) -> Result<Json<PublicCampaignListResponse>, AppError> {
    Ok(Json(st.campaigns.public_campaigns().await?))
}

/// `POST /api/campaigns/{id}/tiers/{tier_id}/claim` — claim a coupon of
/// this tier. One held coupon per account at a time, one per campaign.
#[utoipa::path(
    post,
    path = "/api/campaigns/{id}/tiers/{tier_id}/claim",
    tag = "campaigns",
    params(
        ("id" = Uuid, Path, description = "Campaign ID"),
        ("tier_id" = Uuid, Path, description = "Tier ID"),
    ),
    responses(
        (status = 201, description = "Coupon claimed", body = CouponOut),
        (status = 400, description = "campaign_not_running"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "customers_only"),
        (status = 409, description = "coupon_already_held, campaign_already_claimed or try_again"),
        (status = 410, description = "tier_sold_out"),
    )
)]
pub async fn claim(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    headers: HeaderMap,
    Path((id, tier_id)): Path<(Uuid, Uuid)>,
) -> Result<(StatusCode, Json<CouponOut>), AppError> {
    let ip = crate::middleware::header_client_ip(&headers).map(|ip| ip.to_string());
    let coupon = st.campaigns.claim(uid, ip, id, tier_id).await?;
    Ok((StatusCode::CREATED, Json(coupon)))
}

/// `GET /api/coupons/mine` — the coupon this account holds (if any) and
/// the campaigns it already claimed from.
#[utoipa::path(
    get,
    path = "/api/coupons/mine",
    tag = "campaigns",
    responses(
        (status = 200, description = "My coupon", body = MyCouponsResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn mine(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
) -> Result<Json<MyCouponsResponse>, AppError> {
    Ok(Json(st.campaigns.my_coupons(uid).await?))
}

/// `DELETE /api/coupons/mine` — give up the unused coupon (to claim from
/// another campaign). A coupon on a booking cannot be given up.
#[utoipa::path(
    delete,
    path = "/api/coupons/mine",
    operation_id = "coupons_give_up",
    tag = "campaigns",
    responses(
        (status = 204, description = "Coupon given up"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "No unused coupon"),
    )
)]
pub async fn give_up(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
) -> Result<StatusCode, AppError> {
    st.campaigns.give_up(uid).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `/api/campaigns`.
pub fn router() -> axum::Router<AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/", get(list))
        .route("/{id}/tiers/{tier_id}/claim", post(claim))
}

/// `/api/coupons`.
pub fn coupons_router() -> axum::Router<AppState> {
    use axum::routing::get;
    axum::Router::new().route("/mine", get(mine).delete(give_up))
}

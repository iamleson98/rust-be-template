//! Admin — discount campaigns and coupon payouts
//! (`/api/admin/campaigns`, `/api/admin/coupons`). Every handler requires
//! `admin:campaigns:manage`, which only the admin role holds.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Json, Router};
use uuid::Uuid;

use crate::dto::campaign::{
    AdminCampaignListResponse, AdminCampaignOut, AdminCouponListResponse, AdminCouponQuery,
    CampaignInput, PayoutListResponse, RejectCouponRequest, SettleCouponsRequest,
    SettleCouponsResponse,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

async fn require(st: &AppState, admin: &AdminUser) -> Result<(), AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_CAMPAIGNS_MANAGE)
        .await?;
    Ok(())
}

/// `GET /api/admin/campaigns` — every campaign with its money position.
#[utoipa::path(
    get,
    path = "/api/admin/campaigns",
    tag = "admin",
    responses(
        (status = 200, description = "Campaigns", body = AdminCampaignListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
) -> Result<Json<AdminCampaignListResponse>, AppError> {
    require(&st, &admin).await?;
    Ok(Json(st.campaigns.admin_list().await?))
}

/// `POST /api/admin/campaigns` — create a campaign.
#[utoipa::path(
    post,
    path = "/api/admin/campaigns",
    tag = "admin",
    request_body = CampaignInput,
    responses(
        (status = 201, description = "Created", body = AdminCampaignOut),
        (status = 400, description = "Invalid campaign"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<CampaignInput>,
) -> Result<(StatusCode, Json<AdminCampaignOut>), AppError> {
    require(&st, &admin).await?;
    let created = st.campaigns.create(admin.user_id(), body).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

/// `GET /api/admin/campaigns/{id}`.
#[utoipa::path(
    get,
    path = "/api/admin/campaigns/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Campaign ID")),
    responses(
        (status = 200, description = "Campaign", body = AdminCampaignOut),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminCampaignOut>, AppError> {
    require(&st, &admin).await?;
    Ok(Json(st.campaigns.admin_get(id).await?))
}

/// `PATCH /api/admin/campaigns/{id}` — replace the campaign with the
/// given state (within the editing rules of a running campaign).
#[utoipa::path(
    patch,
    path = "/api/admin/campaigns/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Campaign ID")),
    request_body = CampaignInput,
    responses(
        (status = 200, description = "Updated", body = AdminCampaignOut),
        (status = 400, description = "Invalid change"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
        (status = 409, description = "Coupons were claimed meanwhile"),
    )
)]
pub async fn update(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CampaignInput>,
) -> Result<Json<AdminCampaignOut>, AppError> {
    require(&st, &admin).await?;
    Ok(Json(st.campaigns.update(admin.user_id(), id, body).await?))
}

/// `DELETE /api/admin/campaigns/{id}` — only while nobody claimed from it.
#[utoipa::path(
    delete,
    path = "/api/admin/campaigns/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Campaign ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
        (status = 409, description = "Coupons were claimed; pause or end it instead"),
    )
)]
pub async fn delete(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    require(&st, &admin).await?;
    st.campaigns.delete(admin.user_id(), id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/admin/coupons` — coupons with review signals (shared phone,
/// shared network, new account).
#[utoipa::path(
    get,
    path = "/api/admin/coupons",
    operation_id = "admin_coupons_list",
    tag = "admin",
    params(AdminCouponQuery),
    responses(
        (status = 200, description = "Coupons", body = AdminCouponListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn coupons(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminCouponQuery>,
) -> Result<Json<AdminCouponListResponse>, AppError> {
    require(&st, &admin).await?;
    Ok(Json(st.campaigns.coupons(q).await?))
}

/// `GET /api/admin/coupons/payouts` — owed and paid per operator.
#[utoipa::path(
    get,
    path = "/api/admin/coupons/payouts",
    tag = "admin",
    responses(
        (status = 200, description = "Payouts", body = PayoutListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn payouts(
    State(st): State<AppState>,
    admin: AdminUser,
) -> Result<Json<PayoutListResponse>, AppError> {
    require(&st, &admin).await?;
    Ok(Json(st.campaigns.payouts().await?))
}

/// `POST /api/admin/coupons/settle` — record that these redeemed coupons
/// were paid to their operators.
#[utoipa::path(
    post,
    path = "/api/admin/coupons/settle",
    tag = "admin",
    request_body = SettleCouponsRequest,
    responses(
        (status = 200, description = "Settled", body = SettleCouponsResponse),
        (status = 400, description = "Invalid request"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn settle(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<SettleCouponsRequest>,
) -> Result<Json<SettleCouponsResponse>, AppError> {
    require(&st, &admin).await?;
    Ok(Json(st.campaigns.settle(admin.user_id(), body).await?))
}

/// `POST /api/admin/coupons/{id}/reject` — refuse a redeemed coupon's
/// payout after review.
#[utoipa::path(
    post,
    path = "/api/admin/coupons/{id}/reject",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Coupon ID")),
    request_body = RejectCouponRequest,
    responses(
        (status = 204, description = "Rejected"),
        (status = 400, description = "Missing reason"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
        (status = 409, description = "Not redeemed"),
    )
)]
pub async fn reject(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<RejectCouponRequest>,
) -> Result<StatusCode, AppError> {
    require(&st, &admin).await?;
    st.campaigns
        .reject(admin.user_id(), id, body.reason)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `/api/admin/campaigns`.
pub fn router() -> Router<AppState> {
    use axum::routing::get as rget;
    Router::new()
        .route("/", rget(list).post(create))
        .route("/{id}", rget(get).patch(update).delete(delete))
}

/// `/api/admin/coupons`.
pub fn coupons_router() -> Router<AppState> {
    use axum::routing::{get as rget, post};
    Router::new()
        .route("/", rget(coupons))
        .route("/payouts", rget(payouts))
        .route("/settle", post(settle))
        .route("/{id}/reject", post(reject))
}

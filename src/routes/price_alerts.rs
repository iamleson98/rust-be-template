//! Price alert routes — thin HTTP layer.
//!
//! Responsibilities (per the system-wide route contract):
//! 1. **Auth**: `create` / `remove` require an authenticated user
//!    (`AuthUser`). The user id is passed to the service as the alert
//!    owner. `list` accepts either an authenticated user (returns the
//!    user's alerts) or a `?phone=...` query param (public guest lookup
//!    so the dialog can preview existing alerts before login).
//! 2. **DTO mapping**: this file owns the JSON shape (`PriceAlertOut`,
//!    `CreatePriceAlertRequest`, `ListPriceAlertsQuery`). The service
//!    returns domain models; we map them to JSON here.
//! 3. **List query**: the pagination fields (`limit` / `offset` / `sort`
//!    / `order`) mirror the system-wide `dto::ListQuery` shape (inlined
//!    here because utoipa's `IntoParams` derive does not support
//!    `#[serde(flatten)]` sub-structs). `ListPriceAlertsQuery::base()`
//!    recovers the `ListQuery` view.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

use crate::dto::ListEnvelope;
use crate::entity::price_alert;
use crate::error::AppResult;
use crate::middleware::{AuthUser, MaybeAuthUser};
use crate::service::price_alert_service::{CreatePriceAlertInput, PriceAlertListFilter};
use crate::state::AppState;

// ────────────────────────────────────────────────────────────────
//  DTOs
// ────────────────────────────────────────────────────────────────

/// Price alert as returned to the client. Field names are camelCase
/// to match the frontend's `PriceAlert` type.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceAlertOut {
    pub id: Uuid,
    pub phone: String,
    pub email: Option<String>,
    pub from_name: Option<String>,
    pub to_name: Option<String>,
    pub route_id: Option<Uuid>,
    pub target_price: Option<i64>,
    pub frequency: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub last_triggered_at: Option<String>,
}

impl From<price_alert::Model> for PriceAlertOut {
    fn from(a: price_alert::Model) -> Self {
        Self {
            id: a.id,
            phone: a.phone,
            email: a.email,
            from_name: a.from_name,
            to_name: a.to_name,
            route_id: a.route_id,
            target_price: a.target_price,
            frequency: a.frequency,
            status: a.status,
            created_at: a.created_at,
            expires_at: a.expires_at,
            last_triggered_at: a.last_triggered_at,
        }
    }
}

/// `GET /api/price-alerts` query params.
///
/// `phone` is optional — when present, the endpoint performs a guest
/// lookup (public). When absent, it returns the authenticated user's
/// alerts (requires `AuthUser`).
///
/// The pagination fields (`limit` / `offset` / `sort` / `order`) mirror
/// the system-wide `dto::ListQuery` shape. We inline them here (rather
/// than `#[serde(flatten)]`) because utoipa's `IntoParams` derive does
/// not support flattened sub-structs. Use [`ListPriceAlertsQuery::base`]
/// to recover the `ListQuery` view.
#[derive(Debug, Deserialize, IntoParams)]
pub struct ListPriceAlertsQuery {
    /// Max items to return. Clamped to `[1, 200]` by the service.
    #[serde(default = "default_list_limit")]
    pub limit: u64,
    /// Number of items to skip.
    #[serde(default)]
    pub offset: u64,
    /// Sort field. The service validates this against an allow-list.
    #[serde(default = "default_list_sort")]
    pub sort: String,
    /// Sort direction: `asc` or `desc`.
    #[serde(default)]
    pub order: crate::dto::SortOrder,
    /// Guest lookup by phone (public). Omit for the authenticated-user
    /// list.
    pub phone: Option<String>,
    pub status: Option<String>,
}

fn default_list_limit() -> u64 {
    20
}
fn default_list_sort() -> String {
    "created_at".to_string()
}

impl ListPriceAlertsQuery {
    /// Recover the system-wide `ListQuery` view of the pagination
    /// fields. Keeps the route handler DRY without sacrificing utoipa
    /// compatibility.
    pub fn base(&self) -> crate::dto::ListQuery {
        crate::dto::ListQuery {
            limit: self.limit,
            offset: self.offset,
            sort: self.sort.clone(),
            order: self.order,
        }
    }
}

/// `POST /api/price-alerts` request body.
///
/// Accepts both `targetPrice` (canonical) and `maxPrice` (legacy alias
/// used by some frontend hooks) — the route normalizes to `targetPrice`.
#[derive(Debug, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreatePriceAlertRequest {
    #[validate(
        length(min = 1, max = 20),
        custom(function = "crate::validation::validate_phone")
    )]
    pub phone: String,
    #[validate(email, length(max = 255))]
    pub email: Option<String>,
    #[validate(length(min = 1, max = 255))]
    pub from_name: String,
    #[validate(length(min = 1, max = 255))]
    pub to_name: String,
    pub route_id: Option<Uuid>,
    /// Canonical target price field.
    #[serde(alias = "maxPrice")]
    #[validate(range(min = 0, max = 1_000_000_000))]
    pub target_price: i64,
    #[validate(length(max = 10))]
    pub frequency: Option<String>,
}

/// Concrete list envelope for price alerts. Registered in the OpenAPI
/// `components(schemas(...))` (utoipa needs a non-generic type there).
/// The JSON shape is identical to `ListEnvelope<PriceAlertOut>`.
#[derive(Debug, Serialize, ToSchema)]
pub struct PriceAlertListEnvelope {
    pub items: Vec<PriceAlertOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    pub limit: u64,
    pub offset: u64,
}

impl From<ListEnvelope<PriceAlertOut>> for PriceAlertListEnvelope {
    fn from(e: ListEnvelope<PriceAlertOut>) -> Self {
        Self {
            items: e.items,
            total: e.total,
            limit: e.limit,
            offset: e.offset,
        }
    }
}

/// `POST /api/price-alerts` response. Includes a `duplicate` flag so the
/// frontend can show "alert already exists" feedback.
#[derive(Debug, Serialize, ToSchema)]
pub struct CreatePriceAlertResponse {
    #[serde(flatten)]
    pub alert: PriceAlertOut,
    pub duplicate: bool,
}

// ────────────────────────────────────────────────────────────────
//  Handlers
// ────────────────────────────────────────────────────────────────

/// `GET /api/price-alerts` — list price alerts.
///
/// - If `phone` is provided: guest lookup (public, no auth required).
/// - Otherwise: returns the authenticated user's alerts.
#[utoipa::path(
    get,
    path = "/api/price-alerts",
    tag = "price-alerts",
    params(ListPriceAlertsQuery),
    responses(
        (status = 200, description = "Price alert list", body = PriceAlertListEnvelope),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    MaybeAuthUser(maybe_uid): MaybeAuthUser,
    Query(q): Query<ListPriceAlertsQuery>,
) -> AppResult<Json<PriceAlertListEnvelope>> {
    let limit = q.base().clamped_limit(200);

    let filter = match (maybe_uid, q.phone.as_deref()) {
        // Authenticated, no phone override → use the user's alerts.
        (Some(uid), None) => PriceAlertListFilter {
            user_id: Some(uid),
            phone: None,
            status: q.status.clone(),
            limit,
            offset: q.offset,
        },
        // Phone provided → guest lookup (public). If the user is also
        // authenticated, prefer the user_id path so ownership is
        // established for new alerts created from the same dialog.
        (Some(uid), Some(_)) => PriceAlertListFilter {
            user_id: Some(uid),
            phone: None,
            status: q.status.clone(),
            limit,
            offset: q.offset,
        },
        // No auth, but phone provided → guest lookup.
        (None, Some(phone)) => PriceAlertListFilter {
            user_id: None,
            phone: Some(phone.to_string()),
            status: q.status.clone(),
            limit,
            offset: q.offset,
        },
        // No phone, no auth → require login.
        (None, None) => {
            return Err(crate::error::AppError::Unauthorized(
                "login or provide a phone query param".into(),
            ));
        }
    };

    let (alerts, total) = st.price_alerts.list(&filter).await?;
    let items: Vec<PriceAlertOut> = alerts.into_iter().map(PriceAlertOut::from).collect();
    Ok(Json(PriceAlertListEnvelope::from(
        ListEnvelope::new(items, limit, q.offset).with_total(total),
    )))
}

/// `POST /api/price-alerts` — create a price alert.
///
/// Requires authentication. The authenticated user becomes the alert
/// owner. The `phone` field is still required (for notification
/// delivery) and must match a valid Vietnamese mobile number.
#[utoipa::path(
    post,
    path = "/api/price-alerts",
    tag = "price-alerts",
    request_body = CreatePriceAlertRequest,
    responses(
        (status = 201, description = "Created (or existing duplicate returned)", body = CreatePriceAlertResponse),
        (status = 400, description = "Validation error"),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(body): Json<CreatePriceAlertRequest>,
) -> AppResult<Json<CreatePriceAlertResponse>> {
    body.validate()
        .map_err(|e| crate::error::AppError::Validation(e.to_string()))?;
    let input = CreatePriceAlertInput {
        user_id: Some(uid),
        phone: body.phone,
        email: body.email,
        from_name: body.from_name,
        to_name: body.to_name,
        route_id: body.route_id,
        target_price: body.target_price,
        frequency: body.frequency.unwrap_or_else(|| "daily".to_string()),
    };
    let (model, created) = st.price_alerts.create(&input).await?;
    Ok(Json(CreatePriceAlertResponse {
        alert: PriceAlertOut::from(model),
        duplicate: !created,
    }))
}

/// `DELETE /api/price-alerts/{id}` — cancel a price alert.
///
/// Requires authentication. Only the alert's owner may cancel it.
#[utoipa::path(
    delete,
    path = "/api/price-alerts/{id}",
    tag = "price-alerts",
    params(("id" = Uuid, Path, description = "Alert ID")),
    responses(
        (status = 200, description = "Cancelled", body = PriceAlertOut),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — not the owner"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn remove(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<PriceAlertOut>> {
    let model = st.price_alerts.remove(id, Some(uid)).await?;
    Ok(Json(PriceAlertOut::from(model)))
}

/// Build the price-alerts router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{delete, get};
    axum::Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", delete(remove))
}

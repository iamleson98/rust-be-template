//! Admin — Bus Layout routes (`/api/admin/bus-layouts`).

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};

use crate::dto::admin::{AdminBusLayoutListResponse, AdminBusLayoutsQuery};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/bus-layouts` — list all bus layouts.
#[utoipa::path(
    get,
    path = "/api/admin/bus-layouts",
    tag = "admin",
    params(AdminBusLayoutsQuery),
    responses(
        (status = 200, description = "Bus layout list", body = AdminBusLayoutListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(_q): Query<AdminBusLayoutsQuery>,
) -> Result<Json<AdminBusLayoutListResponse>, AppError> {
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_READ)
        .await?;
    Ok(Json(st.admin.list_bus_layouts().await?))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(list))
}

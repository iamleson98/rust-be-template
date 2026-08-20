//! Public site info endpoint — `/api/site-info`.
//!
//! Returns contact phone, email, address, social links.
//! Used by the frontend footer, contact forms, and JSON-LD.

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SiteInfo {
    pub phone: String,
    pub email: String,
    pub address: String,
    pub zalo_url: String,
    pub facebook_url: String,
}

/// `GET /api/site-info` — public contact + site info.
#[utoipa::path(
    get,
    path = "/api/site-info",
    tag = "public",
    responses(
        (status = 200, description = "Site info", body = SiteInfo),
    )
)]
pub async fn site_info(State(st): State<AppState>) -> AppResult<Json<SiteInfo>> {
    Ok(Json(SiteInfo {
        phone: st.config.contact.phone.clone(),
        email: st.config.contact.email.clone(),
        address: st.config.contact.address.clone(),
        zalo_url: st.config.contact.zalo_url.clone(),
        facebook_url: st.config.contact.facebook_url.clone(),
    }))
}

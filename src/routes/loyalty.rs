//! Loyalty route — `GET /api/loyalty`.

use axum::extract::State;
use axum::Json;

use crate::dto::loyalty::LoyaltyResponse;
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;

/// `GET /api/loyalty` — the authenticated user's loyalty summary.
///
/// Fully derived from real completed bookings (1 point per 10,000 VND
/// of booking total): point balance, tier band + benefit codes, the
/// next tier, and the per-booking earning history.
#[utoipa::path(
    get,
    path = "/api/loyalty",
    tag = "loyalty",
    responses(
        (status = 200, description = "Loyalty summary", body = LoyaltyResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn summary(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
) -> Result<Json<LoyaltyResponse>, AppError> {
    Ok(Json(st.loyalty.summary(uid).await?))
}

/// Build the loyalty router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new().route("/", get(summary))
}

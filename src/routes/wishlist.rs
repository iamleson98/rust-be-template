//! Wishlist routes — `GET /api/wishlist`, `POST /api/wishlist`,
//! `DELETE /api/wishlist/{id}`.

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;
use uuid::Uuid;
use validator::Validate;

use crate::dto::wishlist::{
    DeleteWishlistResponse, ToggleWishlistRequest, ToggleWishlistResponse, WishlistListResponse,
};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/wishlist` — list the authenticated user's wishlist items.
#[utoipa::path(
    get,
    path = "/api/wishlist",
    tag = "wishlist",
    params(ListQuery),
    responses(
        (status = 200, description = "Wishlist items", body = WishlistListResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<WishlistListResponse>, AppError> {
    Ok(Json(
        st.wishlist
            .list(uid, q.limit.unwrap_or(50), q.offset.unwrap_or(0))
            .await?,
    ))
}

/// `POST /api/wishlist` — toggle a route in the wishlist.
///
/// If the route is already in the wishlist, it's removed (returns
/// `added=false`). Otherwise it's added (returns `added=true`).
#[utoipa::path(
    post,
    path = "/api/wishlist",
    tag = "wishlist",
    request_body = ToggleWishlistRequest,
    responses(
        (status = 200, description = "Toggled", body = ToggleWishlistResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn toggle(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(body): Json<ToggleWishlistRequest>,
) -> Result<Json<ToggleWishlistResponse>, AppError> {
    body.validate().map_err(|e| crate::error::AppError::Validation(e.to_string()))?;
    Ok(Json(
        st.wishlist
            .toggle(uid, body.route_id.as_deref(), body.trip_id.as_deref())
            .await?,
    ))
}

/// `DELETE /api/wishlist/{id}` — remove a single wishlist item by id.
#[utoipa::path(
    delete,
    path = "/api/wishlist/{id}",
    tag = "wishlist",
    params(("id" = Uuid, Path, description = "Wishlist item ID")),
    responses(
        (status = 200, description = "Removed", body = DeleteWishlistResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn remove(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<DeleteWishlistResponse>, AppError> {
    Ok(Json(st.wishlist.remove(uid, id).await?))
}

/// Build the wishlist router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{delete, get};
    axum::Router::new()
        .route("/", get(list).post(toggle))
        .route("/{id}", delete(remove))
}

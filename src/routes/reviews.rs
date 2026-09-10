use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;
use validator::Validate;

use crate::dto::review::{
    CreateReviewInput, ReviewDeleteResponse, ReviewListResponse, ReviewMutationResponse, ReviewOut,
    ReviewTagsResponse, UpdateReviewInput,
};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::service::review_service::ReviewListFilter;
use crate::state::AppState;

#[derive(Deserialize, utoipa::IntoParams)]
pub struct ListQuery {
    pub brand_id: Option<String>,
    pub route_id: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/reviews` — public list of APPROVED reviews with optional
/// brand/route filters.
///
/// Moderation policy (fail-closed):
///   * `status` is NOT accepted — the public list ALWAYS serves
///     `approved` rows only. Callers must never be able to enumerate
///     `pending`/`rejected`/`hidden` feedback via the public API
///     (rejected feedback may contain content the moderation team
///     deliberately suppressed).
///   * `user_id` is NOT accepted — that filter exists only on the
///     authenticated `/api/reviews/mine` (forced to the caller) and
///     the admin list. A public `user_id` filter would let anyone
///     enumerate any user's review history.
#[utoipa::path(
    get,
    path = "/api/reviews",
    tag = "reviews",
    params(ListQuery),
    responses(
        (status = 200, description = "Approved reviews for the given scope", body = ReviewListResponse),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<ReviewListResponse>, AppError> {
    // Validate the optional uuid filters up front — the store binds
    // them as Uuid values and silently drops unparseable strings, so
    // reject garbage here (fail-closed) instead of returning the
    // unfiltered list.
    for (name, v) in [
        ("brand_id", q.brand_id.as_deref()),
        ("route_id", q.route_id.as_deref()),
    ] {
        if let Some(s) = v {
            if Uuid::parse_str(s).is_err() {
                return Err(AppError::Validation(format!("invalid {name}: {s}")));
            }
        }
    }
    Ok(Json(st.reviews.list(&public_list_filter(&q)).await?))
}

/// Build the public list filter. Kept as a pure function so the
/// moderation policy is unit-testable: whatever arrives in the query
/// string, the public list is approved-only, caller-agnostic and
/// search-less (admin-only features).
fn public_list_filter(q: &ListQuery) -> ReviewListFilter {
    ReviewListFilter {
        brand_id: q.brand_id.clone(),
        route_id: q.route_id.clone(),
        user_id: None,
        // Public surface: approved-only, hardcoded.
        status: Some("approved".to_string()),
        search: None,
        limit: q.limit.unwrap_or(20).min(200),
        offset: q.offset.unwrap_or(0),
    }
}

#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct MineQuery {
    /// Optional status filter: `pending` | `approved` | `rejected`.
    pub status: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/reviews/mine` — the authenticated user's own reviews
/// with a true `total` (server-side pagination for the account
/// feedback history page). The `user_id` scope is forced to the
/// caller — never taken from the query string.
#[utoipa::path(
    get,
    path = "/api/reviews/mine",
    tag = "reviews",
    params(MineQuery),
    responses(
        (status = 200, description = "The caller's reviews", body = ReviewListResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn mine(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Query(q): Query<MineQuery>,
) -> Result<Json<ReviewListResponse>, AppError> {
    Ok(Json(
        st.reviews
            .list_mine(
                &uid.to_string(),
                q.status.as_deref(),
                q.limit.unwrap_or(20),
                q.offset.unwrap_or(0),
            )
            .await?,
    ))
}

/// `GET /api/reviews/{id}` — get a review by ID.
#[utoipa::path(
    get,
    path = "/api/reviews/{id}",
    tag = "reviews",
    params(("id" = Uuid, Path, description = "Review ID")),
    responses(
        (status = 200, description = "Review detail", body = ReviewOut),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ReviewOut>, AppError> {
    Ok(Json(st.reviews.get(id).await?))
}

/// `POST /api/reviews` — create a review. Requires authentication.
#[utoipa::path(
    post,
    path = "/api/reviews",
    tag = "reviews",
    request_body = CreateReviewInput,
    responses(
        (status = 201, description = "Created review", body = ReviewMutationResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(body): Json<CreateReviewInput>,
) -> Result<Json<ReviewMutationResponse>, AppError> {
    body.validate()
        .map_err(|e| crate::error::AppError::Validation(e.to_string()))?;
    let mut input = body;
    input.user_id = Some(uid);
    Ok(Json(
        st.reviews.create(Some(&uid.to_string()), &input).await?,
    ))
}

/// `PATCH /api/reviews/{id}` — update a review. Requires authentication.
#[utoipa::path(
    patch,
    path = "/api/reviews/{id}",
    tag = "reviews",
    params(("id" = Uuid, Path, description = "Review ID")),
    request_body = UpdateReviewInput,
    responses(
        (status = 200, description = "Updated review", body = ReviewMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn update(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateReviewInput>,
) -> Result<Json<ReviewMutationResponse>, AppError> {
    body.validate()
        .map_err(|e| crate::error::AppError::Validation(e.to_string()))?;
    Ok(Json(
        st.reviews.update(id, Some(&uid.to_string()), &body).await?,
    ))
}

/// `DELETE /api/reviews/{id}` — delete a review. Requires authentication.
#[utoipa::path(
    delete,
    path = "/api/reviews/{id}",
    tag = "reviews",
    params(("id" = Uuid, Path, description = "Review ID")),
    responses(
        (status = 200, description = "Deleted", body = ReviewDeleteResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn remove(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ReviewDeleteResponse>, AppError> {
    st.reviews.remove(id, Some(&uid.to_string())).await?;
    Ok(Json(ReviewDeleteResponse { ok: true }))
}

/// `GET /api/reviews/tags` — public tag index over APPROVED reviews
/// only (a tag surfacing exclusively on rejected feedback would leak
/// that the moderation queue handled that topic).
#[utoipa::path(
    get,
    path = "/api/reviews/tags",
    tag = "reviews",
    responses(
        (status = 200, description = "Tags index (approved reviews)", body = ReviewTagsResponse),
    )
)]
pub async fn tags(State(st): State<AppState>) -> Result<Json<ReviewTagsResponse>, AppError> {
    Ok(Json(st.reviews.tags_index().await?))
}

/// Build the reviews router.
pub fn router() -> axum::Router<crate::state::AppState> {
    // `get` is both a routing function (axum::routing::get) and a handler
    // in this module (the `pub async fn get` above). Import the routing
    // function under a different name to avoid the `get(get)` collision.
    use axum::routing::get as rget;
    axum::Router::new()
        .route("/tags", rget(tags))
        .route("/mine", rget(mine))
        .route("/", rget(list).post(create))
        .route("/{id}", rget(get).patch(update).delete(remove))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The public list is APPROVED-only regardless of what the caller
    /// sends — `pending`/`rejected`/`hidden` feedback must never be
    /// enumerable through `/api/reviews`.
    #[test]
    fn public_filter_is_approved_only() {
        let q = ListQuery {
            brand_id: Some("b".repeat(36)),
            route_id: None,
            limit: Some(500),
            offset: Some(40),
        };
        let f = public_list_filter(&q);
        assert_eq!(f.status.as_deref(), Some("approved"));
        assert_eq!(f.user_id, None);
        assert_eq!(f.search, None);
        assert_eq!(f.brand_id, Some("b".repeat(36)));
        assert_eq!(f.limit, 200, "limit must be capped at 200");
        assert_eq!(f.offset, 40);
    }

    /// `user_id` / `status` are not fields of `ListQuery` any more —
    /// serde drops unknown keys, so a caller probing with
    /// `?user_id=…&status=rejected` gets the approved-only list, not a
    /// per-user or unmoderated enumeration.
    #[test]
    fn query_deser_drops_user_id_and_status() {
        let q: ListQuery = serde_json::from_str(
            r#"{"user_id":"00000000-0000-0000-0000-000000000000","status":"rejected"}"#,
        )
        .expect("unknown fields must be ignored");
        let f = public_list_filter(&q);
        assert_eq!(f.status.as_deref(), Some("approved"));
        assert_eq!(f.user_id, None);
        assert_eq!(f.limit, 20, "default limit");
        assert_eq!(f.offset, 0, "default offset");
    }
}

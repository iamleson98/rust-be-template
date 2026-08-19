use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

use crate::entity::posts;
use crate::error::AppResult;
use crate::middleware::AuthUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PostOut {
    pub id: Uuid,
    pub author_id: Uuid,
    pub title: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<posts::Model> for PostOut {
    fn from(m: posts::Model) -> Self {
        Self {
            id: m.id,
            author_id: m.author_id,
            title: m.title,
            body: m.body,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListPostsQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPostsResponse {
    pub items: Vec<PostOut>,
    pub limit: u64,
    pub offset: u64,
    /// Total post count (independent of pagination). Omitted when not
    /// computed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

/// `GET /api/posts` — list posts (public read).
#[utoipa::path(
    get,
    path = "/api/posts",
    tag = "posts",
    params(ListPostsQuery),
    responses((status = 200, description = "Post list", body = ListPostsResponse))
)]
pub async fn list_posts(
    State(state): State<AppState>,
    Query(q): Query<ListPostsQuery>,
) -> AppResult<Json<ListPostsResponse>> {
    let limit = q.limit.unwrap_or(20).min(200);
    let offset = q.offset.unwrap_or(0);
    let posts = state.posts.list(limit, offset).await?;
    Ok(Json(ListPostsResponse {
        items: posts.into_iter().map(PostOut::from).collect(),
        limit,
        offset,
        // Total count not yet wired in (PostStore would need a `count_posts` method).
        // Omitted from JSON via `skip_serializing_if`.
        total: None,
    }))
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct CreatePostRequest {
    #[validate(length(min = 1, max = 256))]
    pub title: String,
    #[validate(length(min = 1))]
    pub body: String,
}

/// `POST /api/posts` — create a post. Requires `posts:write`.
#[utoipa::path(
    post,
    path = "/api/posts",
    tag = "posts",
    request_body = CreatePostRequest,
    responses(
        (status = 201, description = "Created post", body = PostOut),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn create_post(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(body): Json<CreatePostRequest>,
) -> AppResult<Json<PostOut>> {
    body.validate()
        .map_err(|e| crate::error::AppError::Validation(e.to_string()))?;
    // RBAC check at the route layer — the service stays pure.
    state.rbac.check(user_id, rbac::POSTS_WRITE).await?;
    let post = state.posts.create(user_id, body.title, body.body).await?;
    Ok(Json(PostOut::from(post)))
}

/// `GET /api/posts/{id}` — get a post.
#[utoipa::path(
    get,
    path = "/api/posts/{id}",
    tag = "posts",
    params(("id" = Uuid, Path, description = "Post ID")),
    responses((status = 200, description = "Post", body = PostOut))
)]
pub async fn get_post(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<PostOut>> {
    let post = state.posts.get(id).await?;
    Ok(Json(PostOut::from(post)))
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct UpdatePostRequest {
    #[validate(length(min = 1, max = 256))]
    pub title: Option<String>,
    #[validate(length(min = 1))]
    pub body: Option<String>,
}

/// `PATCH /api/posts/{id}` — update a post. Requires `posts:write`.
#[utoipa::path(
    patch,
    path = "/api/posts/{id}",
    tag = "posts",
    params(("id" = Uuid, Path, description = "Post ID")),
    request_body = UpdatePostRequest,
    responses(
        (status = 200, description = "Updated post", body = PostOut),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn update_post(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePostRequest>,
) -> AppResult<Json<PostOut>> {
    body.validate()
        .map_err(|e| crate::error::AppError::Validation(e.to_string()))?;
    state.rbac.check(user_id, rbac::POSTS_WRITE).await?;
    let post = state.posts.update(id, body.title, body.body).await?;
    Ok(Json(PostOut::from(post)))
}

/// `DELETE /api/posts/{id}` — delete a post. Requires `posts:delete`.
#[utoipa::path(
    delete,
    path = "/api/posts/{id}",
    tag = "posts",
    params(("id" = Uuid, Path, description = "Post ID")),
    responses((status = 204, description = "Deleted"), (status = 403, description = "Forbidden"))
)]
pub async fn delete_post(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<()> {
    // require_permission(&state, user_id, rbac::POSTS_DELETE).await?;
    state.rbac.check(user_id, rbac::POSTS_DELETE).await?;
    state.posts.delete(id).await?;
    Ok(())
}

/// Build the posts router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(list_posts).post(create_post))
        .route("/{id}", get(get_post).patch(update_post).delete(delete_post))
}

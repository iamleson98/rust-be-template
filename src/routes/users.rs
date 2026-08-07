use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::entity::user;
use crate::error::AppResult;
use crate::middleware::AuthUser;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct UserOut {
    pub id: Uuid,
    pub email: String,
    pub username: String,
    pub created_at: DateTime<Utc>,
}

impl From<user::Model> for UserOut {
    fn from(m: user::Model) -> Self {
        Self {
            id: m.id,
            email: m.email,
            username: m.username,
            created_at: m.created_at.and_utc(),
        }
    }
}

/// `GET /api/users` — list users. Requires `users:read`.
#[utoipa::path(
    get,
    path = "/api/users",
    tag = "users",
    responses(
        (status = 200, description = "User list", body = Vec<UserOut>),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list_users(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> AppResult<Json<Vec<UserOut>>> {
    let users = state.users.list(user_id).await?;
    Ok(Json(users.into_iter().map(UserOut::from).collect()))
}

/// `GET /api/users/{id}` — get a user. Requires `users:read`.
#[utoipa::path(
    get,
    path = "/api/users/{id}",
    tag = "users",
    params(("id" = Uuid, Path, description = "User ID")),
    responses(
        (status = 200, description = "User", body = UserOut),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get_user(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<UserOut>> {
    let user = state.users.get(user_id, id).await?;
    Ok(Json(UserOut::from(user)))
}

#[derive(Debug, validator::Validate, utoipa::ToSchema, serde::Deserialize)]
pub struct DeleteUserRequest {
    pub confirm: bool,
}

/// `DELETE /api/users/{id}` — delete a user. Requires `users:delete`.
#[utoipa::path(
    delete,
    path = "/api/users/{id}",
    tag = "users",
    params(("id" = Uuid, Path, description = "User ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn delete_user(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<()> {
    state.users.delete(user_id, id).await?;
    Ok(())
}

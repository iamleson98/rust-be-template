use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::entity::user;
use crate::error::AppResult;
use crate::middleware::AuthUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserOut {
    pub id: Uuid,
    /// User's email. The underlying column is non-null but may be empty —
    /// we normalise to `None` for the wire so the frontend's optional type
    /// is honest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub full_name: String,
    pub created_at: String,
}

impl From<user::Model> for UserOut {
    fn from(m: user::Model) -> Self {
        Self {
            id: m.id,
            email: if m.email.is_empty() {
                None
            } else {
                Some(m.email)
            },
            full_name: m.full_name,
            created_at: m.created_at.to_rfc3339(),
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct ListUsersQuery {
    #[serde(default)]
    pub limit: Option<u64>,
    #[serde(default)]
    pub offset: Option<u64>,
}

/// `GET /api/users` — list users. Requires `users:read`.
#[utoipa::path(
    get,
    path = "/api/users",
    tag = "users",
    params(ListUsersQuery),
    responses(
        (status = 200, description = "User list", body = Vec<UserOut>),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list_users(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Query(q): Query<ListUsersQuery>,
) -> AppResult<Json<Vec<UserOut>>> {
    state.rbac.check(user_id, rbac::USERS_READ).await?;
    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);
    let users = state.users.list(limit, offset).await?;
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
    state.rbac.check(user_id, rbac::USERS_READ).await?;
    let user = state.users.get(id).await?;
    Ok(Json(UserOut::from(user)))
}

// #[derive(Debug, validator::Validate, utoipa::ToSchema, serde::Deserialize)]
// pub struct DeleteUserRequest {
//     pub confirm: bool,
// }

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
    state.rbac.check(user_id, rbac::USERS_DELETE).await?;
    state.users.delete(id).await?;
    Ok(())
}

/// Build the users router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(list_users))
        .route("/{id}", get(get_user).delete(delete_user))
}

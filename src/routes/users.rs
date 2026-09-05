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
    /// `"user"` | `"employee"` | `"admin"` (three-role model).
    pub role: String,
    /// True for the NullClaw bot account (role management is refused).
    pub is_bot: bool,
    /// Account status (`active` / `blocked`).
    pub status: String,
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
            role: m.role,
            is_bot: m.is_bot,
            status: m.status,
        }
    }
}

/// Request body for `PATCH /api/users/{id}/role`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetUserRoleRequest {
    /// The new role: `"user"`, `"employee"` or `"admin"`.
    pub role: String,
}

/// Response of `PATCH /api/users/{id}/role`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetUserRoleResponse {
    pub user: UserOut,
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

/// Response of `GET /api/users` — one page + the filtered total (server-
/// side pagination for the admin Users table).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserListResponse {
    pub items: Vec<UserOut>,
    pub total: i64,
}

/// `GET /api/users` — list users (paginated). Requires `users:read`.
#[utoipa::path(
    get,
    path = "/api/users",
    tag = "users",
    params(ListUsersQuery),
    responses(
        (status = 200, description = "User list", body = UserListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list_users(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Query(q): Query<ListUsersQuery>,
) -> AppResult<Json<UserListResponse>> {
    state.rbac.check(user_id, rbac::USERS_READ).await?;
    let limit = q.limit.unwrap_or(50).min(200);
    let offset = q.offset.unwrap_or(0);
    let (users, total) = state.users.list_page(limit, offset).await?;
    Ok(Json(UserListResponse {
        items: users.into_iter().map(UserOut::from).collect(),
        total,
    }))
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

/// `PATCH /api/users/{id}/role` — change a user's role. Requires
/// `admin:users:manage-roles` (admins only by construction — the seed
/// grants it solely to the admin role).
///
/// Guards (service layer):
///   - bot accounts can't change roles,
///   - the last human admin cannot be demoted.
#[utoipa::path(
    patch,
    path = "/api/users/{id}/role",
    tag = "users",
    params(("id" = Uuid, Path, description = "User ID")),
    request_body = SetUserRoleRequest,
    responses(
        (status = 200, description = "Role updated", body = SetUserRoleResponse),
        (status = 400, description = "Invalid role or bot account"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 409, description = "Cannot demote the last admin"),
        (status = 404, description = "User not found"),
    )
)]
pub async fn set_user_role(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<SetUserRoleRequest>,
) -> AppResult<Json<SetUserRoleResponse>> {
    if !matches!(body.role.as_str(), "user" | "employee" | "admin") {
        return Err(crate::error::AppError::Validation(
            "role must be one of: user, employee, admin".into(),
        ));
    }
    state
        .rbac
        .check(user_id, rbac::ADMIN_USERS_MANAGE_ROLES)
        .await?;
    let updated = state.users.set_role(id, &body.role).await?;
    Ok(Json(SetUserRoleResponse {
        user: UserOut::from(updated),
    }))
}

/// Build the users router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{get, patch};
    axum::Router::new()
        .route("/", get(list_users))
        .route("/{id}", get(get_user).delete(delete_user))
        .route("/{id}/role", patch(set_user_role))
}

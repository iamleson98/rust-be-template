//! Admin — Route picture endpoints (`/api/admin/routes/{id}/pictures`).
//!
//! Owns the media write path: multipart upload (validated +
//! thumbnailed + content-addressed by `RouteMediaService`), reorder /
//! alt-text patch, single + bulk delete. The public read path lives in
//! `routes/public.rs` (`GET /api/routes/{id}/pictures`) and the byte
//! proxy in `routes/media.rs`.
//!
//! Route-scoped body limit: the upload route raises axum's extractor
//! limit to the picture cap + multipart overhead; every other admin
//! JSON route keeps the default 2 MiB. The global `tower_http` body
//! limit in `router.rs` is raised to accommodate this route (JSON
//! routes are still protected by axum's extractor-level default).

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::route_media::{
    RoutePictureDeleteResponse, RoutePictureListResponse, RoutePictureOut,
    RoutePictureUploadResponse, RoutePicturesBulkDeleteResponse, UpdateRoutePictureInput,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::service::route_media_service::MAX_PICTURE_BYTES;
use crate::state::AppState;

/// Per-request body cap for the upload route: one picture (≤10 MiB) +
/// multipart framing + the optional alt-text field.
const UPLOAD_BODY_LIMIT: usize = MAX_PICTURE_BYTES + 64 * 1024;

/// `GET /api/admin/routes/{id}/pictures` — the ordered gallery
/// (admin view; same payload as the public endpoint).
#[utoipa::path(
    get,
    path = "/api/admin/routes/{id}/pictures",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Route ID")),
    responses(
        (status = 200, description = "Picture list", body = RoutePictureListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list_pictures(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<RoutePictureListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_READ)
        .await?;
    Ok(Json(st.media.list(id).await?))
}

/// `POST /api/admin/routes/{id}/pictures` — upload one picture.
///
/// Multipart fields:
///   * `file` (required) — JPEG / PNG / WebP, ≤ 10 MiB. Validated by
///     magic bytes AND fully decoded server-side (rejects polyglot /
///     corrupt files); the client-declared Content-Type is ignored.
///   * `alt_text` (optional) — accessible description, ≤ 255 chars.
///
/// Idempotent on content: re-uploading the exact same bytes for the
/// same route returns the existing row with `deduped: true`.
#[utoipa::path(
    post,
    path = "/api/admin/routes/{id}/pictures",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Route ID")),
    request_body(content = Vec<u8>, description = "multipart/form-data: `file` (image), optional `alt_text`", content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "Stored picture (or existing row when deduped)", body = RoutePictureUploadResponse),
        (status = 400, description = "Validation failed (format / size / count cap)"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Route not found"),
    )
)]
pub async fn upload_picture(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Response, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_WRITE)
        .await?;

    // Pull exactly the fields we understand out of the multipart
    // body; unknown fields are ignored (forward compatibility).
    let mut file: Option<Bytes> = None;
    let mut alt_text: Option<String> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("malformed multipart body: {e}")))?
    {
        match field.name().unwrap_or_default() {
            "file" => {
                if file.is_some() {
                    return Err(AppError::BadRequest(
                        "multipart field 'file' must appear exactly once".into(),
                    ));
                }
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read file part: {e}")))?;
                file = Some(data);
            }
            "alt_text" => {
                let txt = field.text().await.map_err(|e| {
                    AppError::BadRequest(format!("failed to read alt_text part: {e}"))
                })?;
                if !txt.trim().is_empty() {
                    alt_text = Some(txt.trim().to_string());
                }
            }
            _ => {}
        }
    }

    let data = file
        .ok_or_else(|| AppError::BadRequest("multipart field 'file' (image) is required".into()))?;
    if let Some(ref at) = alt_text {
        if at.len() > 255 {
            return Err(AppError::Validation(
                "alt_text exceeds 255 characters".into(),
            ));
        }
    }

    let out = st.media.upload(id, data, alt_text).await?;
    // 201 for a new picture; 200 when the exact same content was
    // already attached (idempotent re-upload).
    let status = if out.deduped {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    Ok((status, Json(out)).into_response())
}

/// `PATCH /api/admin/routes/{id}/pictures/{pictureId}` — reorder
/// (`sortOrder`) and/or edit `altText`.
#[utoipa::path(
    patch,
    path = "/api/admin/routes/{id}/pictures/{pictureId}",
    tag = "admin",
    params(
        ("id" = Uuid, Path, description = "Route ID"),
        ("pictureId" = Uuid, Path, description = "Picture ID"),
    ),
    request_body = UpdateRoutePictureInput,
    responses(
        (status = 200, description = "Updated picture", body = RoutePictureOut),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Picture not found on this route"),
    )
)]
pub async fn patch_picture(
    State(st): State<AppState>,
    admin: AdminUser,
    Path((id, picture_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateRoutePictureInput>,
) -> Result<Json<RoutePictureOut>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_WRITE)
        .await?;
    body.validate().map_err(AppError::from)?;
    Ok(Json(
        st.media
            .patch(id, picture_id, body.sort_order, body.alt_text)
            .await?,
    ))
}

/// `DELETE /api/admin/routes/{id}/pictures/{pictureId}` — remove one
/// picture (row + both objects).
#[utoipa::path(
    delete,
    path = "/api/admin/routes/{id}/pictures/{pictureId}",
    tag = "admin",
    params(
        ("id" = Uuid, Path, description = "Route ID"),
        ("pictureId" = Uuid, Path, description = "Picture ID"),
    ),
    responses(
        (status = 200, description = "Deleted", body = RoutePictureDeleteResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Picture not found on this route"),
    )
)]
pub async fn delete_picture(
    State(st): State<AppState>,
    admin: AdminUser,
    Path((id, picture_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<RoutePictureDeleteResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_WRITE)
        .await?;
    Ok(Json(st.media.delete(id, picture_id).await?))
}

/// `DELETE /api/admin/routes/{id}/pictures` — clear the whole gallery.
#[utoipa::path(
    delete,
    path = "/api/admin/routes/{id}/pictures",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Route ID")),
    responses(
        (status = 200, description = "Cleared", body = RoutePicturesBulkDeleteResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn delete_all_pictures(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<RoutePicturesBulkDeleteResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_WRITE)
        .await?;
    Ok(Json(st.media.delete_all(id).await?))
}

/// Picture routes, with the raised body limit scoped to exactly these
/// paths (merged into the admin routes router — full-path patterns,
/// because axum `nest` doesn't accept path parameters).
pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/{id}/pictures",
            get(list_pictures)
                .post(upload_picture)
                .delete(delete_all_pictures),
        )
        .route(
            "/{id}/pictures/{picture_id}",
            patch(patch_picture).delete(delete_picture),
        )
        .route_layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT))
}

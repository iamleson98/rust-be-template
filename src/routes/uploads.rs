//! Admin file uploads — `/api/uploads/*`.
//!
//! `POST /api/uploads/brand-logo` stores a brand logo and answers with
//! the URL the admin brand form then saves on the brand
//! (`PUT /api/admin/brands/{id}` with `logoUrl`); the upload itself does
//! not touch the brand row.

use axum::extract::{DefaultBodyLimit, Multipart, State};
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use serde::Serialize;
use utoipa::ToSchema;

use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::service::route_media_service::MAX_LOGO_BYTES;
use crate::state::AppState;

/// Request body cap: one logo (≤5 MiB) + multipart framing.
const LOGO_BODY_LIMIT: usize = MAX_LOGO_BYTES + 64 * 1024;

/// Response of `POST /api/uploads/brand-logo`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BrandLogoUploadResponse {
    /// Storage key: `brands/logos/{hash16}.{webp|svg}`.
    pub key: String,
    /// `/api/media/{key}` — the value to store as the brand's `logoUrl`.
    pub url: String,
}

/// Multipart body of `POST /api/uploads/brand-logo` (documentation only:
/// the handler reads the parts itself).
#[derive(ToSchema)]
pub struct BrandLogoUploadForm {
    /// The logo: JPEG, PNG, WebP or SVG, ≤ 5 MiB.
    #[schema(value_type = String, format = Binary)]
    pub file: Vec<u8>,
}

/// `POST /api/uploads/brand-logo` — upload one brand logo.
///
/// Multipart field `file` (required): JPEG / PNG / WebP (stored as WebP
/// scaled to 512 px, metadata dropped) or SVG (stored as uploaded after
/// a safety check), ≤ 5 MiB. The format is read from the content, never
/// from the declared Content-Type. Content-addressed: the same logo
/// uploaded twice yields the same key.
#[utoipa::path(
    post,
    path = "/api/uploads/brand-logo",
    tag = "uploads",
    request_body(content = BrandLogoUploadForm, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "Stored logo", body = BrandLogoUploadResponse),
        (status = 400, description = "Missing file, unsupported format, corrupt image, unsafe SVG or over 5 MiB"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn upload_brand_logo(
    State(st): State<AppState>,
    admin: AdminUser,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<BrandLogoUploadResponse>), AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BRANDS_WRITE)
        .await?;

    let mut file = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("malformed multipart body: {e}")))?
    {
        if field.name() == Some("file") {
            if file.is_some() {
                return Err(AppError::BadRequest(
                    "multipart field 'file' must appear exactly once".into(),
                ));
            }
            file = Some(
                field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read file part: {e}")))?,
            );
        }
    }
    let data =
        file.ok_or_else(|| AppError::BadRequest("multipart field 'file' is required".into()))?;

    let key = st.media.upload_brand_logo(data).await?;
    let url = format!("/api/media/{key}");
    Ok((
        StatusCode::CREATED,
        Json(BrandLogoUploadResponse { key, url }),
    ))
}

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/brand-logo",
        post(upload_brand_logo).route_layer(DefaultBodyLimit::max(LOGO_BODY_LIMIT)),
    )
}

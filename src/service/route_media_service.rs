//! Route media service — picture gallery per bus route, backed by the
//! pluggable [`FileStorage`] backends (local dev / RustFS / S3).
//!
//! ## Pipeline (admin upload)
//!
//! ```text
//! multipart file ─→ size cap ─→ magic-byte sniff ─→ full decode*
//!   (spawn_blocking: rejects polyglot/corrupt files, yields dims,
//!    re-encodes a 640px JPEG thumbnail)
//! ─→ sha-256 content hash ─→ dedupe probe ─→ picture-count cap
//! ─→ PUT original + PUT thumb (immutable cache headers)
//! ─→ INSERT route_picture row
//! ```
//!
//! ## Content-addressed immutability
//!
//! Keys embed a 16-hex prefix of the sha-256 of the bytes:
//! `routes/{route_id}/{hash16}.{ext}` (+ `routes/{route_id}/t{hash16}.jpg`
//! for the thumbnail). The bytes behind a key can therefore NEVER
//! change, which is what justifies the aggressive
//! `Cache-Control: public, max-age=31536000, immutable` on every read
//! path: browsers and the CDN (Cloudflare → Caddy → RustFS) hold the
//! object forever and a "new picture" is simply a new key. No cache
//! purge machinery anywhere.
//!
//! ## URL resolution (CDN vs proxy)
//!
//! * `STORAGE_PUBLIC_BASE_URL` set (production) → the API emits
//!   absolute URLs against that origin (`https://media.datxevui.com/
//!   {bucket}/routes/…`) and image bytes NEVER flow through the
//!   backend.
//! * unset (dev / local storage) → URLs point at the backend's own
//!   `GET /api/media/{key}` proxy, which re-serializes the same
//!   immutable cache headers and answers `If-None-Match` with 304.
//!
//! ## Garbage collection
//!
//! DB rows are the only index of which objects exist. Every delete
//! path removes the row AND the two backing objects (best-effort on
//! the object side — an orphaned object is inert storage, an orphaned
//! row is a broken image).

use std::sync::Arc;

use chrono::Utc;
use sea_orm::{IntoActiveModel, Set};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::dto::route_media::{
    RoutePictureDeleteResponse, RoutePictureListResponse, RoutePictureOut,
    RoutePictureUploadResponse, RoutePicturesBulkDeleteResponse,
};
use crate::entity::route_picture;
use crate::error::{AppError, AppResult};
use crate::storage::{FileStorage, PutOptions};
use crate::store::{RoutePictureStore, RouteStore};

/// Hard cap on pictures per route ("a few pictures" — gallery, not a
/// photo dump). Enforced before any storage write.
pub const MAX_PICTURES_PER_ROUTE: usize = 12;

/// Per-file byte cap. Generous for phone photos (typical 3-8 MB),
/// small enough to keep multipart bodies bounded.
pub const MAX_PICTURE_BYTES: usize = 10 * 1024 * 1024;

/// Long-edge pixel cap for the generated thumbnail.
const THUMB_LONG_EDGE: u32 = 640;

/// JPEG quality for thumbnails — 82 is the sweet spot on the
/// size/quality curve for 640px covers.
const THUMB_JPEG_QUALITY: u8 = 82;

/// `Cache-Control` for every media read. Valid because keys are
/// content-addressed: the object behind a key never changes.
pub const IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

// ────────────────────────────────────────────────────────────────
//  Format sniffing (magic bytes — never trust the client MIME)
// ────────────────────────────────────────────────────────────────

/// Sniff the real container format from the leading magic bytes.
/// Returns `(canonical_extension, mime_type)`.
///
/// GIF / BMP / TIFF / HEIC are deliberately NOT accepted: no animation
/// support, and thumbnails are re-encoded as JPEG anyway.
fn sniff_format(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("jpg", "image/jpeg"))
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(("png", "image/png"))
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("webp", "image/webp"))
    } else {
        None
    }
}

/// CPU-bound image work: full decode (validity + dimensions) and
/// JPEG thumbnail re-encode. Runs inside `spawn_blocking`.
struct DecodedImage {
    /// JPEG thumbnail bytes (long edge ≤ 640px, quality 82).
    thumb_jpeg: Vec<u8>,
    /// Original pixel dimensions.
    width: u32,
    height: u32,
}

fn decode_and_thumbnail(data: &[u8]) -> anyhow::Result<DecodedImage> {
    // Full decode — this is the security gate: a crafted polyglot or
    // truncated file fails HERE, before any storage write.
    let img = image::load_from_memory(data)?;
    let (width, height) = (img.width(), img.height());

    let thumb = if width.max(height) > THUMB_LONG_EDGE {
        // Triangle filter: fast, and at 640px downscale the quality
        // difference vs Lanczos3 is invisible under JPEG q82.
        img.resize(
            THUMB_LONG_EDGE,
            THUMB_LONG_EDGE,
            image::imageops::FilterType::Triangle,
        )
    } else {
        img
    };

    // JPEG has no alpha channel — flatten to RGB8 first. Re-encoding
    // also strips EXIF (GPS coordinates!) by construction.
    let rgb = thumb.to_rgb8();
    let mut thumb_jpeg = Vec::with_capacity(64 * 1024);
    let encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut thumb_jpeg, THUMB_JPEG_QUALITY);
    rgb.write_with_encoder(encoder)?;
    Ok(DecodedImage {
        thumb_jpeg,
        width,
        height,
    })
}

// ────────────────────────────────────────────────────────────────
//  Key handling — the ONLY shapes the serve endpoint will proxy
// ────────────────────────────────────────────────────────────────

/// A validated media key, split into its parts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMediaKey {
    pub route_id: String,
    /// 16 lowercase hex chars — sha-256 prefix of the content.
    pub hash16: String,
    /// `true` for the thumbnail variant.
    pub thumb: bool,
    /// Canonical extension (mirrors the sniffed format at upload).
    pub ext: String,
}

impl ParsedMediaKey {
    /// Strong ETag for this object (HTTP-spec quoted). Derived purely
    /// from the key's content hash — no storage round-trip needed for
    /// revalidation.
    pub fn etag(&self) -> String {
        format!("\"{}\"", self.hash16)
    }

    pub fn content_type(&self) -> &'static str {
        if self.thumb {
            // Thumbnails are always re-encoded JPEG.
            "image/jpeg"
        } else {
            match self.ext.as_str() {
                "png" => "image/png",
                "webp" => "image/webp",
                _ => "image/jpeg",
            }
        }
    }
}

/// Strict structural validation of a media key. This is the gate the
/// public serve endpoint (`GET /api/media/{key}`) uses: anything that
/// doesn't match the shapes WE generate is a 404 — it also forecloses
/// path traversal and arbitrary-key reads on backends (LocalStorage
/// additionally rejects `..` components itself; defense in depth).
///
/// Accepted shapes:
///   * `routes/{uuid}/{16hex}.{jpg|png|webp}`
///   * `routes/{uuid}/t{16hex}.jpg`   (thumbnail — always jpg)
pub fn parse_media_key(key: &str) -> Option<ParsedMediaKey> {
    let mut parts = key.split('/');
    if parts.next()? != "routes" {
        return None;
    }
    let route_id = parts.next()?;
    let filename = parts.next()?;
    if parts.next().is_some() {
        return None; // exactly three components
    }
    if Uuid::parse_str(route_id).is_err() {
        return None;
    }
    if !route_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return None;
    }

    let (name, ext) = filename.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    let (thumb, hash) = match name.as_bytes().first() {
        Some(b't') => (true, &name[1..]),
        _ => (false, name),
    };
    if hash.len() != 16 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match (thumb, ext.as_str()) {
        (true, "jpg") => {}
        (false, "jpg" | "png" | "webp") => {}
        _ => return None,
    }
    Some(ParsedMediaKey {
        route_id: route_id.to_string(),
        hash16: hash.to_ascii_lowercase(),
        thumb,
        ext,
    })
}

/// Build the canonical key pair for a picture.
fn keys_for(route_id: Uuid, hash: &str, ext: &str) -> (String, String) {
    let base = format!("routes/{route_id}");
    (
        format!("{base}/{hash}.{ext}"),
        format!("{base}/t{hash}.jpg"),
    )
}

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

/// A media object fetched from storage, ready to be served by the
/// proxy endpoint.
#[derive(Debug)]
pub struct ServedMedia {
    pub bytes: bytes::Bytes,
    pub content_type: &'static str,
    pub etag: String,
}

pub struct RouteMediaService {
    pictures: Arc<dyn RoutePictureStore>,
    routes: Arc<dyn RouteStore>,
    storage: Arc<dyn FileStorage>,
    /// CDN / public origin (e.g. `https://media.datxevui.com`). When
    /// `None`, URLs fall back to the backend proxy endpoint.
    public_base: Option<String>,
    /// Bucket name — part of path-style public URLs.
    bucket: String,
}

impl RouteMediaService {
    pub fn new(
        pictures: Arc<dyn RoutePictureStore>,
        routes: Arc<dyn RouteStore>,
        storage: Arc<dyn FileStorage>,
        public_base: Option<String>,
        bucket: String,
    ) -> Self {
        Self {
            pictures,
            routes,
            storage,
            // Normalize here as well as in config — the service may be
            // constructed directly (tests, future embedders) with an
            // untrimmed base and a double slash would poison every
            // emitted URL.
            public_base: public_base
                .map(|s| s.trim_end_matches('/').to_string())
                .filter(|s| !s.is_empty()),
            bucket,
        }
    }

    /// Public URL for a stored key, per the CDN/proxy resolution rule
    /// (see the module docs).
    fn public_url(&self, key: &str) -> String {
        match &self.public_base {
            Some(base) => format!("{base}/{}/{key}", self.bucket),
            None => format!("/api/media/{key}"),
        }
    }

    /// Write one media object with the immutable cache headers. Maps
    /// the storage backend's `anyhow` error into the app error type.
    async fn put_media(&self, key: &str, data: bytes::Bytes, ct: &str) -> AppResult<()> {
        let opts = PutOptions {
            content_type: Some(ct.to_string()),
            cache_control: Some(IMMUTABLE_CACHE_CONTROL.to_string()),
            ..Default::default()
        };
        self.storage
            .put(key, data, opts)
            .await
            .map(|_| ())
            .map_err(|e| AppError::Storage(format!("put {key}: {e}")))
    }

    fn to_out(&self, m: &route_picture::Model) -> RoutePictureOut {
        RoutePictureOut {
            id: m.id,
            route_id: m.route_id,
            sort_order: m.sort_order,
            url: self.public_url(&m.storage_key),
            thumb_url: self.public_url(&m.thumb_key),
            alt_text: m.alt_text.clone(),
            width: m.width,
            height: m.height,
            mime_type: m.mime_type.clone(),
            size_bytes: m.size_bytes,
            created_at: m.created_at.clone(),
        }
    }

    // ── Read ─────────────────────────────────────────────────────

    /// The ordered gallery of a route (public + admin).
    pub async fn list(&self, route_id: Uuid) -> AppResult<RoutePictureListResponse> {
        let items = self
            .pictures
            .list_by_route(route_id)
            .await?
            .iter()
            .map(|m| self.to_out(m))
            .collect();
        Ok(RoutePictureListResponse { route_id, items })
    }

    /// Serve a media object through the backend proxy (dev mode, or
    /// origin fallback). The handler is expected to have answered 304
    /// already when `If-None-Match` matches — this fetch always reads
    /// the object.
    pub async fn serve(&self, key: &str) -> AppResult<ServedMedia> {
        let parsed = parse_media_key(key).ok_or_else(|| AppError::NotFound(key.to_string()))?;
        let bytes = self.storage.get(key).await.map_err(|e| {
            // Storage miss on a well-formed key: 404, not 500 — the
            // client is probing a key that was deleted or never
            // existed (stale CDN entry pointing at a purged object).
            tracing::warn!(key, error = %e, "media object miss");
            AppError::NotFound(key.to_string())
        })?;
        Ok(ServedMedia {
            bytes,
            content_type: parsed.content_type(),
            etag: parsed.etag(),
        })
    }

    // ── Upload ───────────────────────────────────────────────────

    /// Validate + store + index one picture. Idempotent on content:
    /// re-uploading identical bytes for the same route returns the
    /// existing row with `deduped = true`.
    #[allow(clippy::too_many_arguments)]
    pub async fn upload(
        &self,
        route_id: Uuid,
        data: bytes::Bytes,
        alt_text: Option<String>,
    ) -> AppResult<RoutePictureUploadResponse> {
        // 1. Route must exist — an orphaned gallery is a UI bug magnet.
        let route = self
            .routes
            .find_route_by_id(route_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("route {route_id} not found")))?;
        let _ = route;

        // 2. Size cap.
        if data.len() > MAX_PICTURE_BYTES {
            return Err(AppError::Validation(format!(
                "picture is {} bytes; limit is {} bytes",
                data.len(),
                MAX_PICTURE_BYTES
            )));
        }

        // 3. Magic bytes — the client-sent Content-Type is advisory.
        let (ext, mime) = sniff_format(&data).ok_or_else(|| {
            AppError::Validation(
                "unsupported image format (magic bytes); accepted: JPEG, PNG, WebP".into(),
            )
        })?;

        // 4. Full decode + thumbnail (CPU-bound → blocking pool).
        //    `Bytes::clone` is a refcount bump — the original stays
        //    around for hashing + storage below.
        let decode_input = data.clone();
        let decoded = tokio::task::spawn_blocking(move || decode_and_thumbnail(&decode_input))
            .await
            .map_err(|e| AppError::Internal(format!("image worker join error: {e}")))?
            .map_err(|e| {
                AppError::Validation(format!(
                    "image failed to decode (corrupt or unsupported): {e}"
                ))
            })?;

        // 5. Content hash → dedupe.
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let hash = hex::encode(hasher.finalize());
        let hash16 = &hash[..16];

        if let Some(existing) = self
            .pictures
            .find_by_route_and_hash(route_id, &hash)
            .await?
        {
            let picture = self.to_out(&existing);
            return Ok(RoutePictureUploadResponse {
                ok: true,
                deduped: true,
                picture,
            });
        }

        // 6. Count cap.
        let count = self.pictures.count_by_route(route_id).await?;
        if count as usize >= MAX_PICTURES_PER_ROUTE {
            return Err(AppError::Validation(format!(
                "route already has {count} pictures (max {MAX_PICTURES_PER_ROUTE})"
            )));
        }

        // 7. Persist objects (immutable cache headers travel with the
        //    object metadata — the CDN reads them at the origin).
        let (key, thumb_key) = keys_for(route_id, hash16, ext);
        self.put_media(&key, data.clone(), mime).await?;
        self.put_media(&thumb_key, decoded.thumb_jpeg.clone().into(), "image/jpeg")
            .await?;

        // 8. Index row.
        let now = Utc::now().to_rfc3339();
        let sort_order = self.pictures.next_sort_order(route_id).await?;
        let model = route_picture::ActiveModel {
            id: Set(Uuid::new_v4()),
            route_id: Set(route_id),
            sort_order: Set(sort_order),
            storage_key: Set(key),
            thumb_key: Set(thumb_key),
            content_hash: Set(hash),
            mime_type: Set(mime.to_string()),
            size_bytes: Set(data.len() as i64),
            thumb_bytes: Set(decoded.thumb_jpeg.len() as i64),
            width: Set(decoded.width as i64),
            height: Set(decoded.height as i64),
            alt_text: Set(alt_text
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };
        let model = self.pictures.insert(model).await?;
        let picture = self.to_out(&model);
        Ok(RoutePictureUploadResponse {
            ok: true,
            deduped: false,
            picture,
        })
    }

    // ── Patch / reorder ──────────────────────────────────────────

    /// Patch one picture (`sort_order`, `alt_text`). `alt_text: None`
    /// (field omitted) keeps the stored value — clear it by sending
    /// an empty string (which normalizes to `None`).
    pub async fn patch(
        &self,
        route_id: Uuid,
        picture_id: Uuid,
        sort_order: Option<i64>,
        alt_text: Option<String>,
    ) -> AppResult<RoutePictureOut> {
        if let Some(so) = sort_order {
            if so < 0 {
                return Err(AppError::Validation("sort_order must be >= 0".into()));
            }
        }
        let existing = self
            .pictures
            .find_by_id_and_route(route_id, picture_id)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!("picture {picture_id} not on route {route_id}"))
            })?;

        // ── Reorder: list-INSERT semantics ──────────────────────────
        // `sort_order = S` moves this picture to display position S and
        // re-densifies positions 0..n-1 around it (others shift to
        // close the gap it left and make room). A plain `UPDATE
        // sort_order = S` would leave ties with whatever already sits
        // at S, and the (sort_order, created_at) tie-break would
        // quietly ignore the admin's intent. With ≤
        // MAX_PICTURES_PER_ROUTE rows this is at most a dozen tiny
        // UPDATEs, only for rows whose position actually changed.
        let mut target_pos: Option<i64> = None;
        if let Some(so) = sort_order {
            let mut ordered: Vec<route_picture::Model> = self
                .pictures
                .list_by_route(route_id)
                .await?
                .into_iter()
                .filter(|m| m.id != picture_id)
                .collect();
            let insert_at = (so as usize).min(ordered.len());
            ordered.insert(insert_at, existing.clone());

            let now = Utc::now().to_rfc3339();
            for (idx, m) in ordered.iter().enumerate() {
                if m.sort_order != idx as i64 {
                    let mut am = m.clone().into_active_model();
                    am.sort_order = Set(idx as i64);
                    am.updated_at = Set(now.clone());
                    self.pictures.update(am).await?;
                }
            }
            target_pos = Some(insert_at as i64);
        }

        let existing = self
            .pictures
            .find_by_id_and_route(route_id, picture_id)
            .await?
            .expect("row exists (verified above, reorder only moved it)");

        let mut am = existing.into_active_model();
        if let Some(pos) = target_pos {
            am.sort_order = Set(pos);
        }
        if let Some(at) = alt_text {
            am.alt_text = Set((!at.trim().is_empty()).then(|| at.trim().to_string()));
        }
        am.updated_at = Set(Utc::now().to_rfc3339());
        let updated = self.pictures.update(am).await?;
        Ok(self.to_out(&updated))
    }

    // ── Delete ───────────────────────────────────────────────────

    /// Delete one picture: row first (it indexes the objects), then
    /// the two backing objects best-effort.
    pub async fn delete(
        &self,
        route_id: Uuid,
        picture_id: Uuid,
    ) -> AppResult<RoutePictureDeleteResponse> {
        let deleted = self.pictures.delete(route_id, picture_id).await?;
        let Some(m) = deleted else {
            return Err(AppError::NotFound(format!(
                "picture {picture_id} not on route {route_id}"
            )));
        };
        for key in [&m.storage_key, &m.thumb_key] {
            if let Err(e) = self.storage.delete(key).await {
                // An orphaned object is inert storage — log and move
                // on; the row (the image's source of truth) is gone.
                tracing::warn!(key, error = %e, "route-picture object GC failed");
            }
        }
        Ok(RoutePictureDeleteResponse {
            ok: true,
            id: picture_id,
        })
    }

    /// Delete every picture of a route (used by the route-delete
    /// handler BEFORE dropping the route — the FK cascade would
    /// otherwise remove the rows and orphan the objects with no way
    /// to find them again).
    pub async fn purge_route(&self, route_id: Uuid) -> AppResult<u64> {
        let rows = self.pictures.delete_all_by_route(route_id).await?;
        for m in &rows {
            for key in [&m.storage_key, &m.thumb_key] {
                if let Err(e) = self.storage.delete(key).await {
                    tracing::warn!(key, error = %e, "route-picture object GC failed");
                }
            }
        }
        Ok(rows.len() as u64)
    }

    /// Bulk-delete endpoint form (admin "clear gallery").
    pub async fn delete_all(&self, route_id: Uuid) -> AppResult<RoutePicturesBulkDeleteResponse> {
        let deleted = self.purge_route(route_id).await?;
        Ok(RoutePicturesBulkDeleteResponse { ok: true, deleted })
    }

    /// Cover thumbnails for a batch of route ids (public list pages).
    /// Keyed by route id; only routes WITH pictures appear.
    pub async fn covers_for(
        &self,
        route_ids: &[Uuid],
    ) -> AppResult<std::collections::HashMap<Uuid, RoutePictureOut>> {
        let covers = self.pictures.covers_by_routes(route_ids).await?;
        Ok(covers
            .iter()
            .map(|m| (m.route_id, self.to_out(m)))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(hash16: &str, ext: &str) -> String {
        format!("routes/00000000-0000-0000-0000-000000000000/{hash16}.{ext}")
    }

    #[test]
    fn sniffing_rejects_non_images() {
        assert!(sniff_format(b"<html><body>").is_none());
        assert!(sniff_format(b"").is_none());
        assert_eq!(
            sniff_format(b"\xFF\xD8\xFF\xE0"),
            Some(("jpg", "image/jpeg"))
        );
        assert_eq!(
            sniff_format(b"\x89PNG\r\n\x1A\n-rest"),
            Some(("png", "image/png"))
        );
        let mut webp = vec![0; 12];
        webp[0..4].copy_from_slice(b"RIFF");
        webp[8..12].copy_from_slice(b"WEBP");
        assert_eq!(sniff_format(&webp), Some(("webp", "image/webp")));
    }

    #[test]
    fn media_key_parse_accepts_generated_shapes() {
        let p = parse_media_key(&key("0123456789abcdef", "webp")).unwrap();
        assert_eq!(p.hash16, "0123456789abcdef");
        assert!(!p.thumb);
        assert_eq!(p.content_type(), "image/webp");
        assert_eq!(p.etag(), "\"0123456789abcdef\"");

        let t =
            parse_media_key("routes/00000000-0000-0000-0000-000000000000/t0123456789abcdef.jpg")
                .unwrap();
        assert!(t.thumb);
        assert_eq!(t.content_type(), "image/jpeg");
    }

    #[test]
    fn media_key_parse_rejects_hostile_shapes() {
        // Path traversal — multiple shapes.
        assert!(parse_media_key("routes/../../etc/passwd").is_none());
        assert!(
            parse_media_key("routes/00000000-0000-0000-0000-000000000000/../../../etc/passwd")
                .is_none()
        );
        // Non-hex hash, wrong length, unknown prefix dir.
        assert!(parse_media_key(&key("zzzzzzzzzzzzzzzz", "jpg")).is_none());
        assert!(parse_media_key(&key("0123456789abc", "jpg")).is_none());
        assert!(
            parse_media_key("other/00000000-0000-0000-0000-000000000000/0123456789abcdef.jpg")
                .is_none()
        );
        // Thumb must be jpg; full can't be t-prefixed free-form.
        assert!(parse_media_key(
            "routes/00000000-0000-0000-0000-000000000000/t0123456789abcdef.png"
        )
        .is_none());
        // Four components.
        assert!(parse_media_key(
            "routes/00000000-0000-0000-0000-000000000000/0123456789abcdef.jpg/extra"
        )
        .is_none());
    }

    #[test]
    fn keys_for_builds_content_addressed_pair() {
        let (full, thumb) = keys_for(
            Uuid::parse_str("00000000-0000-0000-0000-000000000000").unwrap(),
            "0123456789abcdef",
            "jpg",
        );
        assert_eq!(
            full,
            "routes/00000000-0000-0000-0000-000000000000/0123456789abcdef.jpg"
        );
        assert_eq!(
            thumb,
            "routes/00000000-0000-0000-0000-000000000000/t0123456789abcdef.jpg"
        );
        // Both must survive the strict parser.
        assert!(parse_media_key(&full).is_some());
        assert!(parse_media_key(&thumb).is_some());
    }
}

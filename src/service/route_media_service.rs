//! Route media service — picture gallery per bus route and brand logos,
//! backed by the pluggable [`FileStorage`] backends (local dev / RustFS /
//! S3).
//!
//! ## Pipeline (admin upload)
//!
//! ```text
//! multipart file ─→ size cap ─→ magic-byte sniff ─→ full decode
//!   (spawn_blocking: rejects polyglot/corrupt files, applies the EXIF
//!    orientation, then drops all metadata)
//! ─→ lossy WebP: 1920 px original + 640 px thumbnail
//! ─→ sha-256 content hash of the stored bytes ─→ dedupe probe
//! ─→ picture-count cap ─→ PUT original + PUT thumb (immutable cache headers)
//! ─→ INSERT route_picture row
//! ```
//!
//! The uploaded original is never stored: only the re-encoded WebP is.
//!
//! ## Content-addressed immutability
//!
//! Keys embed a 16-hex prefix of the sha-256 of the stored bytes:
//! `routes/{route_id}/{hash16}.webp` (+ `routes/{route_id}/t{hash16}.webp`
//! for the thumbnail), and `brands/logos/{hash16}.{webp|svg}` for brand
//! logos. The bytes behind a key can therefore NEVER change, which is
//! what justifies the aggressive
//! `Cache-Control: public, max-age=31536000, immutable` on every read
//! path: browsers and the CDN hold the object forever and a "new
//! picture" is simply a new key. No cache purge machinery anywhere.
//!
//! Objects written before WebP (jpg/png originals, jpg thumbnails)
//! still parse and are served.
//!
//! ## URL resolution (CDN vs proxy)
//!
//! * `STORAGE_PUBLIC_BASE_URL` set (production) → the API emits
//!   absolute picture URLs against that origin (`https://media.datxevui.com/
//!   {bucket}/routes/…`) and image bytes NEVER flow through the
//!   backend.
//! * unset (dev / local storage) → URLs point at the backend's own
//!   `GET /api/media/{key}` proxy, which re-serializes the same
//!   immutable cache headers and answers `If-None-Match` with 304.
//!
//! Brand logo URLs are always the proxy path `/api/media/{key}`: the
//! brand row stores the URL, so it must not depend on the deployment.
//!
//! ## Garbage collection
//!
//! DB rows are the only index of which objects exist. Every delete
//! path removes the row AND the two backing objects (best-effort on
//! the object side — an orphaned object is inert storage, an orphaned
//! row is a broken image). Brand logos are not indexed and not
//! collected.

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
use crate::media::encode::{self, EncodeError, Encoded, Format};
use crate::media::svg;
use crate::storage::{FileStorage, PutOptions};
use crate::store::{RoutePictureStore, RouteStore};

/// Hard cap on pictures per route ("a few pictures" — gallery, not a
/// photo dump). Enforced before any storage write.
pub const MAX_PICTURES_PER_ROUTE: usize = 10;

/// Per-file byte cap. Generous for phone photos (typical 3-8 MB),
/// small enough to keep multipart bodies bounded.
pub const MAX_PICTURE_BYTES: usize = 10 * 1024 * 1024;

/// Per-file byte cap for a brand logo upload (a stored logo is a few
/// KiB).
pub const MAX_LOGO_BYTES: usize = 5 * 1024 * 1024;

/// Long edge of the stored picture: sharp on a full-HD gallery, a
/// fraction of a phone photo's bytes.
const FULL_LONG_EDGE: u32 = 1920;
const FULL_QUALITY: f32 = 80.0;

/// Long edge of the thumbnail used in lists and grids.
const THUMB_LONG_EDGE: u32 = 640;
const THUMB_QUALITY: f32 = 75.0;

/// Long edge of a stored logo: sharp at 2x on the largest place a logo
/// is shown.
const LOGO_LONG_EDGE: u32 = 512;
const LOGO_QUALITY: f32 = 85.0;

/// `Cache-Control` for every media read. Valid because keys are
/// content-addressed: the object behind a key never changes.
pub const IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// The original and the thumbnail of one uploaded picture.
struct EncodedPicture {
    full: Encoded,
    thumb: Encoded,
}

/// CPU-bound image work: full decode (validity) and both WebP
/// encodings. Runs inside `spawn_blocking`.
fn encode_picture(data: &[u8]) -> Result<EncodedPicture, EncodeError> {
    let img = encode::decode(data)?;
    Ok(EncodedPicture {
        full: encode::to_webp(&img, FULL_LONG_EDGE, FULL_QUALITY)?,
        thumb: encode::to_webp(&img, THUMB_LONG_EDGE, THUMB_QUALITY)?,
    })
}

/// CPU-bound: decode + WebP encode of a brand logo.
fn encode_logo(data: &[u8]) -> Result<Encoded, EncodeError> {
    encode::to_webp(&encode::decode(data)?, LOGO_LONG_EDGE, LOGO_QUALITY)
}

/// Run an image job on the blocking pool; a decode failure is the
/// client's (400), an encoder failure ours (500).
async fn run_blocking<T, F>(job: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, EncodeError> + Send + 'static,
{
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|e| AppError::Internal(format!("image worker join error: {e}")))?
        .map_err(|e| match e {
            EncodeError::Undecodable(msg) => AppError::Validation(msg),
            EncodeError::Encoding(_) => AppError::Internal(e.to_string()),
        })
}

// ────────────────────────────────────────────────────────────────
//  Key handling — the ONLY shapes the serve endpoint will proxy
// ────────────────────────────────────────────────────────────────

/// What a media key belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaScope {
    /// A picture (or its thumbnail) of this route.
    Route(Uuid),
    /// A brand logo.
    BrandLogo,
}

/// A validated media key, split into its parts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedMediaKey {
    pub scope: MediaScope,
    /// 16 lowercase hex chars — sha-256 prefix of the content.
    pub hash16: String,
    /// `true` for the thumbnail variant (route pictures only).
    pub thumb: bool,
    /// Extension: `webp` for everything uploaded now, plus the `jpg` /
    /// `png` of objects written before WebP and `svg` for logos.
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
        match self.ext.as_str() {
            "webp" => "image/webp",
            "png" => "image/png",
            "svg" => "image/svg+xml",
            _ => "image/jpeg",
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
///   * `routes/{uuid}/{16hex}.{webp|jpg|png}`
///   * `routes/{uuid}/t{16hex}.{webp|jpg}`   (thumbnail)
///   * `brands/logos/{16hex}.{webp|svg|jpg|png}`
pub fn parse_media_key(key: &str) -> Option<ParsedMediaKey> {
    let mut parts = key.split('/');
    let first = parts.next()?;
    let (scope, filename) = match first {
        "routes" => {
            let route_id = parts.next()?;
            let filename = parts.next()?;
            if !route_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
                return None;
            }
            (MediaScope::Route(Uuid::parse_str(route_id).ok()?), filename)
        }
        "brands" => {
            if parts.next()? != "logos" {
                return None;
            }
            (MediaScope::BrandLogo, parts.next()?)
        }
        _ => return None,
    };
    if parts.next().is_some() {
        return None; // no further components
    }

    let (name, ext) = filename.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    let thumb = matches!(scope, MediaScope::Route(_)) && name.starts_with('t');
    let hash = if thumb { &name[1..] } else { name };
    if hash.len() != 16 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let allowed: &[&str] = match (scope, thumb) {
        (MediaScope::Route(_), true) => &["webp", "jpg"],
        (MediaScope::Route(_), false) => &["webp", "jpg", "png"],
        (MediaScope::BrandLogo, _) => &["webp", "svg", "jpg", "png"],
    };
    if !allowed.contains(&ext.as_str()) {
        return None;
    }
    Some(ParsedMediaKey {
        scope,
        hash16: hash.to_ascii_lowercase(),
        thumb,
        ext,
    })
}

/// Build the canonical key pair for a picture.
fn keys_for(route_id: Uuid, hash16: &str) -> (String, String) {
    let base = format!("routes/{route_id}");
    (
        format!("{base}/{hash16}.webp"),
        format!("{base}/t{hash16}.webp"),
    )
}

/// First 16 hex chars of the sha-256 of `bytes` (the key's hash part).
fn sha16(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))[..16].to_string()
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

    /// Validate + re-encode + store + index one picture. Idempotent on
    /// content: re-uploading an image that encodes to the same WebP for
    /// the same route returns the existing row with `deduped = true`.
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
        if Format::sniff(&data).is_none() {
            return Err(AppError::Validation(
                "unsupported image format (magic bytes); accepted: JPEG, PNG, WebP".into(),
            ));
        }

        // 4. Full decode + WebP re-encode (CPU-bound → blocking pool).
        //    This is the security gate: a crafted polyglot or truncated
        //    file fails HERE, before any storage write.
        let EncodedPicture { full, thumb } = run_blocking(move || encode_picture(&data)).await?;

        // 5. Content hash of the STORED bytes → dedupe.
        let hash = hex::encode(Sha256::digest(&full.bytes));
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
        let (key, thumb_key) = keys_for(route_id, hash16);
        let (full_len, thumb_len) = (full.bytes.len() as i64, thumb.bytes.len() as i64);
        self.put_media(&key, full.bytes.into(), "image/webp")
            .await?;
        self.put_media(&thumb_key, thumb.bytes.into(), "image/webp")
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
            mime_type: Set("image/webp".to_string()),
            size_bytes: Set(full_len),
            thumb_bytes: Set(thumb_len),
            width: Set(full.width as i64),
            height: Set(full.height as i64),
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

    /// Validate and store one brand logo; returns its storage key
    /// (`brands/logos/{hash16}.{webp|svg}`).
    ///
    /// A raster logo (JPEG / PNG / WebP) is decoded, scaled to 512 px
    /// and stored as WebP — never as uploaded, so no EXIF. An SVG is
    /// stored as it is once it passes the safety check. Anything else
    /// (including a corrupt raster) is a validation error. Storing the
    /// key on the brand row is the admin brand update's job.
    pub async fn upload_brand_logo(&self, data: bytes::Bytes) -> AppResult<String> {
        if data.len() > MAX_LOGO_BYTES {
            return Err(AppError::Validation(format!(
                "logo is {} bytes; limit is {} bytes",
                data.len(),
                MAX_LOGO_BYTES
            )));
        }
        let (bytes, ext, content_type) = if Format::sniff(&data).is_some() {
            let webp = run_blocking(move || encode_logo(&data)).await?;
            (bytes::Bytes::from(webp.bytes), "webp", "image/webp")
        } else {
            svg::check(&data).map_err(|why| {
                AppError::Validation(format!(
                    "unsupported logo ({why}); accepted: JPEG, PNG, WebP, SVG"
                ))
            })?;
            (data, "svg", "image/svg+xml")
        };
        let key = format!("brands/logos/{}.{ext}", sha16(&bytes));
        self.put_media(&key, bytes, content_type).await?;
        Ok(key)
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

    const ROUTE: &str = "00000000-0000-0000-0000-000000000000";

    fn key(hash16: &str, ext: &str) -> String {
        format!("routes/{ROUTE}/{hash16}.{ext}")
    }

    #[test]
    fn media_key_parse_accepts_generated_shapes() {
        let p = parse_media_key(&key("0123456789abcdef", "webp")).unwrap();
        assert_eq!(p.hash16, "0123456789abcdef");
        assert!(!p.thumb);
        assert_eq!(p.scope, MediaScope::Route(Uuid::nil()));
        assert_eq!(p.content_type(), "image/webp");
        assert_eq!(p.etag(), "\"0123456789abcdef\"");

        let t = parse_media_key(&format!("routes/{ROUTE}/t0123456789abcdef.webp")).unwrap();
        assert!(t.thumb);
        assert_eq!(t.content_type(), "image/webp");

        let logo = parse_media_key("brands/logos/0123456789abcdef.svg").unwrap();
        assert_eq!(logo.scope, MediaScope::BrandLogo);
        assert!(!logo.thumb);
        assert_eq!(logo.content_type(), "image/svg+xml");
        assert_eq!(
            parse_media_key("brands/logos/0123456789abcdef.webp")
                .unwrap()
                .content_type(),
            "image/webp"
        );
    }

    #[test]
    fn media_key_parse_keeps_serving_pre_webp_objects() {
        for (name, content_type) in [
            (key("0123456789abcdef", "jpg"), "image/jpeg"),
            (key("0123456789abcdef", "png"), "image/png"),
            (
                format!("routes/{ROUTE}/t0123456789abcdef.jpg"),
                "image/jpeg",
            ),
            ("brands/logos/0123456789abcdef.png".to_string(), "image/png"),
        ] {
            let parsed = parse_media_key(&name).unwrap_or_else(|| panic!("rejected {name}"));
            assert_eq!(parsed.content_type(), content_type, "{name}");
        }
    }

    #[test]
    fn media_key_parse_rejects_hostile_shapes() {
        // Path traversal — multiple shapes.
        assert!(parse_media_key("routes/../../etc/passwd").is_none());
        assert!(parse_media_key(&format!("routes/{ROUTE}/../../../etc/passwd")).is_none());
        assert!(parse_media_key("brands/logos/../../../etc/passwd").is_none());
        assert!(parse_media_key("brands/../0123456789abcdef.webp").is_none());
        // Non-hex hash, wrong length, unknown prefix dir.
        assert!(parse_media_key(&key("zzzzzzzzzzzzzzzz", "webp")).is_none());
        assert!(parse_media_key(&key("0123456789abc", "webp")).is_none());
        assert!(parse_media_key(&format!("other/{ROUTE}/0123456789abcdef.webp")).is_none());
        assert!(parse_media_key("brands/other/0123456789abcdef.webp").is_none());
        assert!(parse_media_key("brands/logos/t0123456789abcdef.webp").is_none());
        // Extensions: a thumbnail is never png, a picture never svg.
        assert!(parse_media_key(&format!("routes/{ROUTE}/t0123456789abcdef.png")).is_none());
        assert!(parse_media_key(&key("0123456789abcdef", "svg")).is_none());
        assert!(parse_media_key("brands/logos/0123456789abcdef.gif").is_none());
        // Extra components.
        assert!(parse_media_key(&format!("routes/{ROUTE}/0123456789abcdef.webp/extra")).is_none());
        assert!(parse_media_key("brands/logos/0123456789abcdef.webp/extra").is_none());
    }

    #[test]
    fn keys_for_builds_content_addressed_pair() {
        let (full, thumb) = keys_for(Uuid::nil(), "0123456789abcdef");
        assert_eq!(full, format!("routes/{ROUTE}/0123456789abcdef.webp"));
        assert_eq!(thumb, format!("routes/{ROUTE}/t0123456789abcdef.webp"));
        // Both must survive the strict parser.
        assert!(parse_media_key(&full).is_some());
        assert!(parse_media_key(&thumb).is_some());
    }

    #[test]
    fn sha16_is_the_sha256_prefix() {
        // sha-256("abc") = ba7816bf8f01cfea…
        assert_eq!(sha16(b"abc"), "ba7816bf8f01cfea");
    }
}

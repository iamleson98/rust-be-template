/**
 * Route picture gallery — port of `route_media_service.rs`: content-addressed
 * objects in R2 (`routes/{routeId}/{hash16}.{ext}`, thumbnail
 * `routes/{routeId}/t{hash16}.jpg`), an index row per picture, and a strict
 * key grammar for the public `/api/media/{key}` proxy.
 *
 * DELIBERATE differences (Workers have no image codec):
 *  - The thumbnail comes from the Cloudflare Images binding (`IMAGES`):
 *    640 px long edge, JPEG q82, EXIF dropped by the re-encode. Without the
 *    binding the picture has no thumbnail and `thumbUrl` is the original.
 *  - Rust decodes the whole file before storing anything, which rejects
 *    truncated files and polyglots. Here the Images binding's `info()` is
 *    that gate; without it only the header (magic bytes and dimensions) is
 *    checked.
 */
import { and, asc, count, eq, max } from "drizzle-orm";
import { getDb, getEnv, getR2 } from "@/lib/db/client";
import { routePictures, routes } from "@/lib/db/schema";
import { badRequest, notFound } from "@/lib/services/http-errors";

type PictureRow = typeof routePictures.$inferSelect;

export const MAX_PICTURES_PER_ROUTE = 12;
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const THUMB_LONG_EDGE = 640;
const THUMB_JPEG_QUALITY = 82;

// ── Format sniffing (magic bytes: the client's MIME is advisory) ─

export interface SniffedFormat {
  ext: "jpg" | "png" | "webp";
  mime: "image/jpeg" | "image/png" | "image/webp";
}

const startsWith = (b: Uint8Array, sig: number[]): boolean => sig.every((v, i) => b[i] === v);

export function sniffFormat(b: Uint8Array): SniffedFormat | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { ext: "png", mime: "image/png" };
  if (
    b.length >= 12 &&
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50])
  )
    return { ext: "webp", mime: "image/webp" };
  return null;
}

// ── Dimensions (header parsing, for when no Images binding decodes) ─

/** Width and height read from the file header, or null when it is truncated or malformed. */
export function readDimensions(
  b: Uint8Array,
  ext: SniffedFormat["ext"],
): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dims = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;
  if (ext === "png") return b.length >= 24 ? dims(v.getUint32(16), v.getUint32(20)) : null;
  if (ext === "webp") {
    const tag = String.fromCharCode(...b.subarray(12, 16));
    if (tag === "VP8X" && b.length >= 30)
      return dims(
        1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
        1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
      );
    if (tag === "VP8L" && b.length >= 25) {
      const bits = v.getUint32(21, true);
      return dims((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (tag === "VP8 " && b.length >= 30)
      return dims(v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff);
    return null;
  }
  // JPEG: walk the segments to a start-of-frame marker.
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return dims(v.getUint16(i + 7), v.getUint16(i + 5));
    i += 2 + v.getUint16(i + 2);
  }
  return null;
}

// ── Keys ────────────────────────────────────────────────────────

export interface ParsedMediaKey {
  routeId: string;
  hash16: string;
  thumb: boolean;
  ext: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only shapes the media proxy serves; anything else is a 404 without touching storage. */
export function parseMediaKey(key: string): ParsedMediaKey | null {
  const parts = key.split("/");
  if (parts.length !== 3 || parts[0] !== "routes") return null;
  const [, routeId, filename] = parts as [string, string, string];
  if (!UUID_RE.test(routeId)) return null;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const name = filename.slice(0, dot);
  const ext = filename.slice(dot + 1).toLowerCase();
  const thumb = name.startsWith("t");
  const hash = thumb ? name.slice(1) : name;
  if (!/^[0-9a-f]{16}$/i.test(hash)) return null;
  if (thumb ? ext !== "jpg" : !["jpg", "png", "webp"].includes(ext)) return null;
  return { routeId, hash16: hash.toLowerCase(), thumb, ext };
}

export const etagOf = (k: ParsedMediaKey): string => `"${k.hash16}"`;

export function contentTypeOf(k: ParsedMediaKey): string {
  if (k.thumb) return "image/jpeg"; // thumbnails are always re-encoded JPEG
  return k.ext === "png" ? "image/png" : k.ext === "webp" ? "image/webp" : "image/jpeg";
}

export function keysFor(
  routeId: string,
  hash16: string,
  ext: string,
): { key: string; thumbKey: string } {
  const base = `routes/${routeId}`;
  return { key: `${base}/${hash16}.${ext}`, thumbKey: `${base}/t${hash16}.jpg` };
}

// ── DTO ─────────────────────────────────────────────────────────

const publicUrl = (key: string): string => `/api/media/${key}`;

export function pictureOut(p: PictureRow) {
  return {
    id: p.id,
    routeId: p.routeId,
    sortOrder: p.sortOrder,
    url: publicUrl(p.storageKey),
    thumbUrl: publicUrl(p.thumbKey ?? p.storageKey),
    ...(p.altText && { altText: p.altText }),
    width: p.width ?? 0,
    height: p.height ?? 0,
    mimeType: p.mimeType,
    sizeBytes: p.sizeBytes,
    createdAt: p.createdAt,
  };
}

async function picturesOf(routeId: string): Promise<PictureRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(routePictures)
    .where(eq(routePictures.routeId, routeId))
    .orderBy(asc(routePictures.sortOrder), asc(routePictures.createdAt));
}

async function findPicture(routeId: string, pictureId: string): Promise<PictureRow> {
  const db = await getDb();
  const row = (
    await db
      .select()
      .from(routePictures)
      .where(and(eq(routePictures.routeId, routeId), eq(routePictures.id, pictureId)))
      .limit(1)
  )[0];
  if (!row) throw notFound(`picture ${pictureId} not on route ${routeId}`);
  return row;
}

/** `GET …/pictures`: a route without pictures and a route that does not exist look the same. */
export async function listPictures(routeId: string) {
  return { routeId, items: (await picturesOf(routeId)).map(pictureOut) };
}

// ── Upload ──────────────────────────────────────────────────────

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** Re-encode to a 640 px JPEG with the Images binding; null when it is not bound. */
async function makeThumbnail(
  env: CloudflareEnv,
  data: Uint8Array,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (!env.IMAGES) return null;
  const stream = () => new Blob([data as BlobPart]).stream();
  let info;
  try {
    info = await env.IMAGES.info(stream());
  } catch (e) {
    throw badRequest(`image failed to decode (corrupt or unsupported): ${String(e)}`);
  }
  if (!("width" in info))
    throw badRequest("image failed to decode (corrupt or unsupported): not a raster image");
  const out = await env.IMAGES.input(stream())
    .transform({ width: THUMB_LONG_EDGE, height: THUMB_LONG_EDGE, fit: "scale-down" })
    .output({ format: "image/jpeg", quality: THUMB_JPEG_QUALITY });
  return {
    bytes: new Uint8Array(await out.response().arrayBuffer()),
    width: info.width,
    height: info.height,
  };
}

export interface UploadResult {
  ok: true;
  deduped: boolean;
  picture: ReturnType<typeof pictureOut>;
}

/** Rust `upload`: validate, dedupe on content, cap at 12 per route, store both objects, index. */
export async function uploadPicture(
  routeId: string,
  data: Uint8Array,
  altText: string | null,
): Promise<UploadResult> {
  const db = await getDb();
  const route = (
    await db.select({ id: routes.id }).from(routes).where(eq(routes.id, routeId)).limit(1)
  )[0];
  if (!route) throw notFound(`route ${routeId} not found`);
  if (data.length > MAX_PICTURE_BYTES)
    throw badRequest(`picture is ${data.length} bytes; limit is ${MAX_PICTURE_BYTES} bytes`);
  const format = sniffFormat(data);
  if (!format)
    throw badRequest("unsupported image format (magic bytes); accepted: JPEG, PNG, WebP");

  const env = await getEnv();
  const thumb = await makeThumbnail(env, data);
  const size = thumb ?? readDimensions(data, format.ext);
  if (!size) throw badRequest("image failed to decode (corrupt or unsupported): unreadable header");

  const hash = hex(await crypto.subtle.digest("SHA-256", data as BufferSource));
  const existing = (
    await db
      .select()
      .from(routePictures)
      .where(and(eq(routePictures.routeId, routeId), eq(routePictures.contentHash, hash)))
      .limit(1)
  )[0];
  if (existing) return { ok: true, deduped: true, picture: pictureOut(existing) };

  const total =
    (
      await db.select({ n: count() }).from(routePictures).where(eq(routePictures.routeId, routeId))
    )[0]?.n ?? 0;
  if (total >= MAX_PICTURES_PER_ROUTE)
    throw badRequest(`route already has ${total} pictures (max ${MAX_PICTURES_PER_ROUTE})`);

  const { key, thumbKey } = keysFor(routeId, hash.slice(0, 16), format.ext);
  const bucket = await getR2();
  const put = (k: string, bytes: Uint8Array, contentType: string) =>
    bucket.put(k, bytes as BufferSource, {
      httpMetadata: { contentType, cacheControl: IMMUTABLE_CACHE_CONTROL },
    });
  await put(key, data, format.mime);
  if (thumb) await put(thumbKey, thumb.bytes, "image/jpeg");

  const next = (
    await db
      .select({ top: max(routePictures.sortOrder) })
      .from(routePictures)
      .where(eq(routePictures.routeId, routeId))
  )[0]?.top;
  const row: PictureRow = {
    id: crypto.randomUUID(),
    routeId,
    sortOrder: next === null || next === undefined ? 0 : next + 1,
    storageKey: key,
    thumbKey: thumb ? thumbKey : null,
    contentHash: hash,
    mimeType: format.mime,
    sizeBytes: data.length,
    thumbBytes: thumb ? thumb.bytes.length : null,
    width: size.width,
    height: size.height,
    altText: altText?.trim() || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.insert(routePictures).values(row);
  return { ok: true, deduped: false, picture: pictureOut(row) };
}

// ── Patch / reorder ─────────────────────────────────────────────

export interface PatchPictureBody {
  sortOrder?: number | null;
  altText?: string | null;
}

/** `UpdateRoutePictureInput`'s rules. */
export function validatePatchPicture(b: PatchPictureBody): void {
  if (typeof b !== "object" || b === null) throw badRequest("invalid request body");
  if (b.sortOrder != null && (!Number.isInteger(b.sortOrder) || b.sortOrder < 0))
    throw badRequest("sort_order must be >= 0");
  if (b.altText != null && (typeof b.altText !== "string" || [...b.altText].length > 255))
    throw badRequest("alt text has an invalid length");
}

/**
 * Rust `patch`: `sortOrder = S` moves the picture to display position S and
 * re-densifies 0..n-1 around it (list-insert semantics, not a plain UPDATE
 * that would tie with whatever sits at S). An alt text of blanks clears it.
 */
export async function patchPicture(routeId: string, pictureId: string, body: PatchPictureBody) {
  const existing = await findPicture(routeId, pictureId);
  const db = await getDb();
  const now = new Date().toISOString();
  let position = existing.sortOrder;
  if (body.sortOrder != null) {
    const ordered = (await picturesOf(routeId)).filter((p) => p.id !== pictureId);
    const at = Math.min(body.sortOrder, ordered.length);
    ordered.splice(at, 0, existing);
    for (const [idx, p] of ordered.entries()) {
      if (p.id !== pictureId && p.sortOrder !== idx)
        await db
          .update(routePictures)
          .set({ sortOrder: idx, updatedAt: now })
          .where(eq(routePictures.id, p.id));
    }
    position = at;
  }
  await db
    .update(routePictures)
    .set({
      sortOrder: position,
      ...(body.altText != null && { altText: body.altText.trim() || null }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(routePictures.id, pictureId));
  return pictureOut(await findPicture(routeId, pictureId));
}

// ── Delete ──────────────────────────────────────────────────────

/** Remove the objects of deleted rows; an orphaned object is inert storage, so failures only log. */
async function collectGarbage(rows: PictureRow[]): Promise<void> {
  const bucket = await getR2();
  const keys = rows.flatMap((r) => (r.thumbKey ? [r.storageKey, r.thumbKey] : [r.storageKey]));
  await bucket
    .delete(keys)
    .catch((e: unknown) => console.warn("route-picture object GC failed", e));
}

export async function deletePicture(routeId: string, pictureId: string) {
  const row = await findPicture(routeId, pictureId);
  const db = await getDb();
  await db.delete(routePictures).where(eq(routePictures.id, pictureId));
  await collectGarbage([row]);
  return { ok: true, id: pictureId };
}

/** Rust `purge_route`: how many pictures a route had, all gone. */
export async function purgeRoute(routeId: string): Promise<number> {
  const rows = await picturesOf(routeId);
  if (rows.length === 0) return 0;
  const db = await getDb();
  await db.delete(routePictures).where(eq(routePictures.routeId, routeId));
  await collectGarbage(rows);
  return rows.length;
}

export async function deleteAllPictures(routeId: string) {
  return { ok: true, deleted: await purgeRoute(routeId) };
}

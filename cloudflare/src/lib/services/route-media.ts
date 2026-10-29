/**
 * Route picture gallery — port of `route_media_service.rs`: content-addressed
 * objects in R2 (`routes/{routeId}/{hash16}.webp`, thumbnail
 * `routes/{routeId}/t{hash16}.webp`), an index row per picture, and a strict
 * key grammar for the public `/api/media/{key}` proxy.
 *
 * DELIBERATE differences (Workers have no image codec):
 *  - Every upload is re-encoded to WebP by the Cloudflare Images binding
 *    (`IMAGES`) before anything is written: the picture is scaled down to
 *    {@link FULL_LONG_EDGE} px and compressed, a {@link THUMB_LONG_EDGE} px
 *    thumbnail is made the same way, and EXIF (GPS included) is dropped by
 *    the re-encode. The original bytes are never stored. Without the binding
 *    an upload is refused rather than stored uncompressed.
 *  - Rust decodes the whole file before storing anything, which rejects
 *    truncated files and polyglots. Here the Images binding's `info()` is
 *    that gate.
 *  - Keys are addressed by the hash of the stored (re-encoded) bytes, so the
 *    object stays immutable for its key.
 *  - Objects written before WebP (jpg/png originals, jpg thumbnails) still
 *    parse and are served.
 */
import { and, asc, count, eq, max } from "drizzle-orm";
import { getDb, getEnv, getR2 } from "@/lib/db/client";
import { routePictures, routes } from "@/lib/db/schema";
import { ApiError } from "@/lib/auth/rbac";
import { badRequest, notFound } from "@/lib/services/http-errors";

type PictureRow = typeof routePictures.$inferSelect;

export const MAX_PICTURES_PER_ROUTE = 10;
export const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Long edge of the stored picture: sharp on a full-HD gallery, a fraction of a phone photo's bytes. */
export const FULL_LONG_EDGE = 1920;
const FULL_QUALITY = 80;
export const THUMB_LONG_EDGE = 640;
const THUMB_QUALITY = 75;

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
  if (thumb ? !["jpg", "webp"].includes(ext) : !["jpg", "png", "webp"].includes(ext)) return null;
  return { routeId, hash16: hash.toLowerCase(), thumb, ext };
}

export const etagOf = (k: ParsedMediaKey): string => `"${k.hash16}"`;

export function contentTypeOf(k: ParsedMediaKey): string {
  if (k.thumb) return k.ext === "webp" ? "image/webp" : "image/jpeg";
  return k.ext === "png" ? "image/png" : k.ext === "webp" ? "image/webp" : "image/jpeg";
}

export function keysFor(routeId: string, hash16: string): { key: string; thumbKey: string } {
  const base = `routes/${routeId}`;
  return { key: `${base}/${hash16}.webp`, thumbKey: `${base}/t${hash16}.webp` };
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

interface Encoded {
  bytes: Uint8Array;
  width: number;
  height: number;
}

const unavailable = () =>
  new ApiError(503, "unavailable", "image processing is not available; try again later");

/** The Images binding's verdict on `data`: dimensions of a decodable raster, else a 400. */
async function decode(images: ImagesBinding, data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream();
  let info;
  try {
    info = await images.info(stream);
  } catch (e) {
    throw badRequest(`image failed to decode (corrupt or unsupported): ${String(e)}`);
  }
  if (!("width" in info))
    throw badRequest("image failed to decode (corrupt or unsupported): not a raster image");
  return { width: info.width, height: info.height };
}

/** `data` scaled down to fit `longEdge` px (never enlarged) and re-encoded as WebP. */
async function toWebp(
  images: ImagesBinding,
  data: Uint8Array,
  longEdge: number,
  quality: number,
): Promise<Encoded> {
  const out = await images
    .input(new Blob([data as BlobPart]).stream())
    .transform({ width: longEdge, height: longEdge, fit: "scale-down" })
    .output({ format: "image/webp", quality });
  const bytes = new Uint8Array(await out.response().arrayBuffer());
  return { bytes, ...(await decode(images, bytes)) };
}

export interface UploadResult {
  ok: true;
  deduped: boolean;
  picture: ReturnType<typeof pictureOut>;
}

/**
 * Rust `upload`: validate, re-encode to WebP, dedupe on the stored content,
 * cap at {@link MAX_PICTURES_PER_ROUTE} per route, store both objects, index.
 */
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
  if (!sniffFormat(data))
    throw badRequest("unsupported image format (magic bytes); accepted: JPEG, PNG, WebP");

  const images = (await getEnv()).IMAGES;
  if (!images) throw unavailable();
  await decode(images, data);

  let full: Encoded;
  let thumb: Encoded;
  try {
    full = await toWebp(images, data, FULL_LONG_EDGE, FULL_QUALITY);
    thumb = await toWebp(images, data, THUMB_LONG_EDGE, THUMB_QUALITY);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.warn("route-picture encode failed", e);
    throw unavailable();
  }

  const hash = hex(await crypto.subtle.digest("SHA-256", full.bytes as BufferSource));
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

  const { key, thumbKey } = keysFor(routeId, hash.slice(0, 16));
  const bucket = await getR2();
  const put = (k: string, bytes: Uint8Array) =>
    bucket.put(k, bytes as BufferSource, {
      httpMetadata: { contentType: "image/webp", cacheControl: IMMUTABLE_CACHE_CONTROL },
    });
  await put(key, full.bytes);
  await put(thumbKey, thumb.bytes);

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
    thumbKey,
    contentHash: hash,
    mimeType: "image/webp",
    sizeBytes: full.bytes.length,
    thumbBytes: thumb.bytes.length,
    width: full.width,
    height: full.height,
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

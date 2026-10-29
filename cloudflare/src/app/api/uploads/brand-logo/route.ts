import { limitWrite } from "@/lib/rate-limit";
import { getR2 } from "@/lib/db/client";
import { handleRouteError, requireStaff, err } from "@/lib/api";
import { ApiError, requirePermission } from "@/lib/auth/rbac";
import { getEnv } from "@/lib/db/client";
import { decode, toWebp, unavailable } from "@/lib/services/image-encode";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB in; a stored logo is a few KiB
/** Long edge of a stored logo: sharp at 2x on the largest place a logo is shown. */
const LOGO_LONG_EDGE = 512;
const LOGO_QUALITY = 85;

/** Magic-byte sniffing (jpg/png/webp; svg allowed as text+xml). */
function sniff(bytes: Uint8Array, declared: string): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  if (declared === "image/svg+xml") return "image/svg+xml";
  return null;
}

const hex16 = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) =>
    b.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 16);

/**
 * POST /api/uploads/brand-logo — admin multipart upload → R2.
 * A raster logo is re-encoded to WebP (scaled to 512 px, EXIF dropped) before
 * it is stored; an SVG is kept as it is. Without the Images binding a raster
 * upload is refused rather than stored uncompressed.
 * Content-addressed key: brands/logos/{sha256-16 of the stored bytes}.{webp|svg};
 * immutable cache. Returns the public /api/media/... URL to store on the brand row.
 */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await limitWrite("upload", staff.id);
    await requirePermission(staff, "admin:brands:write");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err(400, "validation", "file field required");
    if (file.size > MAX_BYTES) return err(413, "too-large", "Logo must be ≤ 5 MiB");
    const buf = new Uint8Array(await file.arrayBuffer());
    const mime = sniff(buf, file.type);
    if (!mime) return err(415, "unsupported", "Only jpg/png/webp/svg allowed");

    let stored: Uint8Array = buf;
    if (mime !== "image/svg+xml") {
      const images = (await getEnv()).IMAGES;
      if (!images) throw unavailable();
      await decode(images, buf);
      try {
        stored = (await toWebp(images, buf, LOGO_LONG_EDGE, LOGO_QUALITY)).bytes;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        console.warn("brand-logo encode failed", e);
        throw unavailable();
      }
    }
    const storedMime = mime === "image/svg+xml" ? mime : "image/webp";
    const key = `brands/logos/${await hex16(stored)}.${storedMime === "image/webp" ? "webp" : "svg"}`;
    const bucket = await getR2();
    await bucket.put(key, stored as BufferSource, {
      httpMetadata: {
        contentType: storedMime,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    return Response.json({ key, url: `/api/media/${key}` }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

import { limitWrite } from "@/lib/rate-limit";
import { getR2 } from "@/lib/db/client";
import { handleRouteError, requireStaff, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB logos
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

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

/**
 * POST /api/uploads/brand-logo — admin multipart upload → R2.
 * Content-addressed key: brands/logos/{sha256-16}.{ext}; immutable cache.
 * Returns the public /api/media/... URL to store on the brand row.
 */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await limitWrite("upload", staff.id);
    await requirePermission(staff, "admin:brands:write");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err(400, "validation", "file field required");
    if (file.size > MAX_BYTES) return err(413, "too-large", "Logo must be ≤ 2 MiB");
    const buf = new Uint8Array(await file.arrayBuffer());
    const mime = sniff(buf, file.type);
    if (!mime) return err(415, "unsupported", "Only jpg/png/webp/svg allowed");
    const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
    const ext = ALLOWED[mime];
    const key = `brands/logos/${hash}.${ext}`;
    const bucket = await getR2();
    await bucket.put(key, buf as BufferSource, {
      httpMetadata: {
        contentType: mime,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    return Response.json({ key, url: `/api/media/${key}` }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

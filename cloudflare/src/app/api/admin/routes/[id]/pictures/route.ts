import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { badRequest, uuidParam } from "@/lib/services/http-errors";
import {
  MAX_PICTURE_BYTES,
  deleteAllPictures,
  listPictures,
  uploadPicture,
} from "@/lib/services/route-media";

type Params = { params: Promise<{ id: string }> };

/** The multipart envelope around the largest picture (Rust `UPLOAD_BODY_LIMIT`). */
const UPLOAD_BODY_LIMIT = MAX_PICTURE_BYTES + 64 * 1024;
const MAX_ALT_BYTES = 255;

/** `GET /api/admin/routes/{id}/pictures`. */
export async function GET(req: Request, ctx: Params) {
  try {
    await requirePermission(await requireStaff(req), "admin:routes:read");
    return Response.json(await listPictures(uuidParam("id", (await ctx.params).id) as string));
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * `POST /api/admin/routes/{id}/pictures` — multipart: `file` (exactly once)
 * and an optional `alt_text`. 201 for a new picture, 200 when the same
 * content was already attached.
 */
export async function POST(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    const routeId = uuidParam("id", (await ctx.params).id) as string;
    await requirePermission(staff, "admin:routes:write");
    if (Number(req.headers.get("content-length") ?? 0) > UPLOAD_BODY_LIMIT)
      return Response.json(
        { error: { code: "too-large", message: "request body is too large" } },
        { status: 413 },
      );

    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      throw badRequest(`malformed multipart body: ${String(e)}`);
    }
    const files = form.getAll("file");
    if (files.length > 1) throw badRequest("multipart field 'file' must appear exactly once");
    const file = files[0];
    if (!(file instanceof File)) throw badRequest("multipart field 'file' (image) is required");
    const alt = form.get("alt_text");
    const altText = typeof alt === "string" && alt.trim() ? alt.trim() : null;
    if (altText && new TextEncoder().encode(altText).length > MAX_ALT_BYTES)
      throw badRequest("alt_text exceeds 255 characters");

    const out = await uploadPicture(routeId, new Uint8Array(await file.arrayBuffer()), altText);
    return Response.json(out, { status: out.deduped ? 200 : 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/routes/{id}/pictures` — clear the gallery. */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:routes:write");
    return Response.json(await deleteAllPictures(uuidParam("id", (await ctx.params).id) as string));
  } catch (e) {
    return handleRouteError(e);
  }
}

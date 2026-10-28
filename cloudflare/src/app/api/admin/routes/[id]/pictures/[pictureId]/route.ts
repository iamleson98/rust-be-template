import { handleRouteError, readJson, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { uuidParam } from "@/lib/services/http-errors";
import {
  deletePicture,
  patchPicture,
  validatePatchPicture,
  type PatchPictureBody,
} from "@/lib/services/route-media";

type Params = { params: Promise<{ id: string; pictureId: string }> };

async function ids(ctx: Params): Promise<[string, string]> {
  const { id, pictureId } = await ctx.params;
  return [uuidParam("id", id) as string, uuidParam("pictureId", pictureId) as string];
}

/** `PATCH …/pictures/{pictureId}` — move it to a display position and/or set its alt text. */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    const [routeId, pictureId] = await ids(ctx);
    const body = await readJson<PatchPictureBody>(req);
    await requirePermission(staff, "admin:routes:write");
    validatePatchPicture(body);
    return Response.json(await patchPicture(routeId, pictureId, body));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE …/pictures/{pictureId}` — remove the picture and its stored objects. */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    const [routeId, pictureId] = await ids(ctx);
    await requirePermission(staff, "admin:routes:write");
    return Response.json(await deletePicture(routeId, pictureId));
  } catch (e) {
    return handleRouteError(e);
  }
}

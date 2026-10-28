import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { assertUserId, deleteUser, getUser, userOut } from "@/lib/services/users";

type Ctx = { params: Promise<{ id: string }> };

/** `GET /api/users/{id}` — one user (`users:read`, staff). */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const staff = await requireStaff(req);
    const { id } = await ctx.params;
    assertUserId(id);
    await requirePermission(staff, "users:read");
    return Response.json(userOut(await getUser(id)));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/users/{id}` — remove a user (`users:delete`, admins only). */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const staff = await requireStaff(req);
    const { id } = await ctx.params;
    assertUserId(id);
    await requirePermission(staff, "users:delete");
    await deleteUser(staff.id, id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return handleRouteError(e);
  }
}

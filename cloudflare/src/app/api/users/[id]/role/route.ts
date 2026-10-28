import { handleRouteError, readJson, requireUser } from "@/lib/api";
import { ApiError, requirePermission } from "@/lib/auth/rbac";
import { asObject, str } from "@/lib/auth/validation";
import {
  ROLE_NAMES,
  assertUserId,
  setUserRole,
  userOut,
  type RoleName,
} from "@/lib/services/users";

/**
 * `PATCH /api/users/{id}/role` — change a role (`admin:users:manage-roles`,
 * held by admins only). Same order as Rust: the role is validated before the
 * permission is checked.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireUser(req);
    const { id } = await ctx.params;
    assertUserId(id);
    const role = str(asObject(await readJson<unknown>(req)), "role") ?? "";
    if (!(ROLE_NAMES as readonly string[]).includes(role)) {
      throw new ApiError(400, "validation_error", "role must be one of: user, employee, admin");
    }
    await requirePermission(caller, "admin:users:manage-roles");
    return Response.json({ user: userOut(await setUserRole(id, role as RoleName)) });
  } catch (e) {
    return handleRouteError(e);
  }
}

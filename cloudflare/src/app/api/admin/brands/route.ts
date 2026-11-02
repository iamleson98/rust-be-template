import { handleRouteError, requireStaff, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBrandList } from "@/lib/services/admin-out";
import { createBrand } from "@/lib/services/admin-brands";

export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:brands:read");
    const items = await adminBrandList();
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/admin/brands` — create a brand (`services/admin-brands.ts` checks the body). */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:brands:write");
    return Response.json(await createBrand(await readJson(req)), { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

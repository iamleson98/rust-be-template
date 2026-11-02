import { getDb } from "@/lib/db/client";
import { routes } from "@/lib/db/schema";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import {
  objectBody,
  optionalOneOf,
  optionalText,
  requiredText,
  STATUSES,
} from "@/lib/services/input";
import { adminRouteList } from "@/lib/services/admin-out";

/** `GET /api/admin/routes?brandId=&q=&startLocationId=&endLocationId=` — staff list (all statuses). */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:routes:read");
    const url = new URL(req.url);
    const result = await adminRouteList({
      brandId: url.searchParams.get("brandId") ?? undefined,
      q: url.searchParams.get("q")?.trim() || undefined,
      limit: Math.min(
        Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
        500,
      ),
      offset: Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0),
    });
    return Response.json(result);
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/admin/routes` — create a route. */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:routes:write");
    const body = objectBody(await readJson(req));
    const start = requiredText(body, "startLocationId", 64);
    const end = requiredText(body, "endLocationId", 64);
    if (!start || !end)
      return err(400, "validation", "startLocationId and endLocationId are required");
    const name = requiredText(body, "name", 200) ?? `${start} → ${end}`;
    const brandId = optionalText(body, "brandId", 64) ?? null;
    const status = optionalOneOf(body, "status", STATUSES) ?? "active";
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(routes).values({
      id,
      brandId,
      name,
      startLocationId: start,
      endLocationId: end,
      status,
      createdAt: now,
      updatedAt: now,
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

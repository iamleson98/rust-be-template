import { getDb } from "@/lib/db/client";
import { routes } from "@/lib/db/schema";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
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

interface RouteBody {
  brandId?: string;
  name?: string;
  startLocationId?: string;
  endLocationId?: string;
  status?: string;
}

/** `POST /api/admin/routes` — create a route. */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:routes:write");
    const body = await readJson<RouteBody>(req);
    const start = (body.startLocationId ?? "").trim();
    const end = (body.endLocationId ?? "").trim();
    if (!start || !end)
      return err(400, "validation", "startLocationId and endLocationId are required");
    const name = (body.name ?? "").trim() || `${start} → ${end}`;
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(routes).values({
      id,
      brandId: body.brandId?.trim() || null,
      name,
      startLocationId: start,
      endLocationId: end,
      status: body.status === "inactive" ? "inactive" : "active",
      createdAt: now,
      updatedAt: now,
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

import { getDb } from "@/lib/db/client";
import { vehicleTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import {
  objectBody,
  optionalInt,
  optionalOneOf,
  requiredText,
  STATUSES,
} from "@/lib/services/input";
import { adminVehicleTypeList } from "@/lib/services/admin-out";

/** `GET /api/admin/vehicle-types?q=&limit=&offset=` — staff catalog list. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:vehicle_types:read");
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || undefined;
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
      500,
    );
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const result = await adminVehicleTypeList({ q, limit, offset });
    return Response.json(result);
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/admin/vehicle-types` — create a vehicle type. */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:vehicle_types:write");
    const body = objectBody(await readJson(req));
    const code = requiredText(body, "code", 32);
    const label = requiredText(body, "label", 100);
    if (!code || !label) return err(400, "validation", "code and label are required");
    const totalSeats = optionalInt(body, "totalSeats", 1, 100) ?? null;
    const sortOrder = optionalInt(body, "sortOrder", -1000, 1000) ?? 0;
    const status = optionalOneOf(body, "status", STATUSES) ?? "active";
    const db = await getDb();
    const dupe = await db
      .select({ id: vehicleTypes.id })
      .from(vehicleTypes)
      .where(eq(vehicleTypes.code, code))
      .limit(1);
    if (dupe.length > 0) return err(409, "conflict", "code already exists");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(vehicleTypes).values({
      id,
      code,
      label,
      totalSeats,
      sortOrder,
      status,
      createdAt: now,
      updatedAt: now,
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

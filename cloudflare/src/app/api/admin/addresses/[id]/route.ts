import { getDb } from "@/lib/db/client";
import { addresses, schedulePoints } from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { findCity } from "@/lib/city-match";

type Params = { params: Promise<{ id: string }> };

interface AddressBody {
  brandId?: string;
  name?: string;
  address?: string | null;
  lat?: number;
  lon?: number;
  /** Slug of one of our cities (`cities.json`); `province` follows from it. */
  cityId?: string;
  district?: string | null;
  ward?: string | null;
}

/** `PUT /api/admin/addresses/{id}` — update an address. */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:addresses:write");
    const { id } = await ctx.params;
    const body = await readJson<AddressBody>(req);
    const db = await getDb();
    const existing = (await db.select().from(addresses).where(eq(addresses.id, id)).limit(1))[0];
    if (!existing) return err(404, "not-found", "address not found");
    const name = body.name?.trim();
    if (body.name !== undefined && !name) return err(400, "validation", "name must not be empty");
    const city = body.cityId === undefined ? null : findCity(body.cityId.trim());
    if (body.cityId !== undefined && !city) {
      return err(400, "validation", `cityId: unknown city ${JSON.stringify(body.cityId)}`);
    }
    await db
      .update(addresses)
      .set({
        brandId: body.brandId?.trim() || existing.brandId,
        name: name || existing.name,
        address: text(body.address, existing.address),
        lat: body.lat ?? existing.lat,
        lon: body.lon ?? existing.lon,
        cityId: city?.slug ?? existing.cityId,
        province: city?.name ?? existing.province,
        district: text(body.district, existing.district),
        ward: text(body.ward, existing.ward),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(addresses.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** A text field as sent: absent keeps `current`, blank clears it. */
const text = (sent: string | null | undefined, current: string | null) =>
  sent === undefined ? current : sent?.trim() || null;

/**
 * `DELETE /api/admin/addresses/{id}` — delete an address no schedule stops
 * at (deleting it would silently drop those stops).
 */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:addresses:write");
    const { id } = await ctx.params;
    const db = await getDb();
    const existing = (
      await db.select({ id: addresses.id }).from(addresses).where(eq(addresses.id, id)).limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "address not found");
    const [used] = await db
      .select({ n: count() })
      .from(schedulePoints)
      .where(eq(schedulePoints.addressId, id));
    if ((used?.n ?? 0) > 0) {
      return err(409, "conflict", `address is a stop of ${used?.n} schedule(s)`);
    }
    await db.delete(addresses).where(eq(addresses.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

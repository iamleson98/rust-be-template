import { getDb } from "@/lib/db/client";
import { addresses } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { findCity } from "@/lib/city-match";

type Params = { params: Promise<{ id: string }> };

interface AddressBody {
  brandId?: string;
  name?: string;
  address?: string;
  lat?: number;
  lon?: number;
  /** Slug of one of our cities (`cities.json`); `province` follows from it. */
  cityId?: string;
  district?: string;
  ward?: string;
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
    const city = body.cityId === undefined ? null : findCity(body.cityId.trim());
    if (body.cityId !== undefined && !city) {
      return err(400, "validation", `cityId: unknown city ${JSON.stringify(body.cityId)}`);
    }
    await db
      .update(addresses)
      .set({
        brandId: body.brandId?.trim() || existing.brandId,
        name: body.name?.trim() || existing.name,
        address: body.address ?? existing.address,
        lat: body.lat ?? existing.lat,
        lon: body.lon ?? existing.lon,
        cityId: city?.slug ?? existing.cityId,
        province: city?.name ?? existing.province,
        district: body.district ?? existing.district,
        ward: body.ward ?? existing.ward,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(addresses.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/addresses/{id}` — delete an address. */
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
    await db.delete(addresses).where(eq(addresses.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

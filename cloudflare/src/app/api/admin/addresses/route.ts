import { getDb } from "@/lib/db/client";
import { addresses } from "@/lib/db/schema";
import { and, asc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminAddressOut } from "@/lib/services/admin-out";
import { findCity } from "@/lib/city-match";

/**
 * `GET /api/admin/addresses?brandId=&q=&limit=&offset=` — a brand's
 * addresses; `q`/`limit`/`offset` feed the searchable, infinite-scroll
 * schedule point picker; omitting `limit` returns all.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:addresses:read");
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const q = url.searchParams.get("q")?.trim() || undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 500) : undefined;
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const db = await getDb();
    const conditions: SQL[] = [];
    if (brandId) conditions.push(eq(addresses.brandId, brandId));
    if (q) {
      const m = or(like(addresses.name, `%${q}%`), like(addresses.address, `%${q}%`));
      if (m) conditions.push(m);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(addresses)
      .where(where)
      .orderBy(asc(addresses.name))
      .limit(limit ?? 1000)
      .offset(offset);
    const total = await db
      .select({ n: sql<number>`count(*)` })
      .from(addresses)
      .where(where);
    return Response.json({ items: rows.map(adminAddressOut), total: Number(total[0]?.n ?? 0) });
  } catch (e) {
    return handleRouteError(e);
  }
}

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

/** `POST /api/admin/addresses` — create an address in one of our cities. */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:addresses:write");
    const body = await readJson<AddressBody>(req);
    const brandId = (body.brandId ?? "").trim();
    const name = (body.name ?? "").trim();
    if (!brandId || !name) return err(400, "validation", "brandId and name are required");
    const cityId = (body.cityId ?? "").trim();
    if (!cityId) return err(400, "validation", "cityId is required");
    const city = findCity(cityId);
    if (!city) return err(400, "validation", `cityId: unknown city ${JSON.stringify(cityId)}`);
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(addresses).values({
      id,
      brandId,
      name,
      address: body.address ?? null,
      lat: body.lat ?? null,
      lon: body.lon ?? null,
      cityId: city.slug,
      province: city.name,
      district: body.district ?? null,
      ward: body.ward ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

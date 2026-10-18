import { getDb, getR2 } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:brands:read");
    const db = await getDb();
    const rows = await db.select().from(brands).orderBy(desc(brands.createdAt));
    return Response.json({ items: rows });
  } catch (e) {
    return handleRouteError(e);
  }
}

interface BrandBody {
  name?: string;
  slug?: string;
  description?: string;
  contactPhone?: string;
  contactEmail?: string;
  logoUrl?: string;
  status?: string;
  childMaxAge?: number;
  childDiscountAmount?: number;
}

export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:brands:write");
    const body = await readJson<BrandBody>(req);
    const name = (body.name ?? "").trim();
    const slug = (body.slug ?? name)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!name || !slug) return err(400, "validation", "name/slug required");
    const db = await getDb();
    const existing = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug)).limit(1);
    if (existing.length > 0) return err(409, "conflict", "slug already exists");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(brands).values({
      id,
      slug,
      name,
      description: body.description ?? null,
      contactPhone: body.contactPhone ?? null,
      contactEmail: body.contactEmail ?? null,
      logoUrl: body.logoUrl ?? null,
      status: body.status === "inactive" ? "inactive" : "active",
      childMaxAge: body.childMaxAge ?? null,
      childDiscountAmount: body.childDiscountAmount ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return Response.json({ id, slug }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

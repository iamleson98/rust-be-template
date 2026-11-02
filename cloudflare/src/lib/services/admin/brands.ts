/**
 * Admin brands — the staff list (`GET /api/admin/brands`) and the writes
 * (`POST /api/admin/brands`, `PUT /api/admin/brands/{id}`).
 *
 * One parser checks what the brand form sends, for both: lengths, the status,
 * the logo, and the child-fare policy (`childFare: { maxAge, discountAmount }`
 * or `null` to turn it off), which is stored as `child_max_age` +
 * `child_discount_amount`. A field left out keeps its value on an update.
 */
import { getDb } from "@/lib/db/client";
import { desc, eq } from "drizzle-orm";
import { busLayouts, routes, brands } from "@/lib/db/schema";
import { countOf, groupedCounts } from "@/lib/db/counts";
import { ApiError } from "@/lib/auth/rbac";
import { stripTones } from "@/lib/format";
import { badRequest, notFound } from "../http-errors";
import {
  type Body,
  isRecord,
  objectBody,
  optionalOneOf,
  optionalText as text,
  requiredText,
  STATUSES,
} from "../input";

/** `AdminBrandOut` — brand row + route/layout counts + child fare policy.
 * (Counts via batched GROUP BY maps — the Rust admin_service pattern; the
 * correlated-subquery form silently returned 0, see db/counts.ts.) */
export async function adminBrandList() {
  const db = await getDb();
  const rows = await db.select({ brand: brands }).from(brands).orderBy(desc(brands.createdAt));
  const ids = rows.map((r) => r.brand.id);
  const [routeCounts, layoutCounts] = await Promise.all([
    groupedCounts(routes, routes.brandId, ids),
    groupedCounts(busLayouts, busLayouts.brandId, ids),
  ]);
  return rows.map(({ brand: b }) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    logoUrl: b.logoUrl,
    rating: b.rating,
    status: b.status,
    contactPhone: b.contactPhone,
    contactEmail: b.contactEmail,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    routeCount: countOf(routeCounts, b.id),
    layoutCount: countOf(layoutCounts, b.id),
    childFare:
      b.childMaxAge != null && b.childDiscountAmount != null
        ? { maxAge: b.childMaxAge, discountAmount: b.childDiscountAmount }
        : null,
  }));
}

type BrandRow = typeof brands.$inferSelect;

/** The columns an admin write may set. */
export type BrandPatch = Partial<
  Pick<
    BrandRow,
    | "name"
    | "description"
    | "contactPhone"
    | "contactEmail"
    | "logoUrl"
    | "status"
    | "childMaxAge"
    | "childDiscountAmount"
  >
>;

/** A logo this app stored (`POST /api/uploads/brand-logo`), or an https image elsewhere. */
const OWN_LOGO = /^\/api\/media\/brands\/logos\/[0-9a-f]{16}\.(jpg|png|webp|svg)$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function logo(body: Body): string | null | undefined {
  const url = text(body, "logoUrl", 2048);
  if (!url) return url;
  if (OWN_LOGO.test(url) || /^https:\/\/[^\s]+$/.test(url)) return url;
  throw badRequest("logoUrl must be an uploaded logo or an https URL");
}

function childFare(body: Body): BrandPatch {
  const v = body.childFare;
  if (v === undefined) return {};
  if (v === null) return { childMaxAge: null, childDiscountAmount: null };
  if (!isRecord(v)) throw badRequest("childFare must be an object or null");
  const { maxAge, discountAmount } = v;
  if (!Number.isInteger(maxAge) || (maxAge as number) < 1 || (maxAge as number) > 17)
    throw badRequest("childFare.maxAge must be a whole number from 1 to 17");
  if (
    !Number.isInteger(discountAmount) ||
    (discountAmount as number) < 0 ||
    (discountAmount as number) > 100_000_000 ||
    (discountAmount as number) % 1000 !== 0
  )
    throw badRequest("childFare.discountAmount must be 0..100,000,000 VND in whole thousands");
  return { childMaxAge: maxAge as number, childDiscountAmount: discountAmount as number };
}

/** What `body` asks to change, checked. Keys it leaves out are absent from the patch. */
export function parseBrandPatch(raw: unknown): BrandPatch {
  const body = objectBody(raw);
  const patch: BrandPatch = { ...childFare(body) };

  const name = requiredText(body, "name", 200);
  if (name !== undefined) patch.name = name;

  const description = text(body, "description", 5000);
  if (description !== undefined) patch.description = description;
  const phone = text(body, "contactPhone", 32);
  if (phone !== undefined) patch.contactPhone = phone;
  const email = text(body, "contactEmail", 254);
  if (email && !EMAIL.test(email)) throw badRequest("contactEmail is not an email address");
  if (email !== undefined) patch.contactEmail = email;
  const logoUrl = logo(body);
  if (logoUrl !== undefined) patch.logoUrl = logoUrl;

  const status = optionalOneOf(body, "status", STATUSES);
  if (status) patch.status = status;
  return patch;
}

/** The URL slug of a brand name: lowercase ASCII words joined by `-` ("Sao Việt" → "sao-viet"). */
export function brandSlug(raw: string): string {
  return stripTones(raw)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/** Create a brand; 409 when its slug is taken. */
export async function createBrand(body: unknown): Promise<{ id: string; slug: string }> {
  const patch = parseBrandPatch(body);
  if (!patch.name) throw badRequest("name is required");
  const requested = isRecord(body) && typeof body.slug === "string" ? body.slug : "";
  const slug = brandSlug(requested || patch.name);
  if (!slug) throw badRequest("the name or slug must contain letters or digits");

  const db = await getDb();
  const taken = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.slug, slug))
    .limit(1);
  if (taken.length > 0) throw new ApiError(409, "conflict", "slug already exists");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(brands).values({
    ...patch,
    id,
    slug,
    name: patch.name,
    status: patch.status ?? "active",
    createdAt: now,
    updatedAt: now,
  });
  return { id, slug };
}

/** Apply an update; 404 for an unknown brand. */
export async function updateBrand(
  id: string,
  body: unknown,
): Promise<{ id: string; updated: true }> {
  const patch = parseBrandPatch(body);
  const db = await getDb();
  const updated = await db
    .update(brands)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(brands.id, id))
    .returning({ id: brands.id });
  if (updated.length === 0) throw notFound("Brand not found");
  return { id, updated: true };
}

/** `DELETE /api/admin/brands/{id}`: a soft delete, since routes, bookings and reviews point at the brand. */
export async function deactivateBrand(id: string): Promise<{ id: string; status: "inactive" }> {
  const db = await getDb();
  const updated = await db
    .update(brands)
    .set({ status: "inactive", updatedAt: new Date().toISOString() })
    .where(eq(brands.id, id))
    .returning({ id: brands.id });
  if (updated.length === 0) throw notFound("Brand not found");
  return { id, status: "inactive" };
}

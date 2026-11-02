import { readJson, staffRoute } from "@/lib/api";
import { adminBrandList } from "@/lib/services/admin-out";
import { createBrand } from "@/lib/services/admin-brands";

export const GET = staffRoute("admin:brands:read", async () => {
  const items = await adminBrandList();
  return Response.json({ items });
});

/** `POST /api/admin/brands` — create a brand (`services/admin-brands.ts` checks the body). */
export const POST = staffRoute("admin:brands:write", async (req) => {
  return Response.json(await createBrand(await readJson(req)), { status: 201 });
});

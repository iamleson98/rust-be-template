import { adminRoute, readOptionalJson } from "@/lib/api";
import { settleCoupons } from "@/lib/services/admin";

/**
 * `POST /api/admin/coupons/settle` — mark redeemed coupons as paid out:
 * `{ brandId }` for one brand, an empty body for every brand. Malformed JSON
 * or a bad `brandId` is a 400, never "settle everything".
 */
export const POST = adminRoute(async (req) =>
  Response.json(await settleCoupons(await readOptionalJson(req))),
);

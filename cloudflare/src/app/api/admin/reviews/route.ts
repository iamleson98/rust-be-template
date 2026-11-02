import { staffRoute } from "@/lib/api";
import { intParam, uuidParam } from "@/lib/services/http-errors";
import { listAdminReviews } from "@/lib/services/reviews";

/**
 * `GET /api/admin/reviews?status=&brandId=&routeId=&search=&limit=&offset=`
 * — the moderation queue, full `ReviewOut` rows plus the paging envelope.
 */
export const GET = staffRoute("admin:reviews:moderate", async (req) => {
  const q = new URL(req.url).searchParams;
  return Response.json(
    await listAdminReviews(
      {
        status: q.get("status"),
        brandId: uuidParam("brandId", q.get("brandId")),
        routeId: uuidParam("routeId", q.get("routeId")),
        search: q.get("search"),
      },
      intParam("limit", q.get("limit"), 50),
      intParam("offset", q.get("offset"), 0),
    ),
  );
});

import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { intParam, uuidParam } from "@/lib/services/http-errors";
import {
  createReview,
  listPublicReviews,
  validateCreateReview,
  type CreateReviewInput,
} from "@/lib/services/reviews";

/** `GET /api/reviews` — approved reviews, optionally for one brand and/or route. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    return Response.json(
      await listPublicReviews({
        brandId: uuidParam("brand_id", q.get("brand_id")),
        routeId: uuidParam("route_id", q.get("route_id")),
        limit: intParam("limit", q.get("limit"), 20),
        offset: intParam("offset", q.get("offset"), 0),
      }),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/reviews` — create a review (pending until moderated). */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await limitWrite("review", user.id);
    const body = await readJson<CreateReviewInput>(req);
    validateCreateReview(body);
    return Response.json({ id: await createReview(user.id, body) });
  } catch (e) {
    return handleRouteError(e);
  }
}

import { handleRouteError, requireUser } from "@/lib/api";
import { intParam } from "@/lib/services/http-errors";
import { listMyReviews } from "@/lib/services/reviews";

/** `GET /api/reviews/mine` — the caller's own reviews, any status, with a true total. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const q = new URL(req.url).searchParams;
    return Response.json(
      await listMyReviews(
        user.id,
        q.get("status"),
        intParam("limit", q.get("limit"), 20),
        intParam("offset", q.get("offset"), 0),
      ),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

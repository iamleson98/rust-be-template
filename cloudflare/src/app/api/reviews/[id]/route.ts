import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { uuidParam } from "@/lib/services/http-errors";
import {
  getPublicReview,
  removeReview,
  updateReview,
  validateUpdateReview,
  type UpdateReviewInput,
} from "@/lib/services/reviews";

type Params = { params: Promise<{ id: string }> };

async function reviewId(ctx: Params): Promise<string> {
  return uuidParam("id", (await ctx.params).id) as string;
}

/** `GET /api/reviews/{id}` — an approved review (the author's phone left out). */
export async function GET(_req: Request, ctx: Params) {
  try {
    return Response.json(await getPublicReview(await reviewId(ctx)));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `PATCH /api/reviews/{id}` — the author edits the fields they send. */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    const id = await reviewId(ctx);
    const body = await readJson<UpdateReviewInput>(req);
    validateUpdateReview(body);
    await updateReview(id, user.id, body);
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/reviews/{id}` — the author withdraws their review. */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    await removeReview(await reviewId(ctx), user.id);
    return Response.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}

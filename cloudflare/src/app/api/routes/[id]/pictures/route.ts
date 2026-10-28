import { handleRouteError } from "@/lib/api";
import { uuidParam } from "@/lib/services/http-errors";
import { listPictures } from "@/lib/services/route-media";

/** `GET /api/routes/{id}/pictures` — the ordered gallery (position 0 is the cover); public. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await listPictures(uuidParam("id", (await ctx.params).id) as string));
  } catch (e) {
    return handleRouteError(e);
  }
}

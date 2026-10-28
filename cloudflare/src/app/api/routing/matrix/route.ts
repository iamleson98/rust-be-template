import { handleRouteError } from "@/lib/api";
import { badRequest } from "@/lib/services/http-errors";
import { matrix, parseLocations } from "@/lib/services/routing";

/** `GET /api/routing/matrix?sources=…&targets=…&costing=auto` — travel times (minutes) and distances (km). */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const sources = q.get("sources");
    const targets = q.get("targets");
    if (sources === null || targets === null) throw badRequest("missing field `sources` or `targets`");
    return Response.json(
      await matrix(q.get("costing") ?? "auto", parseLocations(sources), parseLocations(targets)),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

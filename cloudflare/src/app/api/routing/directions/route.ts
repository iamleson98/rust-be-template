import { handleRouteError } from "@/lib/api";
import { badRequest } from "@/lib/services/http-errors";
import { directions, parseLocations } from "@/lib/services/routing";

/** `GET /api/routing/directions?locations=lat,lon;lat,lon&costing=auto&language=vi`. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const locations = q.get("locations");
    if (locations === null) throw badRequest("missing field `locations`");
    return Response.json(
      await directions(
        q.get("costing") ?? "auto",
        q.get("language") ?? "vi",
        parseLocations(locations),
      ),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

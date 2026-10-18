import { parseSearchParams, searchTrips } from "@/lib/services/trip-search";
import { handleRouteError, err } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const params = parseSearchParams(url);
    if (!params.from || !params.to || !params.date)
      return err(400, "validation", "from, to and date are required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date))
      return err(400, "validation", "date must be YYYY-MM-DD");
    const result = await searchTrips(params);
    return Response.json(result);
  } catch (e) {
    return handleRouteError(e);
  }
}

import { reverseGeocode } from "@/lib/services/place-search";
import { handleRouteError, err } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return err(400, "validation", "lat and lon are required");
    const items = await reverseGeocode(lat, lon);
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}

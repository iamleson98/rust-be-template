import { handleRouteError } from "@/lib/api";
import { badRequest } from "@/lib/services/http-errors";
import { isochrone, parseContours } from "@/lib/services/routing";

const coordinate = (name: string, raw: string | null): number => {
  const n = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(n))
    throw badRequest(`invalid or missing \`${name}\``);
  return n;
};

/** `GET /api/routing/isochrone?lat=&lon=&costing=auto&contours=15,30,60` — GeoJSON reach polygons. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    return Response.json(
      await isochrone(
        q.get("costing") ?? "auto",
        [coordinate("lat", q.get("lat")), coordinate("lon", q.get("lon"))],
        parseContours(q.get("contours")),
      ),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

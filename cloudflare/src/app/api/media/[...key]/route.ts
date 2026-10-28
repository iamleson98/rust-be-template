import { getR2 } from "@/lib/db/client";
import { handleRouteError } from "@/lib/api";
import {
  IMMUTABLE_CACHE_CONTROL,
  contentTypeOf,
  etagOf,
  parseMediaKey,
} from "@/lib/services/route-media";

/** Brand logos (`POST /api/uploads/brand-logo`): the port's only other public object shape. */
const BRAND_LOGO_KEY = /^brands\/logos\/[0-9a-f]{16}\.(jpg|png|webp|svg)$/;

const notFound = () => new Response("media not found", { status: 404 });

/**
 * `GET /api/media/{key}` — proxy an R2 object, but only for keys this app
 * generated (`routes/{routeId}/{hash16}.{ext}`, its `t…jpg` thumbnail, or a
 * brand logo). Anything else is a plain 404 with no storage round trip.
 * Immutable cache headers; the ETag of a route picture is its content hash,
 * so a conditional request is answered without reading the object.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const key = (await ctx.params).key.join("/");
    const parsed = parseMediaKey(key);
    if (!parsed && !BRAND_LOGO_KEY.test(key)) return notFound();

    const headers = new Headers({
      "cache-control": IMMUTABLE_CACHE_CONTROL,
      // Uploads are served from the app's own origin: never let a browser
      // sniff or run them (an SVG with <script> would otherwise execute here).
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    const hit = (etag: string) =>
      (req.headers.get("if-none-match") ?? "")
        .split(",")
        .some((t) => t.trim().replace(/^W\//, "") === etag || t.trim() === "*");

    if (parsed && hit(etagOf(parsed))) {
      headers.set("etag", etagOf(parsed));
      return new Response(null, { status: 304, headers });
    }
    const object = await (await getR2()).get(key);
    if (!object) return notFound();

    object.writeHttpMetadata(headers);
    headers.set("cache-control", IMMUTABLE_CACHE_CONTROL);
    // `httpEtag` is already the quoted wire form ("abc").
    const etag = parsed ? etagOf(parsed) : object.httpEtag;
    headers.set("etag", etag);
    if (parsed) headers.set("content-type", contentTypeOf(parsed));
    else if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
    if (!parsed && hit(etag)) return new Response(null, { status: 304, headers });
    return new Response(object.body, { headers });
  } catch (e) {
    return handleRouteError(e);
  }
}

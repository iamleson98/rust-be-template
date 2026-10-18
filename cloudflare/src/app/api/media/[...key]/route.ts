import { getR2 } from "@/lib/db/client";
import { handleRouteError, err } from "@/lib/api";

/**
 * GET /api/media/{key...} — serve R2 objects with ETag/304 + immutable cache,
 * port of the Rust media proxy (brand logos, route pictures).
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const { key } = await ctx.params;
    const objectKey = key.join("/");
    if (!objectKey || objectKey.includes("..")) return err(400, "validation", "bad key");
    const bucket = await getR2();
    const ifNoneMatch = req.headers.get("if-none-match");
    const object = await bucket.get(objectKey);
    if (!object) return err(404, "not-found", "Media not found");
    const etag = `"${object.httpEtag}"`;
    const headers = new Headers();
    headers.set("etag", etag);
    headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
    headers.set("cache-control", "public, max-age=31536000, immutable");
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  } catch (e) {
    return handleRouteError(e);
  }
}

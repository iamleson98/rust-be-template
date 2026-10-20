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
    const object = await bucket.get(objectKey);
    if (!object) return err(404, "not-found", "Media not found");
    // `httpEtag` is already the quoted wire form ("abc"); re-quoting it made
    // every conditional request miss.
    const etag = object.httpEtag;
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", etag);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    // Uploads are served from the app's own origin: never let a browser
    // sniff or run them (an SVG with <script> would otherwise execute here).
    headers.set("x-content-type-options", "nosniff");
    headers.set(
      "content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  } catch (e) {
    return handleRouteError(e);
  }
}

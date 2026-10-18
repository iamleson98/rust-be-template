import { getDb } from "@/lib/db/client";
import { routePictures } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";

/**
 * `GET /api/routes/{id}/pictures` — the ordered gallery (sortOrder 0 is
 * the cover). Public read; unknown routes return an empty list (Rust
 * parity — "a route with no pictures and a route that doesn't exist are
 * the same to a gallery").
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = await getDb();
    const rows = await db
      .select()
      .from(routePictures)
      .where(eq(routePictures.routeId, id))
      .orderBy(asc(routePictures.sortOrder));
    return Response.json({
      items: rows.map((p) => ({
        id: p.id,
        routeId: p.routeId,
        sortOrder: p.sortOrder,
        // Media is R2-served through /api/media/{key} (same contract the
        // Rust S3 proxy had: content-addressed, immutable keys).
        url: `/api/media/${p.storageKey}`,
        thumbUrl: p.thumbKey ? `/api/media/${p.thumbKey}` : `/api/media/${p.storageKey}`,
        altText: p.altText ?? undefined,
        width: p.width ?? 0,
        height: p.height ?? 0,
        mimeType: p.mimeType ?? "image/jpeg",
        sizeBytes: p.sizeBytes ?? 0,
        createdAt: p.createdAt,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

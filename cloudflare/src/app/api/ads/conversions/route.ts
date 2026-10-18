import { getDb } from "@/lib/db/client";
import { adConversions } from "@/lib/db/schema";
import { handleRouteError, readJson } from "@/lib/api";

/**
 * `POST /api/ads/conversions` — Google Ads conversion report (client side).
 * Stored locally; the server-side upload needs the Ads API credentials
 * (documented in docs/GOOGLE_ADS.md) and stays off by default.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson<{
      event?: string;
      transactionId?: string | null;
      value?: string | null;
      currency?: string | null;
      clickIds?: Record<string, string>;
    }>(req);
    const event = (body.event ?? "").trim();
    if (!event) return new Response(null, { status: 204 });
    const db = await getDb();
    const clickIds = body.clickIds ?? {};
    await db.insert(adConversions).values({
      id: crypto.randomUUID(),
      event,
      transactionId: body.transactionId ?? crypto.randomUUID(),
      conversionValue: body.value ?? null,
      currency: body.currency ?? "VND",
      gclid: clickIds.gclid ?? null,
      wbraid: clickIds.wbraid ?? null,
      gbraid: clickIds.gbraid ?? null,
    });
    return Response.json({
      ok: true,
      stored: true,
      uploadAttempted: false,
      serverUploadEnabled: false,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

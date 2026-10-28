import { handleRouteError, readJson } from "@/lib/api";
import { reportConversion, type ReportConversionBody } from "@/lib/services/ads";

/**
 * `POST /api/ads/conversions` — record a conversion (beacon), no session
 * needed: the beacon fires seconds after the money moment, when the booking
 * session may already have expired, and carries no personal data.
 */
export async function POST(req: Request) {
  try {
    return Response.json(await reportConversion(await readJson<ReportConversionBody>(req)));
  } catch (e) {
    return handleRouteError(e);
  }
}

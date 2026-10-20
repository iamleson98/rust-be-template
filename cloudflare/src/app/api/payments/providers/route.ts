import { enabledProviders } from "@/lib/services/payment";
import { handleRouteError } from "@/lib/api";

/** `GET /api/payments/providers` — the providers checkout can offer. */
export async function GET() {
  try {
    return Response.json(await enabledProviders());
  } catch (e) {
    return handleRouteError(e);
  }
}

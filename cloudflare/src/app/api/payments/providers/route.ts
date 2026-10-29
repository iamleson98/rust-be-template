import { enabledProviders } from "@/lib/services/payment";
import { handleRouteError } from "@/lib/api";

/** Live data (bindings, D1): never prerendered at build. */
export const dynamic = "force-dynamic";

/** `GET /api/payments/providers` — the providers checkout can offer. */
export async function GET() {
  try {
    return Response.json(await enabledProviders());
  } catch (e) {
    return handleRouteError(e);
  }
}

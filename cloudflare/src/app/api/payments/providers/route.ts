import { enabledProviders } from "@/lib/services/payment";
import { handleRouteError } from "@/lib/api";

/** `GET /api/payments/providers` — enabled provider IDs (Rust: `Vec<String>`). */
export async function GET() {
  try {
    const list = await enabledProviders();
    return Response.json({ providers: list.map((p) => p.id) });
  } catch (e) {
    return handleRouteError(e);
  }
}

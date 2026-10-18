import { enabledProviders } from "@/lib/services/payment";
import { handleRouteError } from "@/lib/api";

export async function GET() {
  try {
    return Response.json({ providers: await enabledProviders() });
  } catch (e) {
    return handleRouteError(e);
  }
}

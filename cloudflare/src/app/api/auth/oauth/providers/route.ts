import { handleRouteError } from "@/lib/api";
import { enabledProviderNames } from "@/lib/auth/oauth";

/**
 * `GET /api/auth/oauth/providers` — the social sign-ins that work right now,
 * so the login page shows no button that would end in an error.
 */
export async function GET() {
  try {
    return Response.json({ providers: await enabledProviderNames() });
  } catch (e) {
    return handleRouteError(e);
  }
}

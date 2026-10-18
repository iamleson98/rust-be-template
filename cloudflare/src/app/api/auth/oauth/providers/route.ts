import { getEnv } from "@/lib/db/client";
import { handleRouteError } from "@/lib/api";

/**
 * `GET /api/auth/oauth/providers` — the OAuth providers this deployment
 * has credentials for. Unset → empty list → the SPA renders no buttons.
 */
export async function GET() {
  try {
    const env = await getEnv();
    const providers: string[] = [];
    if (env.OAUTH_GOOGLE_CLIENT_ID) providers.push("google");
    if (env.OAUTH_FACEBOOK_CLIENT_ID) providers.push("facebook");
    if (env.OAUTH_APPLE_CLIENT_ID) providers.push("apple");
    return Response.json({ providers });
  } catch (e) {
    return handleRouteError(e);
  }
}

import { err } from "@/lib/api";
import { getEnv } from "@/lib/db/client";

type Params = { params: Promise<{ provider: string }> };

/**
 * `GET /api/auth/oauth/{provider}/start` — redirect to the provider's
 * consent screen. 501 until OAuth credentials are configured.
 */
export async function GET(req: Request, ctx: Params) {
  const { provider } = await ctx.params;
  if (!["google", "facebook", "apple"].includes(provider)) {
    return err(404, "not-found", "unknown provider");
  }
  const env = await getEnv();
  if (!env.OAUTH_GOOGLE_CLIENT_ID && !env.OAUTH_FACEBOOK_CLIENT_ID && !env.OAUTH_APPLE_CLIENT_ID) {
    return err(501, "not-configured", "OAuth sign-in is not configured on this deployment");
  }
  return err(501, "not-configured", "OAuth start is not implemented for this provider yet");
}

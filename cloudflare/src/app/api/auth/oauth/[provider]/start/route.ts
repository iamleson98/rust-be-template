import { err, handleRouteError } from "@/lib/api";
import {
  STATE_COOKIE_TTL_SECS,
  callbackUrl,
  enabledProvider,
  generateState,
  stateCookieName,
} from "@/lib/auth/oauth";
import { cookiePolicy } from "@/lib/auth/session";
import { getEnv } from "@/lib/db/client";

type Params = { params: Promise<{ provider: string }> };

/**
 * `GET /api/auth/oauth/{provider}/start` — keep a random `state` in a
 * short-lived cookie (HttpOnly, SameSite=Lax so it survives the provider's
 * redirect back) and send the person to the provider's consent screen.
 */
export async function GET(req: Request, ctx: Params) {
  try {
    const { provider: name } = await ctx.params;
    const provider = await enabledProvider(name);
    if (!provider) return err(404, "not_found", `oauth provider '${name}' not configured`);
    const redirectBase = (await getEnv()).OAUTH_REDIRECT_BASE_URL ?? "";
    if (!redirectBase) return err(500, "internal_error", "OAUTH_REDIRECT_BASE_URL is not set");

    const state = generateState();
    const { secure } = await cookiePolicy(req);
    const cookie = [
      `${stateCookieName(name)}=${state}`,
      "Path=/",
      "HttpOnly",
      `Max-Age=${STATE_COOKIE_TTL_SECS}`,
      "SameSite=Lax",
      secure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
    return new Response(null, {
      status: 307,
      headers: {
        location: provider.authorizationUrl(state, callbackUrl(redirectBase, name)),
        "set-cookie": cookie,
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

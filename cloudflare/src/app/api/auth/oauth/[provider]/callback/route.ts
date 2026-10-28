import { clientIp, handleRouteError } from "@/lib/api";
import { registerOauthUser } from "@/lib/auth/auth-service";
import { callbackUrl, enabledProvider, stateCookieName, urlEncode } from "@/lib/auth/oauth";
import { ApiError } from "@/lib/auth/rbac";
import { issueSession, readCookie, sessionCookies } from "@/lib/auth/session";
import { getEnv } from "@/lib/db/client";

type Params = { params: Promise<{ provider: string }> };

const redirect = (location: string, cookies: string[] = []): Response => {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 307, headers });
};

/**
 * `GET /api/auth/oauth/{provider}/callback` — verify the state cookie, trade
 * the code for a token, read the profile, then sign the person in and send
 * them to the frontend. Any failure goes back to `/login?oauth_error=…`.
 */
export async function GET(req: Request, ctx: Params) {
  try {
    const { provider: name } = await ctx.params;
    const env = await getEnv();
    const frontendUrl = (env.OAUTH_FRONTEND_URL ?? "").replace(/\/+$/, "");
    const failure = (message: string) =>
      redirect(`${frontendUrl}/login?oauth_error=${urlEncode(message)}`);

    const q = new URL(req.url).searchParams;
    // 1. The provider itself refused (e.g. the person pressed "Deny").
    const providerError = q.get("error");
    if (providerError) return failure(q.get("error_description") ?? providerError);
    // 2. A callback needs both the code and the state.
    const code = q.get("code");
    if (!code) return failure("Thiếu mã xác thực OAuth");
    const state = q.get("state");
    if (!state) return failure("Thiếu state token OAuth");
    // 3. The state must be the one `start` put in this browser's cookie.
    const cookieName = stateCookieName(name);
    const cookieState = readCookie(req, cookieName);
    if (!cookieState) return failure("Phiên OAuth hết hạn — vui lòng thử lại");
    if (cookieState !== state) {
      console.warn(`[oauth] state mismatch for ${name} — possible CSRF attempt`);
      return failure("State không khớp — có thể bị tấn công CSRF");
    }
    // 4. Code → token → profile.
    const provider = await enabledProvider(name);
    if (!provider) return failure("Nhà cung cấp OAuth không được cấu hình");
    const redirectUri = callbackUrl(env.OAUTH_REDIRECT_BASE_URL ?? "", name);
    let profile;
    try {
      const accessToken = await provider.exchangeCode(code, redirectUri);
      try {
        profile = await provider.fetchProfile(accessToken);
      } catch (e) {
        console.warn(`[oauth] ${name} profile fetch failed`, e);
        return failure("Không thể lấy thông tin người dùng");
      }
    } catch (e) {
      console.warn(`[oauth] ${name} token exchange failed`, e);
      return failure("Không thể đổi mã OAuth lấy token");
    }
    // 5. Create or link the account and sign it in (always a browser session).
    const user = await registerOauthUser(profile);
    if (user.status !== "active") {
      throw new ApiError(403, "forbidden", user.blockReason ?? "account is not active");
    }
    const session = await issueSession(user.id, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
    });
    // One-shot state cookie: cleared as the session cookies are set.
    const clearState = `${cookieName}=; Path=/; HttpOnly; Max-Age=0`;
    return redirect(frontendUrl || "/", [
      ...(await sessionCookies(session.accessToken, session.refreshToken, req)),
      clearState,
    ]);
  } catch (e) {
    return handleRouteError(e);
  }
}

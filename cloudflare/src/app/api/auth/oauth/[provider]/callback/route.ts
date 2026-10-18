import { err } from "@/lib/api";

type Params = { params: Promise<{ provider: string }> };

/** `GET /api/auth/oauth/{provider}/callback` — OAuth return URL (501 until configured). */
export async function GET(_req: Request, ctx: Params) {
  const { provider } = await ctx.params;
  if (!["google", "facebook", "apple"].includes(provider)) {
    return err(404, "not-found", "unknown provider");
  }
  return err(501, "not-configured", "OAuth sign-in is not configured on this deployment");
}

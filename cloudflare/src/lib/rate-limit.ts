/**
 * Request rate limiting on top of Workers' Rate Limiting bindings
 * (`ratelimits` in wrangler.jsonc).
 *
 * What this is — and is not. The binding is per-Cloudflare-location,
 * permissive and eventually consistent: a cheap, latency-free brake against
 * hammering, not an exact counter. Per-IP floods are the edge's job (WAF
 * rate-limiting rules, see README-CLOUDFLARE.md); this layer keys on STABLE
 * identifiers the Worker knows — the account being logged into, the signed-in
 * user — which is what Cloudflare recommends for the binding. The exact,
 * durable guard against password guessing is the D1 lockout (auth/lockout.ts).
 *
 * Fail-open by design: with no binding (tests, `next dev`) nothing is limited.
 */
import { getEnv } from "@/lib/db/client";
import { ApiError } from "@/lib/auth/rbac";

export type Limiter = "AUTH" | "WRITE";

/** Window lengths the bindings are configured with (wrangler.jsonc). */
const PERIOD_SECS: Record<Limiter, number> = { AUTH: 60, WRITE: 60 };

/**
 * Throws a 429 when `key` has used up its allowance in the current window.
 * `Retry-After` is the full window: the binding does not say how much of it
 * is left, so this is an honest upper bound rather than a made-up precise one.
 */
export async function rateLimit(limiter: Limiter, action: string, id: string): Promise<void> {
  const env = await getEnv();
  const binding = limiter === "AUTH" ? env.AUTH_LIMITER : env.WRITE_LIMITER;
  if (!binding) return;
  const { success } = await binding.limit({ key: `${action}:${id}` });
  if (!success) {
    throw new ApiError(
      429,
      "rate-limited",
      "Too many requests — please slow down and try again shortly",
      PERIOD_SECS[limiter],
    );
  }
}

/** Signed-in write actions (booking, claim, chat, reviews, uploads…). */
export const limitWrite = (action: string, userId: string) => rateLimit("WRITE", action, userId);

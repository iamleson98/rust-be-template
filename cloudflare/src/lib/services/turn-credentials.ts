/**
 * Cloudflare Realtime TURN credentials — the corporate-network lifeline
 * for the P2P audio calls behind `/ws-call`.
 *
 * Direct peer-to-peer WebRTC fails behind symmetric NATs and corporate
 * firewalls (UDP blocked, only 443/TCP allowed). Cloudflare's managed
 * TURN service relays the media instead:
 *
 *   turn:  turn.cloudflare.com:3478 (udp) | :443 (udp) | :3478/:80 (tcp)
 *   turns: turn.cloudflare.com:5349/:443 (tcp+TLS)   ← passes HTTPS-only
 *                                                      corporate proxies
 *
 * (Corporate IT may also need to allowlist Cloudflare's four TURN addresses —
 * see the Realtime TURN FAQ; they can change, watch DNS for turn.cloudflare.com.)
 *
 * Credentials are minted server-side (short-lived, TTL-bound) and pushed
 * to clients in the `registered` / `ice-servers` frames — they never
 * travel over an unauthenticated endpoint. Anycast routes each client to
 * the nearest Cloudflare location automatically.
 *
 * Config (secrets): TURN_KEY_ID + TURN_KEY_API_TOKEN (a Calls/TURN key
 * from the dashboard). Without them the hub falls back to public STUN.
 * Pricing: $0.05/GB egress after a 1,000 GB free tier (≈22 MB per
 * audio-call hour; relays engage only when a direct path fails).
 */

import { z } from "zod";

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface TurnEnv {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  TURN_TTL_SECONDS?: string;
}

type ConfiguredTurnEnv = TurnEnv & { TURN_KEY_ID: string; TURN_KEY_API_TOKEN: string };

const TURN_API_BASE = "https://rtc.live.cloudflare.com/v1/turn/keys";

/** The TURN keys API response — validated, never trusted blindly. */
const TurnApiResponse = z.object({
  iceServers: z
    .array(
      z.object({
        urls: z.union([z.string(), z.array(z.string())]),
        username: z.string().optional(),
        credential: z.string().optional(),
      }),
    )
    .min(1),
});

const TURN_HOST = "turn.cloudflare.com";

/**
 * Every transport Cloudflare's TURN listens on, ordered from "fast" to
 * "gets through anything". The API's own answer is the starting point, but
 * we make sure the firewall-friendly entries are present: corporate networks
 * commonly allow outbound TCP 443/80 only, and a list without `turns:…:443`
 * leaves exactly those users with no relay at all.
 */
export const TURN_FIREWALL_URLS = [
  `turn:${TURN_HOST}:3478?transport=udp`,
  `turn:${TURN_HOST}:443?transport=udp`,
  `turn:${TURN_HOST}:3478?transport=tcp`,
  `turn:${TURN_HOST}:80?transport=tcp`,
  `turns:${TURN_HOST}:5349?transport=tcp`,
  `turns:${TURN_HOST}:443?transport=tcp`,
];

/** Adds the firewall-friendly relay URLs to the credentialed TURN entry. */
export function withFirewallFriendlyUrls(servers: IceServerConfig[]): IceServerConfig[] {
  return servers.map((s) => {
    const isTurn = !!s.username && s.urls.some((u) => /^turns?:/i.test(u));
    return isTurn ? { ...s, urls: [...new Set([...s.urls, ...TURN_FIREWALL_URLS])] } : s;
  });
}

/** Refresh when less than half the TTL remains. */
function refreshAfter(issuedAt: number, ttlSeconds: number): number {
  return issuedAt + Math.floor(ttlSeconds / 2) * 1000;
}

interface CacheEntry {
  servers: IceServerConfig[];
  refreshAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Public STUN fallback — works everywhere TURN is not configured. */
export const PUBLIC_ICE_SERVERS: IceServerConfig[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

export function turnConfigured(env: TurnEnv): env is ConfiguredTurnEnv {
  return (
    typeof env.TURN_KEY_ID === "string" &&
    env.TURN_KEY_ID.length > 0 &&
    typeof env.TURN_KEY_API_TOKEN === "string" &&
    env.TURN_KEY_API_TOKEN.length > 0
  );
}

/** Parse the configured TTL: absent/invalid → default; clamped to [600, 86400]. */
function resolveTtl(raw: string | undefined): number {
  const DEFAULT_TTL_SECONDS = 86400;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  const requested = Number.isFinite(parsed) ? parsed : DEFAULT_TTL_SECONDS;
  return Math.min(Math.max(requested, 600), 86400);
}

/**
 * Fetch (and cache) TURN iceServers for one TURN key. Returns null when
 * TURN is not configured or the API is unreachable — callers fall back
 * to public STUN so calls still work on friendly networks.
 */
export async function fetchTurnIceServers(
  env: TurnEnv,
  fetchImpl: typeof fetch = fetch,
  force = false,
): Promise<IceServerConfig[] | null> {
  if (!turnConfigured(env)) return null;
  const keyId = env.TURN_KEY_ID;
  const token = env.TURN_KEY_API_TOKEN;
  const ttl = resolveTtl(env.TURN_TTL_SECONDS);

  const hit = cache.get(keyId);
  if (!force && hit && hit.refreshAt > Date.now()) return hit.servers;

  try {
    const res = await fetchImpl(`${TURN_API_BASE}/${keyId}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    });
    if (!res.ok) throw new Error(`TURN API ${res.status}`);
    const parsed = TurnApiResponse.safeParse(await res.json());
    if (!parsed.success) throw new Error("TURN API returned no usable iceServers");
    const servers = withFirewallFriendlyUrls(
      parsed.data.iceServers.map((s) => ({
        urls: Array.isArray(s.urls) ? s.urls : [s.urls],
        username: s.username,
        credential: s.credential,
      })),
    );
    cache.set(keyId, { servers, refreshAt: refreshAfter(Date.now(), ttl) });
    return servers;
  } catch {
    // Serve stale credentials rather than nothing (a live allocation
    // outlives the API blip); else fall back to public STUN.
    return hit?.servers ?? null;
  }
}

/** The list to hand a client: TURN (with credentials) + public STUN. */
export async function iceServersFor(
  env: TurnEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<IceServerConfig[]> {
  const turn = await fetchTurnIceServers(env, fetchImpl);
  if (!turn) return PUBLIC_ICE_SERVERS;
  return [...turn, ...PUBLIC_ICE_SERVERS];
}

/** Test seam. */
export function __clearTurnCache(): void {
  cache.clear();
}

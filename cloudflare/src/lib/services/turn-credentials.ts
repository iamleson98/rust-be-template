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
 * Credentials are minted server-side (short-lived, TTL-bound) and pushed
 * to clients in the `registered` / `ice-servers` frames — they never
 * travel over an unauthenticated endpoint. Anycast routes each client to
 * the nearest Cloudflare location automatically.
 *
 * Config (secrets): TURN_KEY_ID + TURN_KEY_API_TOKEN (a Calls/TURN key
 * from the dashboard). Without them the hub falls back to public STUN.
 * Pricing: $0.05/GB egress (≈22 MB per audio-call hour; relays engage
 * only when a direct path fails).
 */

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

const TURN_API_BASE = "https://rtc.live.cloudflare.com/v1/turn/keys";

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

export function turnConfigured(env: TurnEnv): boolean {
  return !!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN);
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
  const keyId = env.TURN_KEY_ID!;
  const ttl = Math.min(Math.max(Number(env.TURN_TTL_SECONDS ?? 86400), 600), 86400);

  const hit = cache.get(keyId);
  if (!force && hit && hit.refreshAt > Date.now()) return hit.servers;

  try {
    const res = await fetchImpl(`${TURN_API_BASE}/${keyId}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    });
    if (!res.ok) throw new Error(`TURN API ${res.status}`);
    const body = (await res.json()) as { iceServers?: IceServerConfig[] };
    if (!body.iceServers?.length) throw new Error("TURN API returned no iceServers");
    const servers = body.iceServers.map((s) => ({
      urls: Array.isArray(s.urls) ? s.urls : [s.urls],
      username: s.username,
      credential: s.credential,
    }));
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

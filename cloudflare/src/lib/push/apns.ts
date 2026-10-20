/**
 * APNs VoIP sender (iOS) — port of the Rust `push::apns`.
 *
 * Apple needs its own transport for call wake-ups: Firebase cannot send
 * `apns-push-type: voip`. Auth is the token-based flow — an ES256 JWT signed
 * with the `.p8` key (`kid` = key id, `iss` = team id), reused for ~50 min.
 * VoIP pushes must be reported to CallKit by the app, so only call RINGS are
 * ever sent here (never "call ended" notices).
 */
import { signEs256 } from "./jwt";
import type { SendOutcome } from "./fcm";

export interface ApnsConfig {
  keyPem: string;
  keyId: string;
  teamId: string;
  /** App bundle id; ".voip" is appended when absent. */
  topic: string;
  sandbox: boolean;
}

const TOKEN_TTL_MS = 50 * 60_000;
let cached: { jwt: string; at: number; key: string } | null = null;

export function apnsConfigFrom(env: {
  APNS_KEY_PEM?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_TOPIC?: string;
  APNS_SANDBOX?: string;
}): ApnsConfig | null {
  const keyPem = env.APNS_KEY_PEM?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const topic = env.APNS_TOPIC?.trim();
  if (!keyPem || !keyId || !teamId || !topic) return null;
  return { keyPem, keyId, teamId, topic, sandbox: env.APNS_SANDBOX === "true" };
}

/** Apple addresses VoIP pushes to the bundle id + ".voip"; the bare id is refused. */
export function voipTopic(bundleId: string): string {
  const id = bundleId.trim();
  return id.endsWith(".voip") ? id : `${id}.voip`;
}

async function providerToken(cfg: ApnsConfig): Promise<string> {
  const now = Date.now();
  if (cached && cached.key === cfg.keyId && now - cached.at < TOKEN_TTL_MS) return cached.jwt;
  const jwt = await signEs256(
    cfg.keyPem,
    { iss: cfg.teamId, iat: Math.floor(now / 1000) },
    { kid: cfg.keyId },
  );
  cached = { jwt, at: now, key: cfg.keyId };
  return jwt;
}

export async function sendApnsVoip(
  cfg: ApnsConfig,
  deviceToken: string,
  payload: Record<string, unknown>,
  collapseId: string,
  expirationSecs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  let jwt: string;
  try {
    jwt = await providerToken(cfg);
  } catch {
    return "transient";
  }
  const base = cfg.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  try {
    const res = await fetchImpl(`${base}/3/device/${deviceToken}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-push-type": "voip",
        "apns-topic": voipTopic(cfg.topic),
        // VoIP pushes are time-critical.
        "apns-priority": "10",
        "apns-collapse-id": collapseId.slice(0, 64),
        // A ring nobody answered must not wake the phone minutes later.
        "apns-expiration": String(Math.floor(Date.now() / 1000) + expirationSecs),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 200) return "sent";
    if (res.status === 410) return "gone";
    return "transient";
  } catch {
    return "transient";
  }
}

/** Test seam. */
export function __clearApnsCache(): void {
  cached = null;
}

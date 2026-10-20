/**
 * FCM HTTP v1 sender (Android) — port of the Rust `push::fcm`.
 *
 * Auth is Google's service-account flow: a self-signed RS256 JWT exchanged for
 * an OAuth2 access token, cached until a minute before expiry. Messages are
 * DATA messages (the app owns presentation) at high priority, which is what
 * lets a call ring through Doze. Every failure is soft: push only accelerates
 * the WebSocket ring, it is never a prerequisite for a call.
 */
import { signRs256 } from "./jwt";

export type SendOutcome = "sent" | "gone" | "transient";

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SKEW_MS = 60_000;

let cached: { token: string; expiresAt: number; key: string } | null = null;

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

async function accessToken(sa: ServiceAccount, fetchImpl: typeof fetch): Promise<string> {
  const now = Date.now();
  if (cached && cached.key === sa.client_email && cached.expiresAt > now + SKEW_MS) {
    return cached.token;
  }
  const iat = Math.floor(now / 1000);
  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;
  const assertion = await signRs256(sa.private_key, {
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: tokenUri,
    iat,
    exp: iat + 3600,
  });
  const res = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`FCM token endpoint ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("FCM token response missing access_token");
  cached = {
    token: json.access_token,
    expiresAt: now + Math.min(json.expires_in ?? 3600, 3600) * 1000,
    key: sa.client_email,
  };
  return json.access_token;
}

/** FCM data values must be strings; null / undefined keys are dropped. */
export function stringifyData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

export async function sendFcmData(
  sa: ServiceAccount,
  deviceToken: string,
  data: Record<string, unknown>,
  collapseKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  let token: string;
  try {
    token = await accessToken(sa, fetchImpl);
  } catch {
    return "transient";
  }
  const strings = stringifyData(data);
  try {
    const res = await fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            android: { priority: "HIGH", collapse_key: collapseKey, data: strings },
            apns: {
              headers: { "apns-collapse-id": collapseKey },
              payload: { aps: { "content-available": 1, sound: "default" }, data: strings },
            },
          },
        }),
      },
    );
    if (res.status === 200) return "sent";
    if (res.status === 404 || res.status === 410) return "gone";
    return "transient";
  } catch {
    return "transient";
  }
}

/** Test seam. */
export function __clearFcmCache(): void {
  cached = null;
}

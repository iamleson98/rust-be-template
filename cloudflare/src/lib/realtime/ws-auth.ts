/**
 * Authentication shared by the two socket hubs (`/ws` chat, `/ws-call`).
 *
 * Runs inside Durable Objects, where there is no Next.js request context, so
 * it takes the bindings it needs explicitly.
 *
 * Credential sources, in order — every real client uses one of them:
 *   1. `?token=<jwt>`            mobile app / programmatic clients
 *   2. `Authorization: Bearer`   non-browser clients
 *   3. `access_token` cookie     browsers (sent automatically on the upgrade)
 *
 * Cookie-authenticated upgrades are also Origin-checked: a browser attaches
 * the victim's cookie to a socket opened by ANY site, so without this check a
 * malicious page could drive the signed-in user's chat and call sockets
 * (cross-site WebSocket hijacking). Token-authenticated clients carry their
 * own credential and send no Origin, so they skip it.
 */
import { jwtVerify } from "jose";

export interface WsUser {
  id: string;
  fullName: string;
  role: string;
  isStaff: boolean;
}

export interface WsAuthEnv {
  JWT_SECRET?: string;
  DB: D1Database;
  /** Extra comma-separated origins allowed to open cookie-authenticated sockets. */
  WS_ALLOWED_ORIGINS?: string;
}

export type WsAuthResult =
  { ok: true; user: WsUser; viaToken: boolean } | { ok: false; status: 401 | 403; reason: string };

/** Pull the credential out of the upgrade request. */
function credential(request: Request, url: URL): { token: string; viaToken: boolean } | null {
  const query = url.searchParams.get("token");
  if (query) return { token: query, viaToken: true };
  const authz = request.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    return { token: authz.slice(7).trim(), viaToken: true };
  }
  const m = /(?:^|;\s*)access_token=([^;]+)/.exec(request.headers.get("cookie") ?? "");
  return m ? { token: decodeURIComponent(m[1]!), viaToken: false } : null;
}

/** Is a browser-sent Origin one this deployment serves? */
export function originAllowed(origin: string, requestUrl: URL, extra: string | undefined): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === requestUrl.host) return true;
  return (extra ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((allowed) => {
      try {
        return new URL(allowed).host === host;
      } catch {
        return allowed === host;
      }
    });
}

export async function authenticateWs(request: Request, env: WsAuthEnv): Promise<WsAuthResult> {
  const url = new URL(request.url);
  const cred = credential(request, url);
  if (!cred) return { ok: false, status: 401, reason: "missing credential" };

  if (!cred.viaToken) {
    const origin = request.headers.get("origin");
    if (origin && !originAllowed(origin, url, env.WS_ALLOWED_ORIGINS)) {
      return { ok: false, status: 403, reason: "origin not allowed" };
    }
  }

  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 16)
    return { ok: false, status: 401, reason: "server misconfigured" };
  try {
    const { payload } = await jwtVerify(cred.token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: "backend",
      clockTolerance: 30,
    });
    if (payload.typ !== "access" || !payload.sub) {
      return { ok: false, status: 401, reason: "not an access token" };
    }
    const row = await env.DB.prepare(
      `SELECT id, full_name, role, status FROM "user" WHERE id = ? LIMIT 1`,
    )
      .bind(payload.sub)
      .first<{ id: string; full_name: string; role: string; status: string }>();
    if (!row || row.status !== "active") {
      return { ok: false, status: 401, reason: "account not active" };
    }
    return {
      ok: true,
      viaToken: cred.viaToken,
      user: {
        id: row.id,
        fullName: row.full_name,
        role: row.role,
        isStaff: row.role === "employee" || row.role === "admin",
      },
    };
  } catch {
    return { ok: false, status: 401, reason: "invalid token" };
  }
}

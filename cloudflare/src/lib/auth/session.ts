/**
 * Sessions — opaque refresh tokens (rotated on every use) + access JWT
 * delivered as HttpOnly cookies. Mirrors the Rust backend's semantics:
 *  - refresh token: `<uuid>.<64-hex-secret>`, DB stores HMAC-SHA256(secret)
 *  - rotation: old row revoked on every refresh
 *  - access token resolution: Authorization: Bearer → access_token cookie
 *  - revocation check on every authenticated request
 */
import { and, eq, gt } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db/client";
import { users, refreshTokens } from "@/lib/db/schema";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessTtlSecs,
  refreshTtlSecs,
  getJwtSecret,
  signAccessToken,
  verifyAccessToken,
} from "./jwt";

/** The Rust `SessionUser` DTO shape (camelCase + `type` + `hasPassword`). */
export function sessionUserOut(
  u: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    role: string;
    avatarUrl?: string | null;
    brandId?: string | null;
    status?: string;
    locale?: string | null;
  },
  brandName?: string | null,
) {
  return {
    id: u.id,
    type: u.role,
    role: u.role,
    name: u.fullName,
    email: u.email,
    phone: u.phone,
    avatarUrl: u.avatarUrl ?? null,
    brandId: u.brandId ?? null,
    brandName: brandName ?? null,
    employeeRole: u.role === "employee" || u.role === "admin" ? u.role : null,
    hasPassword: true,
  };
}

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  avatarUrl: string | null;
  brandId: string | null;
  locale: string;
}

function b64hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64hex(bytes);
}

async function hmacHex(message: string): Promise<string> {
  const key = await getJwtSecret();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return b64hex(new Uint8Array(sig));
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshId: string;
}

export async function issueSession(
  userId: string,
  ctx: { userAgent?: string | null; ip?: string | null },
): Promise<IssuedTokens> {
  const db = await getDb();
  const accessToken = await signAccessToken(userId);
  const refreshId = crypto.randomUUID();
  const secret = randomSecret();
  const tokenHash = await hmacHex(secret);
  const ttl = await refreshTtlSecs();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  await db.insert(refreshTokens).values({
    id: refreshId,
    userId,
    tokenHash,
    issuedAt: new Date().toISOString(),
    expiresAt,
    revoked: false,
    userAgent: ctx.userAgent ?? null,
    ip: ctx.ip ?? null,
  });
  return { accessToken, refreshToken: `${refreshId}.${secret}`, refreshId };
}

export async function rotateRefresh(
  presented: string,
  ctx: { userAgent?: string | null; ip?: string | null },
): Promise<(IssuedTokens & { userId: string }) | null> {
  const db = await getDb();
  const dot = presented.indexOf(".");
  if (dot <= 0) return null;
  const refreshId = presented.slice(0, dot);
  const secret = presented.slice(dot + 1);
  const tokenHash = await hmacHex(secret);
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.id, refreshId),
        eq(refreshTokens.tokenHash, tokenHash),
        eq(refreshTokens.revoked, false),
        gt(refreshTokens.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Rotation: revoke old, issue new.
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, refreshId));
  return { ...(await issueSession(row.userId, ctx)), userId: row.userId };
}

export async function revokeSession(refreshToken: string | null): Promise<void> {
  if (!refreshToken) return;
  const dot = refreshToken.indexOf(".");
  if (dot <= 0) return;
  const refreshId = refreshToken.slice(0, dot);
  const db = await getDb();
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, refreshId));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  const db = await getDb();
  await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));
}

/** Resolve the caller from Authorization header or access cookie. */
export async function currentUser(req: Request): Promise<SessionUser | null> {
  let token: string | null = null;
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) token = authz.slice(7).trim();
  if (!token) {
    const cookie = req.headers.get("cookie") ?? "";
    const m = /(?:^|;\s*)access_token=([^;]+)/.exec(cookie);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  const db = await getDb();
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      role: users.role,
      status: users.status,
      avatarUrl: users.avatarUrl,
      brandId: users.brandId,
      locale: users.locale,
    })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  const u = rows[0];
  if (!u || u.status !== "active") return null;
  return u;
}

/** Cookie attribute policy ─ cross-site-capable sessions ──────────────
 *
 * Default (`COOKIE_SAMESITE` unset or "lax"): `SameSite=Lax` (+`Secure` on
 * HTTPS) — first-party production (datxevui.com), identical to the Rust
 * backend's default.
 *
 * `COOKIE_SAMESITE=none` (set in `.dev.vars` for the embedded preview):
 * `SameSite=None; Secure; Partitioned` — the CHIPS combination
 * (https://privacycg.github.io/CHIPS/). The sandbox preview is served on a
 * proxied HTTPS origin and viewed inside the chat UI's cross-site iframe,
 * where browsers drop `SameSite=Lax` cookies entirely (the "logs in, then
 * bounces back to /login" loop). Partitioned cookies survive third-party
 * cookie blocking while staying double-keyed to the embedding site.
 * `Secure` is mandatory for `SameSite=None`; http://localhost is a
 * trustworthy origin so local dev keeps working.
 */
function requestIsHttps(req: Request): boolean {
  // Behind the preview/deploy proxies the worker sees http:// internally —
  // the original scheme only survives in x-forwarded-proto.
  const xfProto = req.headers.get("x-forwarded-proto");
  if (xfProto) return xfProto.split(",")[0].trim().toLowerCase() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export interface CookiePolicy {
  secure: boolean;
  sameSite: "Lax" | "None";
  partitioned: boolean;
}

export async function cookiePolicy(req: Request): Promise<CookiePolicy> {
  const env = await getEnv();
  const wantNone = (env.COOKIE_SAMESITE ?? "lax").trim().toLowerCase() === "none";
  if (wantNone) {
    // Cross-site-capable (embedded preview). Secure is required by the spec
    // and safe: the preview origin is always HTTPS (localhost is exempt).
    return { secure: true, sameSite: "None", partitioned: true };
  }
  return { secure: requestIsHttps(req), sameSite: "Lax", partitioned: false };
}

/** Cookie headers — mirrors the Rust COOKIE_* knobs, CHIPS-aware (see above). */
export async function sessionCookies(
  access: string,
  refresh: string,
  req: Request,
  opts: { secure?: boolean; domain?: string } = {},
): Promise<string[]> {
  const policy = await cookiePolicy(req);
  const aTtl = 900;
  const rTtl = 7 * 24 * 3600;
  const attrs = [
    `Path=/`,
    `HttpOnly`,
    `SameSite=${policy.sameSite}`,
    (opts.secure ?? policy.secure) ? "Secure" : "",
    policy.partitioned ? "Partitioned" : "",
    opts.domain ? `Domain=${opts.domain}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return [
    `${ACCESS_COOKIE}=${encodeURIComponent(access)}; ${attrs}; Max-Age=${aTtl}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(refresh)}; ${attrs}; Max-Age=${rTtl}`,
  ];
}

export async function clearSessionCookies(req: Request): Promise<string[]> {
  const policy = await cookiePolicy(req);
  const attrs = [
    `Path=/`,
    `HttpOnly`,
    `SameSite=${policy.sameSite}`,
    policy.secure ? "Secure" : "",
    policy.partitioned ? "Partitioned" : "",
    `Max-Age=0`,
  ]
    .filter(Boolean)
    .join("; ");
  return [`${ACCESS_COOKIE}=; ${attrs}`, `${REFRESH_COOKIE}=; ${attrs}`];
}

export { accessTtlSecs, refreshTtlSecs };

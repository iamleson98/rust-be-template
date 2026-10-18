/**
 * Sessions — opaque refresh tokens (rotated on every use) + access JWT
 * delivered as HttpOnly cookies. Mirrors the Rust backend's semantics:
 *  - refresh token: `<uuid>.<64-hex-secret>`, DB stores HMAC-SHA256(secret)
 *  - rotation: old row revoked on every refresh
 *  - access token resolution: Authorization: Bearer → access_token cookie
 *  - revocation check on every authenticated request
 */
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
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
export function sessionUserOut(u: {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: string;
  avatarUrl?: string | null;
  brandId?: string | null;
  status?: string;
  locale?: string | null;
}, brandName?: string | null) {
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
    if (m) token = decodeURIComponent(m[1]!);
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

/** Cookie headers — mirrors the Rust COOKIE_* knobs (Lax default). */
export function sessionCookies(
  access: string,
  refresh: string,
  opts: { secure?: boolean; domain?: string } = {},
): string[] {
  const aTtl = 900;
  const rTtl = 7 * 24 * 3600;
  const base = `Path=/; HttpOnly; SameSite=Lax`;
  const secure = opts.secure ?? true;
  const domain = opts.domain ? `; Domain=${opts.domain}` : "";
  return [
    `${ACCESS_COOKIE}=${encodeURIComponent(access)}; ${base}; Max-Age=${aTtl}${secure ? "; Secure" : ""}${domain}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(refresh)}; ${base}; Max-Age=${rTtl}${secure ? "; Secure" : ""}${domain}`,
  ];
}

export function clearSessionCookies(): string[] {
  const base = `Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  return [`${ACCESS_COOKIE}=; ${base}`, `${REFRESH_COOKIE}=; ${base}`];
}

export { accessTtlSecs, refreshTtlSecs };

/**
 * Sessions — opaque refresh tokens (rotated on every use) + access JWT
 * delivered as HttpOnly cookies. Mirrors the Rust backend (`auth_service.rs`,
 * `auth/refresh.rs`, `auth/cookies.rs`, `middleware/auth_extractor.rs`):
 *  - refresh token: `<uuid>.<64-hex-secret>`, the DB stores HMAC-SHA256(secret)
 *    keyed by the JWT secret; the `X-Client: mobile` app gets a longer lifetime
 *  - rotation: the old row is claimed with one conditional UPDATE, so two
 *    concurrent refreshes with the same token cannot both win
 *  - access token resolution: Authorization: Bearer → access_token cookie
 *  - logout revokes this device's session only; `all` revokes every session
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, getEnv } from "@/lib/db/client";
import { users, refreshTokens } from "@/lib/db/schema";
import { ApiError } from "./rbac";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessTtlSecs,
  getJwtSecret,
  isUuid,
  mobileRefreshTtlSecs,
  refreshTtlSecs,
  signAccessToken,
  verifyAccessToken,
} from "./jwt";
import { hmacSha256Hex, randomHex, timingSafeEqualStr } from "./crypto";
import { isAccessTokenRevoked, revokeAccessToken, revokeAllAccessTokens } from "./revocation";

export type SessionKind = "browser" | "mobile";

/** Rust `SessionKind::of`: the mobile app says so with `X-Client: mobile`. */
export function sessionKindOf(req: Request): SessionKind {
  return req.headers.get("x-client")?.trim().toLowerCase() === "mobile" ? "mobile" : "browser";
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
  /** Social sign-ins have no password until they set one. */
  hasPassword: boolean;
}

/** The Rust `SessionUser` DTO shape (camelCase + `type` + `hasPassword`). */
export function sessionUserOut(u: {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: string;
  avatarUrl?: string | null;
  brandId?: string | null;
  hasPassword?: boolean;
  passwordHash?: string | null;
}) {
  return {
    id: u.id,
    type: u.role,
    role: u.role,
    name: u.fullName,
    email: u.email,
    phone: u.phone,
    avatarUrl: u.avatarUrl ?? null,
    brandId: u.brandId ?? null,
    // The auth routes never look the brand up (Rust `SessionUser::from_model`).
    brandName: null,
    employeeRole: u.role === "employee" || u.role === "admin" ? u.role : null,
    hasPassword: u.hasPassword ?? !!u.passwordHash,
  };
}

// ── Request credentials ─────────────────────────────────────────────────

/**
 * Every value the request sends for cookie `name`, in order; values that do
 * not percent-decode are skipped. A browser can hold several cookies of one
 * name — a partitioned and an unpartitioned one, from before and after a
 * cookie-policy change — and sends them all.
 */
export function readCookies(req: Request, name: string): string[] {
  const values: string[] = [];
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      const value = decodeURIComponent(part.slice(eq + 1).trim());
      if (value) values.push(value);
    } catch {
      /* not percent-encoded: not ours */
    }
  }
  return values;
}

/** The first value of cookie `name`. */
export function readCookie(req: Request, name: string): string | null {
  return readCookies(req, name)[0] ?? null;
}

export function bearerToken(req: Request): string | null {
  const authz = req.headers.get("authorization")?.trim();
  if (!authz || !/^bearer /i.test(authz)) return null;
  return authz.slice(7).trim() || null;
}

/** Rust `bearer_or_cookie_token`: the Authorization header wins over the cookie. */
export function accessTokenOf(req: Request): string | null {
  return bearerToken(req) ?? readCookie(req, ACCESS_COOKIE);
}

/** The access tokens to try, best first: the Authorization header, else every access cookie. */
function accessTokensOf(req: Request): string[] {
  const bearer = bearerToken(req);
  return bearer ? [bearer] : readCookies(req, ACCESS_COOKIE);
}

// ── Refresh tokens ──────────────────────────────────────────────────────

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshId: string;
}

interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
  kind?: SessionKind;
}

/** HMAC-SHA-256 of the secret keyed by the JWT secret — what the DB stores. */
async function secretHash(secret: string): Promise<string> {
  return hmacSha256Hex(await getJwtSecret(), secret);
}

/** Rust `RefreshTokenValue::parse`: `<uuid>.<secret>`. */
export function parseRefreshToken(token: string): { id: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  return isUuid(id) ? { id, secret: token.slice(dot + 1) } : null;
}

export async function issueSession(
  userId: string,
  ctx: SessionContext = {},
): Promise<IssuedTokens> {
  const db = await getDb();
  const accessToken = await signAccessToken(userId);
  const refreshId = crypto.randomUUID();
  const secret = randomHex(32);
  const ttl = ctx.kind === "mobile" ? await mobileRefreshTtlSecs() : await refreshTtlSecs();
  await db.insert(refreshTokens).values({
    id: refreshId,
    userId,
    tokenHash: await secretHash(secret),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    revoked: false,
    userAgent: ctx.userAgent ?? null,
    ip: ctx.ip ?? null,
  });
  return { accessToken, refreshToken: `${refreshId}.${secret}`, refreshId };
}

/**
 * Rust `verified_refresh_token`: the token must parse, exist, be live and match
 * its stored hash. Messages and statuses are Rust's, one per failure.
 */
async function verifiedRefreshToken(presented: string): Promise<{ id: string; userId: string }> {
  const parsed = parseRefreshToken(presented);
  if (!parsed) throw new ApiError(400, "bad_request", "malformed refresh token");
  const db = await getDb();
  const row = (
    await db.select().from(refreshTokens).where(eq(refreshTokens.id, parsed.id)).limit(1)
  )[0];
  if (!row) throw new ApiError(401, "unauthorized", "unknown refresh token");
  if (row.revoked || row.expiresAt < new Date().toISOString()) {
    throw new ApiError(401, "unauthorized", "refresh token expired");
  }
  if (!timingSafeEqualStr(row.tokenHash, await secretHash(parsed.secret))) {
    throw new ApiError(401, "unauthorized", "refresh token mismatch");
  }
  return { id: row.id, userId: row.userId };
}

/**
 * Rust `try_revoke_refresh_token`: one conditional UPDATE claims a live token.
 * `ownerId` additionally pins the row to that user. Returns the owner, or
 * null when the token was already used, revoked or expired.
 */
async function claimRefreshToken(id: string, ownerId?: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(
      and(
        eq(refreshTokens.id, id),
        eq(refreshTokens.revoked, false),
        gt(refreshTokens.expiresAt, new Date().toISOString()),
        ownerId ? eq(refreshTokens.userId, ownerId) : undefined,
      ),
    )
    .returning({ userId: refreshTokens.userId });
  return rows[0]?.userId ?? null;
}

/** Rotate: revoke the presented token, issue a fresh pair (Rust `AuthService::refresh`). */
export async function refreshSession(
  presented: string,
  ctx: SessionContext = {},
): Promise<IssuedTokens & { userId: string }> {
  const { id } = await verifiedRefreshToken(presented);
  const userId = await claimRefreshToken(id);
  if (!userId) throw new ApiError(401, "unauthorized", "refresh token already used");
  return { ...(await issueSession(userId, ctx)), userId };
}

/**
 * Rotate the first of `candidates` that is a live refresh token (a stale
 * cookie of the same name may come first); throws the last refusal when
 * none is.
 */
export async function refreshAnySession(
  candidates: string[],
  ctx: SessionContext = {},
): Promise<IssuedTokens & { userId: string }> {
  let refusal: unknown = new ApiError(401, "unauthorized", "missing refresh token");
  for (const presented of candidates) {
    try {
      return await refreshSession(presented, ctx);
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 400 && e.status !== 401)) throw e;
      refusal = e;
    }
  }
  throw refusal;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.revoked, false)));
}

/**
 * Rust `AuthService::logout` / `logout_by_refresh_token`.
 *
 * Signed in: revoke only the session this device presented (its refresh token
 * and its access token), or everything with `all`. Not signed in but holding a
 * refresh token: verify it and revoke just that session. Failures never reach
 * the caller — the response clears the cookies either way.
 */
export async function logoutSession(opts: {
  userId: string | null;
  refreshToken: string | null;
  accessToken: string | null;
  all: boolean;
}): Promise<void> {
  const { userId, refreshToken, accessToken } = opts;
  if (!userId) {
    if (!refreshToken) return;
    try {
      await claimRefreshToken((await verifiedRefreshToken(refreshToken)).id);
    } catch {
      // expired / unknown / forged: nothing to revoke
    }
    return;
  }
  if (opts.all) {
    await revokeAllSessions(userId);
    await revokeAllAccessTokens(userId);
    return;
  }
  // Pinned to the caller: a client cannot revoke someone else's session by
  // posting a token id that is not theirs.
  const parsed = refreshToken ? parseRefreshToken(refreshToken) : null;
  if (parsed) await claimRefreshToken(parsed.id, userId);
  const claims = accessToken ? await verifyAccessToken(accessToken) : null;
  if (accessToken && claims?.sub === userId) await revokeAccessToken(accessToken, claims);
}

// ── Current user ────────────────────────────────────────────────────────

/** Resolve the caller from the Authorization header or the access cookie. */
export async function currentUser(req: Request): Promise<SessionUser | null> {
  let claims: Awaited<ReturnType<typeof verifyAccessToken>> = null;
  for (const token of accessTokensOf(req)) {
    const verified = await verifyAccessToken(token);
    if (verified && !(await isAccessTokenRevoked(token, verified))) {
      claims = verified;
      break;
    }
  }
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
      hasPassword: sql<boolean>`(${users.passwordHash} IS NOT NULL)`.mapWith(Boolean),
    })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  const u = rows[0];
  return u && u.status === "active" ? u : null;
}

// ── Cookies ─────────────────────────────────────────────────────────────

/** Cookie attribute policy ─ cross-site-capable sessions ──────────────
 *
 * Default (`COOKIE_SAMESITE` unset or "lax"): `SameSite=Lax` (+`Secure` on
 * HTTPS) — first-party production (datxevui.com), identical to the Rust
 * backend's default. `strict` is honoured too. `COOKIE_SECURE=true|false`
 * forces the Secure flag (Rust default: off); `COOKIE_DOMAIN` sets a Domain.
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
  sameSite: "Lax" | "Strict" | "None";
  partitioned: boolean;
  domain?: string;
}

export async function cookiePolicy(req: Request): Promise<CookiePolicy> {
  const env = await getEnv();
  const sameSite = (env.COOKIE_SAMESITE ?? "lax").trim().toLowerCase();
  const domain = env.COOKIE_DOMAIN?.trim() || undefined;
  if (sameSite === "none") {
    // Cross-site-capable (embedded preview). Secure is required by the spec
    // and safe: the preview origin is always HTTPS (localhost is exempt).
    return { secure: true, sameSite: "None", partitioned: true, domain };
  }
  const forced = env.COOKIE_SECURE?.trim().toLowerCase();
  return {
    secure: forced === "true" ? true : forced === "false" ? false : requestIsHttps(req),
    sameSite: sameSite === "strict" ? "Strict" : "Lax",
    partitioned: false,
    domain,
  };
}

function cookieAttributes(policy: CookiePolicy, maxAge: number): string {
  return [
    "Path=/",
    "HttpOnly",
    `SameSite=${policy.sameSite}`,
    policy.secure ? "Secure" : "",
    policy.partitioned ? "Partitioned" : "",
    policy.domain ? `Domain=${policy.domain}` : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** Set-Cookie values for a session; lifetimes follow `JWT_*_TTL_SECS` like the tokens do. */
export async function sessionCookies(
  access: string,
  refresh: string,
  req: Request,
): Promise<string[]> {
  const policy = await cookiePolicy(req);
  return [
    `${ACCESS_COOKIE}=${encodeURIComponent(access)}; ${cookieAttributes(policy, await accessTtlSecs())}`,
    `${REFRESH_COOKIE}=${encodeURIComponent(refresh)}; ${cookieAttributes(policy, await refreshTtlSecs())}`,
    ...expiredCookies(otherPartition(policy)),
  ];
}

/**
 * The policy of the session cookies a browser may still hold from before a
 * cookie-policy change: partitioned and unpartitioned cookies of one name
 * live side by side, and the stale pair would be sent with the live one.
 */
function otherPartition(policy: CookiePolicy): CookiePolicy {
  return policy.partitioned
    ? { ...policy, sameSite: "Lax", partitioned: false }
    : { ...policy, secure: true, sameSite: "None", partitioned: true };
}

const expiredCookies = (policy: CookiePolicy): string[] => {
  const attrs = cookieAttributes(policy, 0);
  return [`${ACCESS_COOKIE}=; ${attrs}`, `${REFRESH_COOKIE}=; ${attrs}`];
};

/** Expire both cookies, in both partitions; Path/Domain must match the ones they were set with. */
export async function clearSessionCookies(req: Request): Promise<string[]> {
  const policy = await cookiePolicy(req);
  return [...expiredCookies(policy), ...expiredCookies(otherPartition(policy))];
}

/**
 * Rust `AuthResponse`: `{ user, expires_at, tokens? }`. A fresh session also
 * sets the cookies; the raw token pair is added only for `X-Client: mobile`.
 */
export async function authResponse(
  req: Request,
  user: Parameters<typeof sessionUserOut>[0],
  session?: IssuedTokens,
): Promise<Response> {
  const headers = new Headers();
  if (session) {
    for (const c of await sessionCookies(session.accessToken, session.refreshToken, req)) {
      headers.append("set-cookie", c);
    }
  }
  const mobile = session && sessionKindOf(req) === "mobile";
  return Response.json(
    {
      user: sessionUserOut(user),
      expires_at: new Date(Date.now() + (await accessTtlSecs()) * 1000).toISOString(),
      ...(mobile
        ? { tokens: { access_token: session.accessToken, refresh_token: session.refreshToken } }
        : {}),
    },
    { headers },
  );
}

export { accessTtlSecs, refreshTtlSecs };

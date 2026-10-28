/**
 * JWT access tokens — HS256 via `jose` (WebCrypto-based, Workers-safe).
 * Claims mirror the Rust backend (`auth/jwt.rs`): { sub, iss, iat, exp, typ: "access" }
 * with `iss` from `JWT_ISSUER` (default "backend"), 30 s of clock leeway and only
 * HS256 accepted.
 */
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/db/client";

export interface AccessClaims {
  sub: string;
  iss: string;
  typ: "access";
  iat: number;
  exp: number;
}

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

/** Seconds of clock skew tolerated when verifying (Rust `leeway = 30`). */
export const JWT_LEEWAY_SECS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID.test(s);

export async function getJwtSecret(): Promise<Uint8Array> {
  const env = await getEnv();
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET must be set (>= 16 chars)");
  }
  return new TextEncoder().encode(secret);
}

/** A positive integer env var, else the default (Rust `env_parse(..).unwrap_or(..)`). */
function secsFromEnv(value: string | undefined, fallback: number): number {
  const n = Number(value ?? "");
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function accessTtlSecs(): Promise<number> {
  return secsFromEnv((await getEnv()).JWT_ACCESS_TTL_SECS, 900);
}

export async function refreshTtlSecs(): Promise<number> {
  return secsFromEnv((await getEnv()).JWT_REFRESH_TTL_SECS, 7 * 24 * 3600);
}

/** Refresh lifetime of the mobile app (`X-Client: mobile`), renewed on every refresh. */
export async function mobileRefreshTtlSecs(): Promise<number> {
  return secsFromEnv((await getEnv()).JWT_MOBILE_REFRESH_TTL_SECS, 90 * 24 * 3600);
}

async function issuer(): Promise<string> {
  return (await getEnv()).JWT_ISSUER || "backend";
}

export async function signAccessToken(userId: string): Promise<string> {
  const ttl = await accessTtlSecs();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: "access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(await issuer())
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    // Not in the Rust token: without it two tokens minted in the same second are
    // byte-identical, and revoking one device's would revoke the other's.
    .setJti(crypto.randomUUID())
    .sign(await getJwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const iss = await issuer();
    const { payload } = await jwtVerify(token, await getJwtSecret(), {
      issuer: iss,
      algorithms: ["HS256"],
      clockTolerance: JWT_LEEWAY_SECS,
      requiredClaims: ["sub", "exp", "iat"],
    });
    if (payload.typ !== "access" || !payload.sub || !isUuid(payload.sub)) return null;
    return {
      sub: payload.sub,
      iss,
      typ: "access",
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch {
    return null;
  }
}

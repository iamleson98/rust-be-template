/**
 * JWT access tokens — HS256 via `jose` (WebCrypto-based, Workers-safe).
 * Claims mirror the Rust backend: { sub, iss: "backend", iat, exp, typ: "access" }.
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

export async function getJwtSecret(): Promise<Uint8Array> {
  const env = await getEnv();
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET must be set (>= 16 chars)");
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(userId: string): Promise<string> {
  const env = await getEnv();
  const ttl = Number(env.JWT_ACCESS_TTL_SECS ?? "") || 900;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: "access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer("backend")
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(await getJwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, await getJwtSecret(), {
      issuer: "backend",
      clockTolerance: 30,
    });
    if (payload.typ !== "access" || !payload.sub) return null;
    return {
      sub: payload.sub,
      iss: "backend",
      typ: "access",
      iat: (payload.iat as number) ?? 0,
      exp: (payload.exp as number) ?? 0,
    };
  } catch {
    return null;
  }
}

export async function accessTtlSecs(): Promise<number> {
  const env = await getEnv();
  return Number(env.JWT_ACCESS_TTL_SECS ?? "") || 900;
}

export async function refreshTtlSecs(): Promise<number> {
  const env = await getEnv();
  return Number(env.JWT_REFRESH_TTL_SECS ?? "") || 7 * 24 * 3600;
}

/**
 * Password hashing — PBKDF2-SHA256 via WebCrypto for new hashes.
 *
 * Workers' WebCrypto caps PBKDF2 at 100 000 iterations, so that is what new
 * hashes use. Users imported from the Rust backend still carry Argon2id PHC
 * hashes (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`); those are verified
 * with a pure-JS Argon2 (Workers cannot compile WASM from bytes at runtime)
 * and `needsRehash` tells the login route to upgrade them to PBKDF2 on the
 * first successful sign-in, so the slower path runs once per legacy user.
 *
 * Self-describing format for new hashes: pbkdf2$<iterations>$<saltB64>$<hashB64>
 */
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { timingSafeEqual } from "./crypto";

const ITERATIONS = 100_000;
const KEY_LEN = 32;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto unavailable");
  return c.subtle;
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_LEN * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/** PHC base64 is standard base64 with the padding stripped. */
function fromPhcB64(s: string): Uint8Array {
  return fromB64(s + "=".repeat((4 - (s.length % 4)) % 4));
}

/** Upper bounds so a tampered/imported hash cannot burn the CPU budget. */
const ARGON2_MAX_MEM_KIB = 64 * 1024;
const ARGON2_MAX_TIME = 6;

async function verifyArgon2id(password: string, stored: string): Promise<boolean> {
  // ["", "argon2id", "v=19", "m=19456,t=2,p=1", salt, hash]
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[1] !== "argon2id" || parts[2] !== "v=19") return false;
  const params = Object.fromEntries(
    parts[3].split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const m = Number(params.m);
  const t = Number(params.t);
  const p = Number(params.p);
  if (![m, t, p].every((n) => Number.isInteger(n) && n >= 1)) return false;
  if (m > ARGON2_MAX_MEM_KIB || t > ARGON2_MAX_TIME || p > 4) return false;
  const salt = fromPhcB64(parts[4]);
  const expected = fromPhcB64(parts[5]);
  const actual = await argon2idAsync(new TextEncoder().encode(password), salt, {
    t,
    m,
    p,
    dkLen: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

/** True when `stored` is not a current-format hash and should be re-hashed on login. */
export function needsRehash(stored: string | null): boolean {
  if (!stored) return false;
  if (stored.startsWith("$argon2")) return true;
  const iterations = parseInt(stored.split("$")[1] ?? "", 10);
  return stored.startsWith("pbkdf2$") && iterations < ITERATIONS;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("$argon2id$")) return verifyArgon2id(password, stored);
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

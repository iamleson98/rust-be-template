/**
 * Minimal JWT signing with WebCrypto, for the two push providers' service
 * auth (Google: RS256, Apple: ES256). No dependencies, runs in Workers and
 * Durable Objects.
 */

const enc = new TextEncoder();

export function base64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === "string" ? enc.encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----") → DER bytes. */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Service-account JSON often carries the PEM with literal "\n" sequences. */
export function normalizePem(pem: string): string {
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

async function sign(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  key: CryptoKey,
  algorithm: AlgorithmIdentifier | EcdsaParams,
): Promise<string> {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign(algorithm, key, enc.encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}

export async function signRs256(
  pem: string,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(normalizePem(pem)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return sign({ alg: "RS256", typ: "JWT", ...header }, claims, key, "RSASSA-PKCS1-v1_5");
}

/** ES256 over P-256. WebCrypto already emits the raw r||s form JOSE wants. */
export async function signEs256(
  pem: string,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(normalizePem(pem)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return sign({ alg: "ES256", typ: "JWT", ...header }, claims, key, {
    name: "ECDSA",
    hash: "SHA-256",
  });
}

/**
 * Authenticity checks for the chat-bot platform webhooks — port of
 * `routes/webhooks/auth.rs`. Every platform signs (or tokens) its calls;
 * a missing secret rejects the request rather than letting it through.
 */
import { ApiError } from "@/lib/auth/rbac";

const enc = new TextEncoder();

const reject = (platform: string, reason: string) =>
  new ApiError(401, "unauthorized", `${platform} webhook rejected: ${reason}`);

/** Constant-time comparison: equal-length digests are compared, so neither length nor prefix leaks. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all(
    [a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v)))),
  );
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string, bytes: number): Uint8Array | null {
  if (hex.length !== bytes * 2 || !/^[0-9a-f]+$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

export async function hmacSha256Hex(secret: string, data: BufferSource): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, data));
}

/** Telegram: the `secret_token` set with `setWebhook`, echoed in a header. */
export async function verifyTelegram(headers: Headers, secret: string | undefined): Promise<void> {
  if (!secret) throw reject("telegram", "TELEGRAM_WEBHOOK_SECRET is not configured");
  const provided = headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!(await safeEqual(secret, provided))) throw reject("telegram", "invalid secret token");
}

/** Messenger's GET subscription handshake. */
export async function verifyMessengerChallenge(token: string, expected: string | undefined) {
  if (!expected) throw reject("messenger", "MESSENGER_VERIFY_TOKEN is not configured");
  if (!(await safeEqual(expected, token))) throw reject("messenger", "invalid verify token");
}

/** Messenger: `X-Hub-Signature-256: sha256=<HMAC of the raw body>`. */
export async function verifyMessenger(
  headers: Headers,
  body: Uint8Array,
  secret: string | undefined,
) {
  if (!secret) throw reject("messenger", "MESSENGER_APP_SECRET is not configured");
  const header = headers.get("x-hub-signature-256") ?? "";
  const provided = header.startsWith("sha256=") ? header.slice(7) : "";
  const computed = await hmacSha256Hex(secret, body as BufferSource);
  if (!(await safeEqual(computed, provided)))
    throw reject("messenger", "invalid X-Hub-Signature-256");
}

/** Zalo: `X-Zalo-Signature` is the hex HMAC of the raw body, sometimes prefixed `str=`. */
export async function verifyZalo(headers: Headers, body: Uint8Array, secret: string | undefined) {
  if (!secret) throw reject("zalo", "ZALO_OA_SECRET is not configured");
  const provided = (headers.get("x-zalo-signature") ?? "").replace(/^str=/, "").toLowerCase();
  const computed = await hmacSha256Hex(secret, body as BufferSource);
  if (!(await safeEqual(computed, provided))) throw reject("zalo", "invalid X-Zalo-Signature");
}

/** Discord: Ed25519 over `timestamp ‖ raw body` with the application's public key. */
export async function verifyDiscord(
  headers: Headers,
  body: Uint8Array,
  publicKeyHex: string | undefined,
) {
  if (!publicKeyHex) throw reject("discord", "DISCORD_PUBLIC_KEY is not configured");
  const pk = fromHex(publicKeyHex, 32);
  if (!pk) throw reject("discord", "public key must be 32 bytes of hex");
  const sig = fromHex(headers.get("x-signature-ed25519") ?? "", 64);
  if (!sig) throw reject("discord", "signature must be 64 bytes of hex");
  const message = new Uint8Array([
    ...enc.encode(headers.get("x-signature-timestamp") ?? ""),
    ...body,
  ]);
  let ok = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      pk as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sig as BufferSource,
      message as BufferSource,
    );
  } catch {
    throw reject("discord", "invalid public key bytes");
  }
  if (!ok) throw reject("discord", "Ed25519 signature mismatch");
}

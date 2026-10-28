import { describe, expect, it } from "vitest";
import {
  hmacSha256Hex,
  verifyDiscord,
  verifyMessenger,
  verifyMessengerChallenge,
  verifyTelegram,
  verifyZalo,
} from "@/lib/webhooks";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const rejected = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { status: number; message: string };
  }
  throw new Error("expected a rejection");
};

describe("webhook authenticity (Rust routes/webhooks/auth.rs)", () => {
  it("HMAC-SHA256 matches the known vector", async () => {
    expect(
      await hmacSha256Hex("key", enc.encode("The quick brown fox jumps over the lazy dog")),
    ).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("a missing secret rejects instead of letting the call through", async () => {
    for (const p of [
      verifyTelegram(new Headers(), undefined),
      verifyMessenger(new Headers(), enc.encode("{}"), undefined),
      verifyMessengerChallenge("t", undefined),
      verifyZalo(new Headers(), enc.encode("{}"), undefined),
      verifyDiscord(new Headers(), enc.encode("{}"), undefined),
    ]) {
      expect((await rejected(p)).status).toBe(401);
    }
  });

  it("Telegram compares the secret token", async () => {
    await verifyTelegram(new Headers({ "x-telegram-bot-api-secret-token": "s3cret" }), "s3cret");
    expect((await rejected(verifyTelegram(new Headers(), "s3cret"))).message).toBe(
      "telegram webhook rejected: invalid secret token",
    );
  });

  it("Messenger checks the verify token and the sha256= body signature", async () => {
    await verifyMessengerChallenge("tok", "tok");
    await rejected(verifyMessengerChallenge("other", "tok"));
    const body = enc.encode('{"entry":[]}');
    const sig = await hmacSha256Hex("app", body);
    await verifyMessenger(new Headers({ "x-hub-signature-256": `sha256=${sig}` }), body, "app");
    await rejected(verifyMessenger(new Headers({ "x-hub-signature-256": sig }), body, "app"));
    await rejected(
      verifyMessenger(
        new Headers({ "x-hub-signature-256": `sha256=${sig}` }),
        enc.encode("{}"),
        "app",
      ),
    );
  });

  it("Zalo accepts the bare or str=-prefixed, any-case signature", async () => {
    const body = enc.encode('{"event_name":"follow"}');
    const sig = await hmacSha256Hex("oa", body);
    await verifyZalo(new Headers({ "x-zalo-signature": sig }), body, "oa");
    await verifyZalo(new Headers({ "x-zalo-signature": `str=${sig.toUpperCase()}` }), body, "oa");
    await rejected(verifyZalo(new Headers({ "x-zalo-signature": "00" }), body, "oa"));
  });

  it("Discord verifies Ed25519 over timestamp + body", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicKey = hex(await crypto.subtle.exportKey("raw", pair.publicKey));
    const body = enc.encode('{"type":1}');
    const timestamp = "1700000000";
    const signed = new Uint8Array([...enc.encode(timestamp), ...body]);
    const signature = hex(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, signed));
    const headers = (sig: string) =>
      new Headers({ "x-signature-ed25519": sig, "x-signature-timestamp": timestamp });

    await verifyDiscord(headers(signature), body, publicKey);
    expect(
      (await rejected(verifyDiscord(headers(signature), enc.encode('{"type":2}'), publicKey)))
        .message,
    ).toContain("Ed25519 signature mismatch");
    expect((await rejected(verifyDiscord(headers("abcd"), body, publicKey))).message).toContain(
      "64 bytes",
    );
    expect((await rejected(verifyDiscord(headers(signature), body, "zz"))).message).toContain(
      "32 bytes",
    );
  });
});

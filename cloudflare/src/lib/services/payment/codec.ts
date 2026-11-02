/** Signing and encoding the providers need: HMAC, percent-encoding, transaction refs and the VietQR (EMVCo) payload. */

// ── Crypto + encoding helpers ────────────────────────────────────

const enc = new TextEncoder();

export async function hmacHex(
  hash: "SHA-256" | "SHA-512",
  secret: string,
  data: string | Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const sig = await crypto.subtle.sign("HMAC", key, bytes as BufferSource);
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (the signatures are public hex, but compare like Rust anyway). */
export function constantTimeEq(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Rust `percent_encode`: unreserved bytes pass, everything else is `%XX` (upper-case). */
export function percentEncode(s: string): string {
  let out = "";
  for (const b of enc.encode(s)) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9\-_.~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** `VX{timestamp_millis}{6 random upper-case alphanumerics}`. */
export function genTxnRef(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `VX${Date.now()}${Array.from(bytes, (b) => chars[b % chars.length]).join("")}`;
}

/** The memo embedded in the QR / order info. */
export const buildMemo = (bookingCode: string) => `VEXEVN-${bookingCode.toUpperCase()}`;

export const nowIso = () => new Date().toISOString();

// ── VietQR payload ───────────────────────────────────────────────

function tlv(tag: string, value: string): string {
  return `${tag}${value.length.toString().padStart(2, "0")}${value}`;
}

/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF). */
export function crc16(data: string): number {
  let crc = 0xffff;
  for (const byte of enc.encode(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** The NAPAS VietQR payload (Rust `build_vietqr_string`). */
export function buildVietQr(
  bankBin: string,
  accountNo: string,
  amount: number,
  memo: string,
  billNo: string,
): string {
  const merchantAccount =
    tlv("00", "A000000727") + tlv("01", `${bankBin}${accountNo}`) + tlv("02", "5769");
  let payload =
    tlv("00", "01") + // payload format indicator
    tlv("01", "12") + // point of initiation: dynamic
    tlv("26", merchantAccount) +
    tlv("52", "4111") + // MCC: transportation
    tlv("53", "704") + // currency: VND
    tlv("54", String(amount)) +
    tlv("58", "VN") + // country
    tlv("62", tlv("01", billNo) + tlv("08", memo));
  payload += "6304";
  return payload + crc16(payload).toString(16).toUpperCase().padStart(4, "0");
}

/** Map a Vietnamese bank BIN to its display name; unknown banks show the BIN. */
export function bankNameForBin(bin: string): string {
  const names: Record<string, string> = {
    "970403": "Sacombank",
    "970407": "Techcombank",
    "970409": "BIDV",
    "970415": "VietinBank",
    "970416": "ACB",
    "970418": "Agribank",
    "970422": "MBBank",
    "970423": "TPBank",
    "970429": "Eximbank",
    "970432": "VPBank",
    "970436": "Vietcombank",
  };
  return names[bin] ?? bin;
}

/** Formatting + misc utilities ported from the Rust backend. */

/** Format an integer with vi-VN thousand-separators (e.g. 250000 → "250.000"). */
export function fmtVnd(n: number): string {
  const s = Math.round(n).toString();
  let out = "";
  const len = s.length;
  for (let i = 0; i < len; i++) {
    if (i > 0 && (len - i) % 3 === 0) out += ".";
    out += s[i];
  }
  return out;
}

/** Generate a human-readable booking code: {PREFIX}-XXXXXX (base32, no confusing chars). */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function genBookingCode(prefix: string): string {
  let code = `${prefix}-`;
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) code += CODE_CHARS[b % CODE_CHARS.length];
  return code;
}

/** First-letter-of-each-slug-segment brand prefix ("phuong-trang" → "PT"). */
export function brandPrefix(slug: string): string {
  const p = slug
    .split("-")
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return p || "BK";
}

/** Normalize E.164-ish Vietnamese phone numbers. */
export function normalizePhone(p: string): string {
  const trimmed = p.trim();
  if (trimmed.startsWith("+84")) return trimmed;
  if (trimmed.startsWith("0")) return `+84${trimmed.slice(1)}`;
  return trimmed;
}

/** Strip Vietnamese tones + lowercase ("Hà Nội" → "ha noi"). */
export function stripTones(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/** Compact form ("ha noi" → "hanoi") used for exact-match boosts. */
export function compactNoTones(s: string): string {
  return stripTones(s).replace(/\s+/g, "");
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** "YYYY-MM-DD" for a Date (UTC). */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Call admission policy (pure, so it can be tested without a Durable Object). */

/** `CALL_ALLOWED_COUNTRIES`: comma list, default Vietnam; `*` or empty disables the gate. */
export function countryAllowed(country: string | null, allowed: string | undefined): boolean {
  const list = (allowed ?? "VN")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (list.length === 0 || list.includes("*")) return true;
  // No country (local dev, internal calls) or Cloudflare's "unknown": do not lock a real user out.
  if (!country || country.toUpperCase() === "XX") return true;
  return list.includes(country.toUpperCase());
}

/**
 * A schedule's amenities as stored: `schedule.amenities` holds a JSON array
 * of keys (`["wifi","water"]`); older rows may hold them comma-separated.
 * Shared by the trip cards and the admin schedule form.
 */

/** The keys a `schedule.amenities` text holds: a JSON array of strings, else comma-separated. */
export function parseAmenities(raw: string | null | undefined): string[] {
  if (raw == null || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
  } catch {
    /* not JSON: comma-separated */
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** The stored form of `keys`. */
export const formatAmenities = (keys: readonly string[]): string => JSON.stringify(keys);

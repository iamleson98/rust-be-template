/**
 * The pure helpers behind the public trip cards — port of the helper half
 * of `public_service.rs` (labels, amenities, vehicle type, the ISO
 * departure / arrival stamps) and of `trip_search::minutes_of`.
 */
import { childPrice, type ChildPolicy } from "./fares";
import { departureInstant } from "./trip-time";

// ── Labels ───────────────────────────────────────────────────────

/** Vietnamese label for a vehicle type code (Rust `vehicle_type_label`). */
export function vehicleTypeLabel(code: string): string {
  switch (code) {
    case "limousine":
      return "Limousine";
    case "sleeper":
      return "Giường nằm";
    case "semi_sleeper":
    case "semi-sleeper":
      return "Giường nằm đơn";
    case "minivan":
      return "Minivan";
    default:
      return "Ghế ngồi";
  }
}

/** Amenity key → Vietnamese label; empty for a key without one (Rust `amenity_label`). */
export function amenityLabel(key: string): string {
  switch (key) {
    case "wifi":
      return "WiFi";
    case "ac":
      return "Điều hòa";
    case "water":
      return "Nước uống";
    case "charging":
      return "Cắm sạc";
    case "blanket":
      return "Chăn mền";
    default:
      return "";
  }
}

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

// ── Vehicle type ─────────────────────────────────────────────────

export interface VehicleTypeRow {
  id: string;
  code: string;
  label: string;
}

/**
 * A schedule's vehicle class as `[code, label]`: its own catalog entry, else
 * the bus layout's legacy type string (labelled by a catalog entry with that
 * code when `catalog` has one, else the static map), else `standard`.
 * `catalog` holds only the types the caller loaded (Rust `resolve_vehicle_type`).
 */
export function resolveVehicleType(
  vehicleTypeId: string | null,
  layoutVehicleType: string | null,
  catalog: Map<string, VehicleTypeRow>,
): [code: string, label: string] {
  const own = vehicleTypeId ? catalog.get(vehicleTypeId) : undefined;
  if (own) return [own.code, own.label];
  const code = layoutVehicleType ?? "standard";
  const listed = [...catalog.values()].find((v) => v.code.toLowerCase() === code.toLowerCase());
  return [code, listed?.label ?? vehicleTypeLabel(code)];
}

// ── Times ────────────────────────────────────────────────────────

/** A whole decimal number as Rust's `i32::from_str` reads it. */
function integer(text: string): number | null {
  return /^[+-]?\d+$/.test(text) ? Number(text) : null;
}

/**
 * `HH:MM` → minutes past midnight. Like Rust, only the first two characters
 * of the minutes part count (`8:305` is 8:30) and `HH` may be one digit.
 */
export function minutesOf(hhmm: string): number | null {
  const text = hhmm.trim();
  const colon = text.indexOf(":");
  if (colon < 0) return null;
  const minutes = text.slice(colon + 1);
  const h = integer(text.slice(0, colon));
  const m = integer(minutes.length >= 2 ? minutes.slice(0, 2) : minutes);
  if (h == null || m == null || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** `2026-08-05T08:30:00` from the trip's date and the schedule's time; null without a time. */
export function departureIso(departureDate: string, departureTime: string): string | null {
  const [date = "", datePart = ""] = departureDate.split(/T(.*)/s);
  if (date === "") return null;
  const time = departureTime !== "" ? departureTime : datePart;
  return time === "" ? null : `${date}T${time}:00`;
}

/**
 * When the trip reaches its last timed stop: the departure date with that
 * stop's `HH:MM`, one day later when the clock time is not after the
 * departure's (the trip crossed midnight). Null when either is unreadable.
 */
export function arrivalIso(
  departureDate: string,
  departureHhmm: string,
  arrivalHhmm: string,
): string | null {
  const clock = (t: string) => {
    const colon = t.indexOf(":");
    if (colon < 0) return null;
    const h = integer(t.slice(0, colon));
    const m = integer(t.slice(colon + 1));
    return h == null || m == null ? null : h * 60 + m;
  };
  const arrives = clock(arrivalHhmm);
  if (arrives == null) return null;
  const departs = clock(departureHhmm) ?? Number.NEGATIVE_INFINITY;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(departureDate.split("T")[0] ?? "");
  if (!day) return null;
  const [y, mo, d] = day.slice(1).map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d));
  if (base.getUTCFullYear() !== y || base.getUTCMonth() !== mo - 1 || base.getUTCDate() !== d)
    return null;
  if (arrives <= departs) base.setUTCDate(base.getUTCDate() + 1);
  return `${base.toISOString().slice(0, 10)}T${arrivalHhmm}:00`;
}

/** Still on sale: scheduled and not yet departed (Rust `on_sale`). */
export function onSale(
  trip: { status: string; departureDate: string; actualDepartureAt: string | null },
  schedule: { departureTime: string },
  now: Date = new Date(),
): boolean {
  if (trip.status !== "scheduled") return false;
  const departs = departureInstant(
    trip.departureDate,
    schedule.departureTime,
    trip.actualDepartureAt,
  );
  return !(departs && departs <= now);
}

// ── Prices ───────────────────────────────────────────────────────

/** What a child pays for a standard seat; 0 without child tickets (Rust `standard_child_price`). */
export function standardChildPrice(
  schedule: { basePriceAdult: number; basePriceChild: number | null },
  policy: ChildPolicy | null,
): number {
  const fare = { adult: schedule.basePriceAdult, child: schedule.basePriceChild };
  return childPrice(fare.adult, fare, policy) ?? 0;
}

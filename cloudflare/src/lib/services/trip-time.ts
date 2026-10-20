/**
 * When a trip leaves, and what that means for refunds — port of
 * `trip_time.rs`.
 *
 * Schedules are wall-clock times in Vietnam (UTC+7, no daylight saving):
 * the trip row carries a plain `YYYY-MM-DD` date and the schedule a plain
 * `HH:MM`, so the UTC instant has to be derived. (Reading them as UTC, as
 * an earlier port did, shifted every departure by seven hours.)
 */

/** Vietnam's UTC offset. */
const LOCAL_OFFSET_MS = 7 * 3_600_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** The UTC instant of a Vietnamese wall-clock time; null for impossible dates/times. */
function localToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC rolls 31 Feb over to March; a real calendar date round-trips.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d)
    return null;
  return new Date(probe.getTime() - LOCAL_OFFSET_MS);
}

/**
 * The UTC instant a trip departs: the driver's recorded departure when the
 * trip has left, otherwise the schedule's wall-clock time on the trip date.
 * Null when neither can be read.
 */
export function departureInstant(
  departureDate: string,
  scheduleTime: string,
  actualDepartureAt?: string | null,
): Date | null {
  const actual = actualDepartureAt?.trim();
  if (actual) {
    if (RFC3339_RE.test(actual)) {
      const t = new Date(actual);
      if (!Number.isNaN(t.getTime())) return t;
    }
    // A zone-less timestamp is local wall-clock time like everything else.
    const naive = NAIVE_RE.exec(actual);
    if (naive) {
      const [y, mo, d, h, mi, s] = naive.slice(1).map(Number);
      const t = localToUtc(y, mo, d, h, mi, s);
      if (t) return t;
    }
  }
  const dateMatch = DATE_RE.exec(departureDate.split("T")[0] ?? "");
  const timeMatch = HHMM_RE.exec(scheduleTime.trim());
  if (!dateMatch || !timeMatch) return null;
  const [y, mo, d] = dateMatch.slice(1).map(Number);
  return localToUtc(
    y,
    mo,
    d,
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    Number(timeMatch[3] ?? 0),
  );
}

/** An instant as RFC 3339 with whole seconds (`2026-10-10T01:30:00Z`). */
export function rfc3339(t: Date): string {
  return t.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Today's date in Vietnam (`YYYY-MM-DD`), the calendar trips are dated by. */
export function localToday(now: Date = new Date()): string {
  return new Date(now.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

/** When the Vietnamese calendar day `date` (`YYYY-MM-DD`) starts, in UTC. */
export function localDayStart(date: string): Date | null {
  const m = DATE_RE.exec(date.trim());
  if (!m) return null;
  return localToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0);
}

/** The Vietnamese calendar day (`YYYY-MM-DD`) an RFC 3339 instant falls on. */
export function localDate(instant: string): string | null {
  const text = instant.trim();
  if (!RFC3339_RE.test(text)) return null;
  const t = new Date(text);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Share of the paid amount handed back when cancelling `hoursUntil` hours
 * before departure: more than 24 h → 90 %, more than 4 h → 50 %, otherwise
 * nothing.
 */
export function refundPercent(hoursUntil: number): number {
  if (hoursUntil > 24) return 90;
  if (hoursUntil > 4) return 50;
  return 0;
}

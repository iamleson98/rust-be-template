import { describe, expect, it } from "vitest";
import {
  departureInstant,
  localDate,
  localDayStart,
  localToday,
  refundPercent,
  rfc3339,
} from "@/lib/services/trip-time";

/** Port of the `trip_time.rs` unit tests. */

const at = (s: string) => new Date(s);
const iso = (d: Date | null) => (d ? rfc3339(d) : null);

describe("departureInstant", () => {
  it("reads the schedule time as Vietnam wall clock", () => {
    // 08:30 in UTC+7 is 01:30 UTC.
    expect(iso(departureInstant("2026-10-10", "08:30"))).toBe("2026-10-10T01:30:00Z");
    // Early-morning departures land on the previous UTC day.
    expect(iso(departureInstant("2026-10-10", "05:00"))).toBe("2026-10-09T22:00:00Z");
  });

  it("accepts seconds and a datetime for the date", () => {
    expect(iso(departureInstant("2026-10-10T00:00:00", "21:15:00"))).toBe("2026-10-10T14:15:00Z");
  });

  it("prefers a recorded departure", () => {
    expect(iso(departureInstant("2026-10-10", "08:30", "2026-10-10T02:10:00Z"))).toBe(
      "2026-10-10T02:10:00Z",
    );
    // Zone-less recorded times are local.
    expect(iso(departureInstant("2026-10-10", "08:30", "2026-10-10T09:00:00"))).toBe(
      "2026-10-10T02:00:00Z",
    );
    // Garbage falls back to the schedule.
    expect(iso(departureInstant("2026-10-10", "08:30", "soon"))).toBe("2026-10-10T01:30:00Z");
    expect(iso(departureInstant("2026-10-10", "08:30", "  "))).toBe("2026-10-10T01:30:00Z");
  });

  it("is null for unreadable input", () => {
    expect(departureInstant("tomorrow", "08:30")).toBeNull();
    expect(departureInstant("2026-10-10", "late")).toBeNull();
    expect(departureInstant("", "")).toBeNull();
    expect(departureInstant("2026-02-31", "08:30")).toBeNull();
    expect(departureInstant("2026-10-10", "25:00")).toBeNull();
  });
});

describe("Vietnamese calendar days", () => {
  it("day starts and dates", () => {
    expect(iso(localDayStart("2026-10-10"))).toBe("2026-10-09T17:00:00Z");
    expect(localDayStart("10/10/2026")).toBeNull();
    // 23:30 UTC is already the next morning in Vietnam.
    expect(localDate("2026-10-09T23:30:00Z")).toBe("2026-10-10");
    expect(localDate("2026-10-09T23:30:00.123Z")).toBe("2026-10-10");
    expect(localDate("yesterday")).toBeNull();
  });

  it("today rolls over at 17:00 UTC", () => {
    expect(localToday(at("2026-10-11T16:59:59Z"))).toBe("2026-10-11");
    expect(localToday(at("2026-10-11T17:00:00Z"))).toBe("2026-10-12");
  });
});

describe("refundPercent", () => {
  it("tiers: >24 h → 90, >4 h → 50, otherwise 0 (boundaries exclusive)", () => {
    expect(refundPercent(72)).toBe(90);
    expect(refundPercent(24.1)).toBe(90);
    expect(refundPercent(24)).toBe(50);
    expect(refundPercent(4.1)).toBe(50);
    expect(refundPercent(4)).toBe(0);
    expect(refundPercent(-3)).toBe(0);
  });
});

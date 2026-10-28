import { describe, expect, it } from "vitest";
import { runsOnDate, scheduleRunsOn, sellWindow } from "@/lib/services/trip-warmer";
import { localToday } from "@/lib/services/trip-time";

/** Port of the unit tests of `trip_warmer.rs`. */

describe("localToday", () => {
  it("rolls over at 17:00 UTC (midnight in Vietnam)", () => {
    expect(localToday(new Date("2026-10-11T16:59:59Z"))).toBe("2026-10-11");
    expect(localToday(new Date("2026-10-11T17:00:00Z"))).toBe("2026-10-12");
  });
});

describe("sellWindow", () => {
  it("covers consecutive days", () => {
    const w = sellWindow("2026-10-11", 14);
    expect(w).toHaveLength(14);
    expect(w[0]).toBe("2026-10-11");
    expect(w[13]).toBe("2026-10-24");
  });

  it("crosses a month boundary", () => {
    const w = sellWindow("2026-10-20", 14);
    expect(w.slice(11)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("is empty for a malformed day or no days", () => {
    expect(sellWindow("not-a-date", 14)).toEqual([]);
    expect(sellWindow("2026-10-11", 0)).toEqual([]);
  });
});

describe("scheduleRunsOn", () => {
  const sched = (
    daysOfWeek: string | null,
    effectiveFrom: string | null = null,
    effectiveTo: string | null = null,
  ) => ({
    daysOfWeek,
    effectiveFrom,
    effectiveTo,
  });

  it("runs daily without a mask", () => {
    expect(scheduleRunsOn(sched(null), "2026-10-12")).toBe(true);
  });

  it("respects the 7-character weekday mask, Monday first", () => {
    const mondayOnly = sched("1000000");
    expect(scheduleRunsOn(mondayOnly, "2026-10-12")).toBe(true); // Mon
    expect(scheduleRunsOn(mondayOnly, "2026-10-13")).toBe(false); // Tue
    const weekend = sched("0000011");
    expect(scheduleRunsOn(weekend, "2026-10-17")).toBe(true); // Sat
    expect(scheduleRunsOn(weekend, "2026-10-18")).toBe(true); // Sun
    expect(scheduleRunsOn(weekend, "2026-10-16")).toBe(false); // Fri
  });

  it("treats a malformed mask as daily", () => {
    expect(scheduleRunsOn(sched("111"), "2026-10-12")).toBe(true);
    expect(scheduleRunsOn(sched("abcdefg"), "2026-10-12")).toBe(true);
    expect(scheduleRunsOn(sched("1111111 "), "2026-10-12")).toBe(true);
  });

  it("respects the effective window, both ends inclusive", () => {
    const s = sched(null, "2026-10-14", "2026-10-20");
    expect(scheduleRunsOn(s, "2026-10-13")).toBe(false);
    expect(scheduleRunsOn(s, "2026-10-14")).toBe(true);
    expect(scheduleRunsOn(s, "2026-10-20")).toBe(true);
    expect(scheduleRunsOn(s, "2026-10-21")).toBe(false);
  });

  it("reads the weekday mask once for every caller (the old json_array_length('1111100') was 0)", () => {
    expect(runsOnDate("1111100", "2026-10-17")).toBe(false); // Saturday
    expect(runsOnDate("1111100", "2026-10-16")).toBe(true); // Friday
  });

  it("still reads the JSON array the port's admin form used to write (Sunday = 1)", () => {
    expect(runsOnDate("[1]", "2026-10-18")).toBe(true);
    expect(runsOnDate("[1]", "2026-10-19")).toBe(false);
    expect(runsOnDate("[]", "2026-10-19")).toBe(true);
    expect(runsOnDate("[oops", "2026-10-19")).toBe(true);
  });
});

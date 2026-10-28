import { describe, expect, it } from "vitest";
import { advanceSlot, catchUp, nextOccurrence } from "@/lib/scheduler";

// Port of the Rust `scheduler.rs` tests.
const VN = 420;
const NY = -300;
const utc = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(Date.UTC(y, m - 1, d, h, min));

describe("nextOccurrence", () => {
  it("is today when the slot is still ahead", () => {
    // 01:00 +07 on Sep 2 → 02:00 +07 the same morning
    expect(nextOccurrence(utc(2026, 9, 1, 18, 0), 2, 0, VN)).toEqual(utc(2026, 9, 1, 19, 0));
  });

  it("is tomorrow when today's slot passed", () => {
    expect(nextOccurrence(utc(2026, 9, 1, 20, 0), 2, 0, VN)).toEqual(utc(2026, 9, 2, 19, 0));
  });

  it("is strictly after `after`", () => {
    const now = utc(2026, 9, 1, 19, 0);
    const slot = nextOccurrence(now, 2, 0, VN);
    expect(slot.getTime()).toBeGreaterThan(now.getTime());
    expect(slot).toEqual(utc(2026, 9, 2, 19, 0));
  });

  it("wraps the day at the midnight boundary", () => {
    expect(nextOccurrence(utc(2026, 9, 1, 16, 59), 0, 0, VN)).toEqual(utc(2026, 9, 1, 17, 0));
  });

  it("handles a negative offset", () => {
    expect(nextOccurrence(utc(2026, 9, 1, 3, 0), 2, 0, NY)).toEqual(utc(2026, 9, 1, 7, 0));
  });
});

describe("advanceSlot", () => {
  it("adds the interval days at the same wall-clock time", () => {
    expect(advanceSlot(utc(2026, 9, 1, 19, 0), 14, 2, 0, VN)).toEqual(utc(2026, 9, 15, 19, 0));
  });

  it("crosses a month boundary", () => {
    expect(advanceSlot(utc(2026, 8, 18, 19, 0), 14, 2, 0, VN)).toEqual(utc(2026, 9, 1, 19, 0));
  });

  it("steps one day for a daily job", () => {
    expect(advanceSlot(utc(2026, 9, 1, 19, 0), 1, 2, 0, VN)).toEqual(utc(2026, 9, 2, 19, 0));
  });
});

describe("catchUp", () => {
  it("leaves a slot that is still ahead alone", () => {
    expect(catchUp(utc(2026, 9, 15, 19, 0), 14, 2, 0, VN, utc(2026, 9, 1, 0, 0))).toEqual(
      utc(2026, 9, 15, 19, 0),
    );
  });

  it("skips missed intervals instead of replaying them", () => {
    const next = catchUp(utc(2026, 9, 1, 19, 0), 14, 2, 0, VN, utc(2026, 9, 22, 0, 0));
    expect(next).toEqual(utc(2026, 9, 29, 19, 0));
  });

  it("recovers a daily job in one step", () => {
    const next = catchUp(utc(2026, 8, 1, 19, 0), 1, 2, 0, VN, utc(2026, 8, 31, 0, 0));
    expect(next).toEqual(utc(2026, 8, 31, 19, 0));
  });

  it("is stable: advance after catching up lands one interval later", () => {
    const now = utc(2026, 9, 1, 0, 0);
    const armed = nextOccurrence(now, 2, 0, VN);
    const fired = catchUp(armed, 14, 2, 0, VN, now);
    expect(fired).toEqual(armed);
    expect(advanceSlot(fired, 14, 2, 0, VN).getTime()).toBe(fired.getTime() + 14 * 86_400_000);
  });
});

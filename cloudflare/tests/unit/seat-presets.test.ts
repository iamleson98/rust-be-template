import { describe, expect, it } from "vitest";
import { findPreset, presetCatalog } from "@/lib/services/admin-out";
import { isSellable, validateSeatPlan, type SeatPlan } from "@/lib/services/seat-plan";

/** Port of the `seat_plan_presets.rs` unit tests (the catalog infer_id is CLI-only in Rust). */

const count = (plan: SeatPlan, deck: number, kind: string) =>
  plan.decks[deck].cells.filter((c) => c.kind === kind).length;
const plan = (id: string) => findPreset(id)!.plan;

describe("seat plan presets", () => {
  it("every preset is a valid plan with its declared capacity", () => {
    const expected: Array<[string, number]> = [
      ["car_4", 4],
      ["car_7", 6],
      ["limo_9", 9],
      ["limo_11", 11],
      ["minibus_15", 15],
      ["seat_29", 29],
      ["seat_45", 45],
      ["sleeper_38_wc", 38],
      ["sleeper_40", 40],
      ["sleeper_42", 42],
      ["sleeper_44", 44],
      ["sleeper_46", 46],
      ["limo_bed_34", 34],
      ["cabin_24", 24],
      ["cabin_22", 22],
      ["cabin_22_double", 22],
      ["cabin_22_plain", 22],
      ["cabin_21", 21],
      ["cabin_20", 20],
    ];
    const all = presetCatalog();
    expect(all).toHaveLength(expected.length);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    for (const [id, capacity] of expected) {
      const p = all.find((x) => x.id === id);
      expect(p, `${id} missing`).toBeTruthy();
      expect(p!.capacity, `${id} capacity`).toBe(capacity);
      expect(validateSeatPlan(p!.plan), id).toBeNull();
      const drivers = p!.plan.decks.reduce((n, _d, i) => n + count(p!.plan, i, "driver"), 0);
      expect(drivers, `${id} has exactly one driver`).toBe(1);
      expect(count(p!.plan, 0, "driver"), `${id}: the driver is on the lower deck`).toBe(1);
    }
  });

  it("sleeper_40 matches the real coach", () => {
    const p = plan("sleeper_40");
    expect(p.decks).toHaveLength(2);
    expect([p.decks[0].rows, p.decks[0].cols]).toEqual([7, 5]);
    expect(count(p, 0, "bed")).toBe(20);
    expect(count(p, 1, "bed")).toBe(20);
    expect(p.decks[0].cells.filter((c) => c.row === 7).map((c) => c.col)).toEqual([1, 2, 3, 4, 5]);
    const first = p.decks[0].cells.find((c) => c.kind === "bed")!;
    expect([first.row, first.col, first.label]).toEqual([2, 1, "A01"]);
    expect(p.decks[1].cells.find((c) => c.kind === "bed")!.label).toBe("B01");
    expect(count(p, 1, "driver")).toBe(0);
    expect(count(p, 1, "stairs")).toBe(1);
  });

  it("a sleeper with WC puts the toilet on the lower deck only", () => {
    const p = plan("sleeper_38_wc");
    expect([count(p, 0, "bed"), count(p, 1, "bed")]).toEqual([19, 19]);
    expect([count(p, 0, "wc"), count(p, 1, "wc")]).toEqual([1, 0]);
  });

  it("limousine cabins split between the decks like the real vehicles", () => {
    const split = (id: string) =>
      plan(id).decks.map((d) => d.cells.filter((c) => isSellable(c.kind)).length);
    expect(split("cabin_24")).toEqual([12, 12]);
    expect(split("cabin_22")).toEqual([10, 12]);
    expect(split("cabin_22_double")).toEqual([11, 11]);
    expect(count(plan("cabin_22"), 0, "wc")).toBe(1);
    const dbl = plan("cabin_22_double");
    expect([count(dbl, 0, "cabin_double"), count(dbl, 1, "cabin_double")]).toEqual([1, 0]);
  });

  it("coaches and vans end in a full-width rear bench", () => {
    const rear = (id: string) => {
      const d = plan(id).decks[0];
      return d.cells.filter((c) => c.row === d.rows).length;
    };
    expect(rear("seat_29")).toBe(5);
    expect(rear("seat_45")).toBe(5);
    expect(rear("minibus_15")).toBe(4);
    expect(rear("limo_9")).toBe(3);
  });

  it("sleeper_<n> resolves for even n in 30–50 only", () => {
    expect(findPreset("sleeper_36")?.capacity).toBe(36);
    expect(findPreset("sleeper_28")).toBeNull();
    expect(findPreset("sleeper_41")).toBeNull();
    expect(findPreset("nope")).toBeNull();
  });
});

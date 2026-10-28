import { describe, expect, it } from "vitest";
import { pointsFor, resolveTier, TIERS } from "@/lib/services/loyalty";

// Port of the Rust `loyalty_service.rs` tests.
describe("loyalty tiers", () => {
  it("are ascending and start at zero points", () => {
    for (let i = 1; i < TIERS.length; i++)
      expect(TIERS[i - 1]!.minPoints).toBeLessThan(TIERS[i]!.minPoints);
    expect(TIERS[0]!.minPoints).toBe(0);
  });

  it("resolve to the band the balance falls in", () => {
    expect([0, 999, 1_000, 4_999, 5_000, 19_999, 20_000, 999_999].map(resolveTier)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it("have no next tier at the top", () => {
    expect(resolveTier(1_000_000) + 1).toBeGreaterThanOrEqual(TIERS.length);
  });

  it("earn one point per 10,000 VND, floored per booking", () => {
    expect(pointsFor(9_999)).toBe(0);
    expect(pointsFor(350_000)).toBe(35);
    expect(pointsFor(355_000)).toBe(35);
  });
});

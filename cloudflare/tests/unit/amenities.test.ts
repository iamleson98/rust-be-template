import { describe, expect, it } from "vitest";
import { formatAmenities, parseAmenities } from "@/lib/amenities";

describe("schedule amenities", () => {
  it("reads the stored JSON array, and the older comma-separated text", () => {
    expect(parseAmenities('["wifi","water"]')).toEqual(["wifi", "water"]);
    expect(parseAmenities("wifi, water")).toEqual(["wifi", "water"]);
    expect(parseAmenities("")).toEqual([]);
    expect(parseAmenities(null)).toEqual([]);
  });

  it("writes what it reads back", () => {
    for (const keys of [[], ["water"], ["wifi", "blanket", "water"]]) {
      expect(parseAmenities(formatAmenities(keys))).toEqual(keys);
    }
  });
});

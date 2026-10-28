import { describe, expect, it } from "vitest";
import { parseContours, parseLocations } from "@/lib/services/routing";

describe("parseLocations (Rust parse_locs)", () => {
  it("reads lat,lon pairs and skips empty segments", () => {
    expect(parseLocations("21.03,105.85;16.05,108.2;")).toEqual([
      [21.03, 105.85],
      [16.05, 108.2],
    ]);
  });

  it("ignores extra coordinates and trims blanks", () => {
    expect(parseLocations(" 1.5 , 2.5 ,9")).toEqual([[1.5, 2.5]]);
  });

  it("answers 400 for a malformed coordinate", () => {
    expect(() => parseLocations("abc,1")).toThrow(/bad lat/);
    expect(() => parseLocations("1,abc")).toThrow(/bad lon/);
    expect(() => parseLocations("1")).toThrow(/bad loc/);
  });
});

describe("parseContours", () => {
  it("defaults to 15, 30, 60 minutes", () => {
    expect(parseContours(null)).toEqual([15, 30, 60]);
  });

  it("drops entries that are not whole numbers", () => {
    expect(parseContours("10, x,20,-5,3.5")).toEqual([10, 20]);
    expect(parseContours("x")).toEqual([]);
  });
});

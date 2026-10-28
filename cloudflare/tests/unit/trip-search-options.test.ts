import { describe, expect, it } from "vitest";
import { parseSearchOptions, parseSort } from "@/lib/services/trip-search-options";
import { queryReader, uuidParam } from "@/lib/query";

/** The query-string rules of `trip_search::{Sort, Filters, Options}` and the search handlers. */

const parse = (qs: string, geo = false) =>
  parseSearchOptions(new URLSearchParams(`date=2026-10-12&${qs}`), geo);
const rejects = (qs: string, message: RegExp, geo = false) => {
  expect(() => parse(qs, geo)).toThrow(message);
};

describe("sort", () => {
  it("defaults to departure in the city search and distance in the coordinate search", () => {
    expect(parseSort(undefined, false)).toBe("departure");
    expect(parseSort(undefined, true)).toBe("distance");
  });

  it("knows price, rating and departure everywhere, and trims", () => {
    for (const geo of [false, true]) {
      expect(parseSort("price", geo)).toBe("price");
      expect(parseSort(" rating ", geo)).toBe("rating");
      expect(parseSort("departure", geo)).toBe("departure");
    }
  });

  it("knows distance only in the coordinate search; anything else is the default", () => {
    expect(parseSort("distance", true)).toBe("distance");
    expect(parseSort("distance", false)).toBe("departure");
    expect(parseSort("cheapest", false)).toBe("departure");
    expect(parseSort("cheapest", true)).toBe("distance");
  });
});

describe("options", () => {
  it("defaults to 20 results from the start, one seat, no filters", () => {
    expect(parse("")).toEqual({
      date: "2026-10-12",
      limit: 20,
      offset: 0,
      sort: "departure",
      minSeats: 1,
      departAfter: null,
      filters: {
        vehicleTypes: [],
        brands: [],
        priceMin: undefined,
        priceMax: undefined,
        hours: [],
        minRating: undefined,
        plentyOfSeats: false,
        amenities: [],
      },
    });
  });

  it("clamps the page size to 1..100 and the seats to at least 1", () => {
    expect(parse("limit=0").limit).toBe(1);
    expect(parse("limit=1000").limit).toBe(100);
    expect(parse("minSeats=0").minSeats).toBe(1);
    expect(parse("minSeats=-4").minSeats).toBe(1);
    expect(parse("minSeats=3").minSeats).toBe(3);
    expect(parse("offset=40").offset).toBe(40);
  });

  it("requires a real calendar date", () => {
    const bad = (date: string) =>
      expect(() => parseSearchOptions(new URLSearchParams({ date }), false)).toThrow(
        "date must be YYYY-MM-DD",
      );
    bad("12/10/2026");
    bad("2026-02-30");
    bad("tomorrow");
    bad("");
    expect(parseSearchOptions(new URLSearchParams({ date: " 2026-10-12 " }), false).date).toBe(
      "2026-10-12",
    );
  });

  it("reads the filters, dropping blanks and non-positive bounds", () => {
    const { filters } = parse(
      "vehicleTypes=limousine, sleeper&brands=a,,b&priceMin=100000&priceMax=0&minRating=4.5&plentyOfSeats=true&amenities=wifi,ac&hours=0-6,18-24",
    );
    expect(filters).toEqual({
      vehicleTypes: ["limousine", "sleeper"],
      brands: ["a", "b"],
      priceMin: 100_000,
      priceMax: undefined,
      hours: [
        [0, 6],
        [18, 24],
      ],
      minRating: 4.5,
      plentyOfSeats: true,
      amenities: ["wifi", "ac"],
    });
    expect(parse("minRating=0").filters.minRating).toBeUndefined();
  });

  it("rejects an unknown hour band, naming it", () => {
    rejects("hours=6-12,noon", /hours: unknown band "noon" \(use 0-6, 6-12, 12-18, 18-24\)/);
  });

  it("reads departAfter as HH:MM", () => {
    expect(parse("departAfter=06:30").departAfter).toBe(390);
    expect(parse("departAfter=").departAfter).toBeNull();
    expect(parse("departAfter=%20").departAfter).toBeNull();
    rejects("departAfter=morning", /departAfter must be HH:MM/);
    rejects("departAfter=24:00", /departAfter must be HH:MM/);
    rejects("departAfter=06:30:00", /departAfter must be HH:MM/);
  });

  it("answers 400 to a value that cannot be read, as the typed Rust query does", () => {
    for (const bad of [
      "limit=abc",
      "limit=",
      "limit=-1",
      "offset=1.5",
      "minSeats=x",
      "priceMin=1.5",
    ])
      rejects(bad, /Failed to deserialize query string/);
    rejects("minRating=high", /minRating/);
    rejects("plentyOfSeats=yes", /plentyOfSeats/);
    expect(() => parseSearchOptions(new URLSearchParams(""), false)).toThrow(/date: missing field/);
  });

  it("checks hours before the date, as the Rust handler does", () => {
    expect(() => parseSearchOptions(new URLSearchParams("date=bad&hours=nope"), false)).toThrow(
      /hours/,
    );
  });
});

describe("query reader", () => {
  const q = (qs: string) => queryReader(new URLSearchParams(qs));

  it("reads numbers the way Rust parses them", () => {
    expect(q("a=%2B5").u64("a")).toBe(5);
    expect(q("a=18446744073709551615").u64("a")).toBe(18_446_744_073_709_552_000);
    expect(() => q("a=18446744073709551616").u64("a")).toThrow();
    expect(q("a=-7").i64("a")).toBe(-7);
    expect(q("a=1e3").f64("a")).toBe(1000);
    expect(q("a=.5").f64("a")).toBe(0.5);
    expect(() => q("a=1,5").f64("a")).toThrow();
    expect(q("").u64("a")).toBeUndefined();
  });

  it("requires what the handler cannot do without", () => {
    expect(() => q("").required.f64("fromLat")).toThrow("fromLat: missing field");
    expect(q("from=").required.string("from")).toBe("");
  });

  it("normalises a UUID and refuses anything else", () => {
    const id = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    expect(uuidParam(id, "id")).toBe(id.toLowerCase());
    expect(uuidParam(id.replaceAll("-", ""), "id")).toBe(id.toLowerCase());
    expect(() => uuidParam("not-a-uuid", "id")).toThrow(/invalid UUID/);
    expect(() => uuidParam("", "brand_id")).toThrow(/brand_id/);
  });
});

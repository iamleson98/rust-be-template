import { describe, expect, it } from "vitest";
import {
  boardingMinutes,
  buildFacets,
  emptyResults,
  keep,
  pageResults,
  sortBuilt,
  type Built,
  type TripCard,
} from "@/lib/services/trip-results";
import type { Filters, SearchOptions } from "@/lib/services/trip-search-options";

/** Port of the filter / facet / sort / paging behaviour of `trip_search::results`. */

let n = 0;
function built(
  over: Partial<TripCard> = {},
  boardsAt = 8 * 60,
  distanceKm: number | null = null,
): Built {
  n++;
  const card: TripCard = {
    tripId: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    scheduleId: "s",
    departureDate: "2026-10-12",
    status: "scheduled",
    availableSeats: 10,
    totalSeats: 40,
    routeId: "r",
    routeName: "A - B",
    brandName: "Alpha",
    brandSlug: "alpha",
    fromName: "A",
    fromLat: 0,
    fromLon: 0,
    toName: "B",
    toLat: 0,
    toLon: 0,
    minPrice: 100_000,
    maxPrice: 150_000,
    priceAdult: 100_000,
    priceChild: 0,
    vehicleType: "standard",
    vehicleTypeLabel: "Ghế ngồi",
    amenities: [],
    ...over,
  };
  return { card, boardsAt, distanceKm };
}

const noFilters: Filters = {
  vehicleTypes: [],
  brands: [],
  hours: [],
  plentyOfSeats: false,
  amenities: [],
};
const options = (over: Partial<SearchOptions> = {}): SearchOptions => ({
  date: "2026-10-12",
  limit: 20,
  offset: 0,
  sort: "departure",
  minSeats: 1,
  departAfter: null,
  filters: noFilters,
  ...over,
});

describe("boardingMinutes", () => {
  it("boards at departure without a pickup time", () => {
    expect(boardingMinutes("08:30", undefined)).toBe(510);
    expect(boardingMinutes("garbage", undefined)).toBe(0);
  });

  it("boards at the pickup stop's time, past midnight when the bus gets there after the day rolled over", () => {
    expect(boardingMinutes("08:30", "09:10")).toBe(550);
    expect(boardingMinutes("23:00", "00:20")).toBe(24 * 60 + 20);
    expect(boardingMinutes("08:30", "not a time")).toBe(510);
  });
});

describe("filters", () => {
  const pass = (card: Partial<TripCard>, f: Partial<Filters>, boardsAt?: number) =>
    keep(built(card, boardsAt), { ...noFilters, ...f });

  it("keeps everything without filters", () => {
    expect(pass({}, {})).toBe(true);
  });

  it("filters by vehicle type and operator", () => {
    expect(pass({ vehicleType: "limousine" }, { vehicleTypes: ["limousine", "sleeper"] })).toBe(
      true,
    );
    expect(pass({ vehicleType: "standard" }, { vehicleTypes: ["limousine"] })).toBe(false);
    expect(pass({ brandSlug: "alpha" }, { brands: ["beta"] })).toBe(false);
  });

  it("bounds the cheapest seat, inclusive", () => {
    expect(pass({ minPrice: 100_000 }, { priceMin: 100_000, priceMax: 100_000 })).toBe(true);
    expect(pass({ minPrice: 99_999 }, { priceMin: 100_000 })).toBe(false);
    expect(pass({ minPrice: 100_001 }, { priceMax: 100_000 })).toBe(false);
  });

  it("filters by boarding hour band, wrapping past midnight", () => {
    const night: Filters["hours"] = [[0, 6]];
    expect(pass({}, { hours: night }, 5 * 60 + 59)).toBe(true);
    expect(pass({}, { hours: night }, 6 * 60)).toBe(false);
    expect(pass({}, { hours: night }, 24 * 60 + 30)).toBe(true);
  });

  it("filters by operator rating, treating none as 0", () => {
    expect(pass({ brandRating: 4.5 }, { minRating: 4.5 })).toBe(true);
    expect(pass({ brandRating: 4.4 }, { minRating: 4.5 })).toBe(false);
    expect(pass({}, { minRating: 1 })).toBe(false);
  });

  it("wants more than five seats for plenty of seats", () => {
    expect(pass({ availableSeats: 6 }, { plentyOfSeats: true })).toBe(true);
    expect(pass({ availableSeats: 5 }, { plentyOfSeats: true })).toBe(false);
  });

  it("needs all the amenities asked for", () => {
    expect(pass({ amenities: ["wifi", "ac"] }, { amenities: ["wifi"] })).toBe(true);
    expect(pass({ amenities: ["wifi"] }, { amenities: ["wifi", "ac"] })).toBe(false);
  });
});

describe("facets", () => {
  it("are empty for no trips", () => {
    expect(buildFacets([])).toEqual({
      matches: 0,
      priceMin: 0,
      priceMax: 0,
      brands: [],
      vehicleTypes: [],
      hours: [
        { key: "0-6", label: "0-6", count: 0 },
        { key: "6-12", label: "6-12", count: 0 },
        { key: "12-18", label: "12-18", count: 0 },
        { key: "18-24", label: "18-24", count: 0 },
      ],
      amenities: [],
      plentyOfSeats: 0,
    });
  });

  it("count every option over all trips, most common first then by label", () => {
    const all = [
      built({ brandSlug: "b", brandName: "Beta", minPrice: 90_000, maxPrice: 120_000 }, 7 * 60),
      built({ brandSlug: "a", brandName: "Alpha", amenities: ["wifi", "ac"] }, 8 * 60),
      built(
        { brandSlug: "a", brandName: "Alpha", amenities: ["wifi"], availableSeats: 3 },
        20 * 60,
      ),
      built({
        brandSlug: "",
        brandName: "",
        vehicleType: "limousine",
        vehicleTypeLabel: "Limousine",
      }),
    ];
    const f = buildFacets(all);
    expect(f.matches).toBe(4);
    expect(f.priceMin).toBe(90_000);
    expect(f.priceMax).toBe(150_000);
    expect(f.brands).toEqual([
      { key: "a", label: "Alpha", count: 2 },
      { key: "b", label: "Beta", count: 1 },
    ]);
    expect(f.vehicleTypes).toEqual([
      { key: "standard", label: "Ghế ngồi", count: 3 },
      { key: "limousine", label: "Limousine", count: 1 },
    ]);
    expect(f.hours.map((h) => h.count)).toEqual([0, 3, 0, 1]);
    expect(f.amenities).toEqual([
      { key: "wifi", label: "WiFi", count: 2 },
      { key: "ac", label: "Điều hòa", count: 1 },
    ]);
    expect(f.plentyOfSeats).toBe(3);
  });

  it("label a brand without a name by its slug, and an unknown amenity by nothing", () => {
    const f = buildFacets([built({ brandSlug: "x", brandName: "", amenities: ["sauna"] })]);
    expect(f.brands[0]).toEqual({ key: "x", label: "x", count: 1 });
    expect(f.amenities[0]).toEqual({ key: "sauna", label: "", count: 1 });
  });

  it("order equal counts by label byte-wise", () => {
    const f = buildFacets([
      built({ brandSlug: "z", brandName: "Zeta" }),
      built({ brandSlug: "e", brandName: "Éta" }),
    ]);
    expect(f.brands.map((b) => b.label)).toEqual(["Zeta", "Éta"]);
  });
});

describe("sort", () => {
  it("orders by boarding time, then trip id", () => {
    const a = built({}, 600);
    const b = built({}, 480);
    const c = built({}, 480);
    const list = [a, c, b];
    sortBuilt(list, "departure");
    expect(list).toEqual([b, c, a]);
  });

  it("orders by the cheapest seat, then boarding, then id", () => {
    const a = built({ minPrice: 200_000 }, 400);
    const b = built({ minPrice: 100_000 }, 500);
    const c = built({ minPrice: 100_000 }, 450);
    const list = [a, b, c];
    sortBuilt(list, "price");
    expect(list).toEqual([c, b, a]);
  });

  it("orders best-rated first, unrated last", () => {
    const a = built({});
    const b = built({ brandRating: 4.8 });
    const c = built({ brandRating: 3.1 });
    const list = [a, c, b];
    sortBuilt(list, "rating");
    expect(list).toEqual([b, c, a]);
  });

  it("orders nearest first, trips without a distance last", () => {
    const a = built({}, 480, null);
    const b = built({}, 480, 12.4);
    const c = built({}, 480, 3.2);
    const list = [a, b, c];
    sortBuilt(list, "distance");
    expect(list).toEqual([c, b, a]);
  });
});

describe("paging", () => {
  const trips = Array.from({ length: 5 }, (_, i) => built({ minPrice: 100_000 + i }, 480 + i));

  it("counts the filter options over every match, not the page", () => {
    const r = pageResults(trips, options({ limit: 2 }));
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.hasMore).toBe(true);
    expect(r.facets?.matches).toBe(5);
  });

  it("filters before it pages, but counts before it filters", () => {
    const r = pageResults(trips, options({ filters: { ...noFilters, priceMin: 100_003 } }));
    expect(r.total).toBe(2);
    expect(r.facets?.matches).toBe(5);
  });

  it("serves the last page without more", () => {
    const r = pageResults(trips, options({ limit: 2, offset: 4 }));
    expect(r.items).toHaveLength(1);
    expect(r.hasMore).toBe(false);
    expect(pageResults(trips, options({ offset: 50 }))).toMatchObject({
      items: [],
      hasMore: false,
    });
  });

  it("answers an empty search with its page metadata and empty facets", () => {
    const r = emptyResults(options({ limit: 7, offset: 3 }));
    expect(r).toMatchObject({ items: [], total: 0, limit: 7, offset: 3, hasMore: false });
    expect(r.facets?.matches).toBe(0);
  });
});

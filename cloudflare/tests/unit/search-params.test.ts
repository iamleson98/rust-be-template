import { describe, expect, it } from "vitest";
import {
  buildSearchInput,
  NO_FILTERS,
  parseSearch,
  toQuery,
  type Filters,
} from "@spa/lib/search-params";

/** The address bar a search input becomes: defaults dropped, lists comma-separated. */
const address = (input: Parameters<typeof buildSearchInput>[0]) =>
  new URLSearchParams(
    Object.entries(buildSearchInput(input)).map(([k, v]) => [k, String(v)]),
  ).toString();

/** What the page reads back from that address bar. */
const reload = (qs: string) => parseSearch(Object.fromEntries(new URLSearchParams(qs)));

describe("/search URL: result filters", () => {
  const picked: Filters = {
    priceMin: 300_000,
    priceMax: 500_000,
    timeRanges: ["18-24", "0-6"],
    minRating: 4.5,
    availableOnly: true,
    amenities: ["wifi", "water"],
    brands: ["phuong-trang"],
  };

  it("survives a reload or a shared link", () => {
    const qs = address({ from: "Hà Nội", to: "Đà Nẵng", date: "2026-10-30", filters: picked });
    expect(reload(qs).filters).toEqual(picked);
  });

  it("keeps the address bar clean when nothing is picked", () => {
    expect(address({ from: "Hà Nội", to: "Đà Nẵng", filters: NO_FILTERS })).toBe(
      "from=H%C3%A0+N%E1%BB%99i&to=%C4%90%C3%A0+N%E1%BA%B5ng",
    );
    expect(address({ from: "A", to: "B", filters: { ...NO_FILTERS, minRating: 4 } })).toBe(
      "from=A&to=B&minRating=4",
    );
  });

  it("ignores junk instead of failing", () => {
    expect(reload("hours=night,18-24&minRating=9&priceMin=-5&seats=yes").filters).toEqual({
      ...NO_FILTERS,
      timeRanges: ["18-24"],
    });
  });

  it("keeps a precise pick's cities, which scope its search", () => {
    const precise = { fromLat: 21.03, fromLon: 105.78, toLat: 16.05, toLon: 108.2 };
    const pick = { from: "Bến xe Mỹ Đình", to: "Hội An", fromCity: "Hà Nội", toCity: "Đà Nẵng" };
    expect(reload(address({ ...pick, ...precise }))).toMatchObject({ ...pick, ...precise });
    // One precise end: the plain city search, under the precise end's city.
    expect(reload(address({ ...pick, fromLat: 21.03, fromLon: 105.78 }))).toMatchObject({
      from: "Hà Nội",
      to: "Đà Nẵng",
      fromLat: undefined,
    });
  });

  it("round-trips through the route's own URL form", () => {
    const parsed = parseSearch({ from: "A", to: "B", hours: "6-12", brands: "x,y", seats: true });
    expect(parseSearch(toQuery(parsed))).toEqual(parsed);
  });
});

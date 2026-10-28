import { describe, expect, it } from "vitest";
import { VIETNAMESE_CITIES } from "@/lib/cities";
import { findCity, matchCitySlugs, nameForSlug, normalizeForMatch } from "@/lib/city-match";

/** Port of the `src/cities.rs` unit tests. */

describe("city table", () => {
  it("finds a known slug with its coordinates", () => {
    const city = findCity("ha-noi");
    expect(city?.name).toBe("Hà Nội");
    expect(city?.lat).toBeGreaterThan(0);
    expect(city?.lon).toBeGreaterThan(0);
  });

  it("knows Huế and its coordinates", () => {
    expect(findCity("hue")).toMatchObject({ name: "Thừa Thiên Huế", lat: 16.46, lon: 107.59 });
  });

  it("returns null for an unknown slug", () => {
    expect(findCity("nonexistent")).toBeNull();
  });

  it("names an unknown slug by the slug itself", () => {
    expect(nameForSlug("nonexistent")).toBe("nonexistent");
    expect(nameForSlug("da-nang")).toBe("Đà Nẵng");
  });

  it("keeps every slug lowercase ASCII with hyphens, within VARCHAR(20), and unique", () => {
    const slugs = VIETNAMESE_CITIES.map((c) => c.id);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z-]+$/);
      expect(slug.length).toBeLessThanOrEqual(20);
    }
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has every city of the Rust table (62, Hải Dương included)", () => {
    expect(VIETNAMESE_CITIES).toHaveLength(62);
    expect(findCity("hai-duong")?.name).toBe("Hải Dương");
  });
});

describe("matchCitySlugs", () => {
  it("matches official names with and without diacritics", () => {
    expect(matchCitySlugs("Hà Nội")).toEqual(["ha-noi"]);
    expect(matchCitySlugs("Đà Nẵng")).toEqual(["da-nang"]);
    expect(matchCitySlugs("TP. Hồ Chí Minh")).toEqual(["ho-chi-minh"]);
    expect(matchCitySlugs("Da Nang")).toEqual(["da-nang"]);
    expect(matchCitySlugs("Can Tho")).toEqual(["can-tho"]);
  });

  it("matches colloquial aliases", () => {
    for (const q of ["Sài Gòn", "Sai Gon", "saigon", "hcm", "tphcm"])
      expect(matchCitySlugs(q)).toEqual(["ho-chi-minh"]);
    expect(matchCitySlugs("hn")).toEqual(["ha-noi"]);
  });

  it("resolves the popular city names to their provinces", () => {
    expect(matchCitySlugs("Đà Lạt")).toEqual(["lam-dong"]);
    expect(matchCitySlugs("Da Lat")).toEqual(["lam-dong"]);
    expect(matchCitySlugs("Nha Trang")).toEqual(["khanh-hoa"]);
    expect(matchCitySlugs("Vũng Tàu")).toEqual(["ba-ria-vung-tau"]);
    expect(matchCitySlugs("Huế")).toEqual(["hue"]);
    expect(matchCitySlugs("Phan Thiết")).toEqual(["binh-thuan"]);
    expect(matchCitySlugs("Hội An")).toEqual(["quang-nam"]);
    expect(matchCitySlugs("Quy Nhơn")).toEqual(["binh-dinh"]);
    expect(matchCitySlugs("Phú Quốc")).toEqual(["kien-giang"]);
    expect(matchCitySlugs("Hạ Long")).toEqual(["quang-ninh"]);
  });

  it("matches longer queries that contain a city, and the other way round", () => {
    expect(matchCitySlugs("danangairport")).toContain("da-nang");
    expect(matchCitySlugs("hochiminhcity")).toContain("ho-chi-minh");
  });

  it("does not match everything with short or unknown queries", () => {
    expect(matchCitySlugs("an")).toEqual([]);
    expect(matchCitySlugs("ben xe khong ton tai")).toEqual([]);
    expect(matchCitySlugs("   ")).toEqual([]);
  });

  it("resolves a station-style query to its city", () => {
    expect(matchCitySlugs("ben xe my dinh ha noi")).toContain("ha-noi");
  });

  it("normalises like the Rust slugify", () => {
    expect(normalizeForMatch("TP. Hồ Chí Minh")).toBe("tphochiminh");
    expect(normalizeForMatch("Đà Nẵng")).toBe("danang");
    expect(normalizeForMatch("Sài Gòn")).toBe("saigon");
  });
});

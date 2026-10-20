import { describe, expect, it } from "vitest";
import { countryAllowed } from "@/lib/calls/policy";

describe("countryAllowed (Vietnam-only calls for customers)", () => {
  it("defaults to Vietnam", () => {
    expect(countryAllowed("VN", undefined)).toBe(true);
    expect(countryAllowed("vn", undefined)).toBe(true);
    expect(countryAllowed("US", undefined)).toBe(false);
    expect(countryAllowed("SG", "")).toBe(true); // empty list = gate off
  });

  it("accepts a list and the wildcard", () => {
    expect(countryAllowed("KR", "VN, KR")).toBe(true);
    expect(countryAllowed("JP", "VN, KR")).toBe(false);
    expect(countryAllowed("JP", "*")).toBe(true);
  });

  it("never locks out a caller whose country is unknown", () => {
    expect(countryAllowed(null, "VN")).toBe(true); // local dev / internal
    expect(countryAllowed("", "VN")).toBe(true);
    expect(countryAllowed("XX", "VN")).toBe(true); // Cloudflare: unknown
  });
});

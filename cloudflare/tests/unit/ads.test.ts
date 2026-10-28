import { describe, expect, it } from "vitest";
import { adsConfig, conversionDateTime } from "@/lib/services/ads";

// Port of the Rust `ads/mod.rs` tests.
describe("conversionDateTime", () => {
  it("formats RFC 3339 with the offset Google requires", () => {
    expect(conversionDateTime("2026-10-07T04:15:30.123456789+00:00")).toBe(
      "2026-10-07 04:15:30+00:00",
    );
    expect(conversionDateTime("2026-10-07T11:00:00+07:00")).toBe("2026-10-07 11:00:00+07:00");
    expect(conversionDateTime("2026-10-07T04:15:30.123Z")).toBe("2026-10-07 04:15:30+00:00");
  });

  it("rejects garbage", () => {
    expect(() => conversionDateTime("not a date")).toThrow();
    expect(() => conversionDateTime("")).toThrow();
  });
});

describe("adsConfig", () => {
  const full = {
    GOOGLE_ADS_DEVELOPER_TOKEN: "dev",
    GOOGLE_ADS_CUSTOMER_ID: "123",
    GOOGLE_ADS_CLIENT_ID: "id",
    GOOGLE_ADS_CLIENT_SECRET: "secret",
    GOOGLE_ADS_REFRESH_TOKEN: "refresh",
    GOOGLE_ADS_CONVERSION_ACTIONS: '{"booking":"customers/1/conversionActions/2"}',
  } as unknown as CloudflareEnv;

  it("is active only with the whole credential group", () => {
    expect(adsConfig(full)?.conversionActions).toEqual({
      booking: "customers/1/conversionActions/2",
    });
    expect(adsConfig({ ...full, GOOGLE_ADS_REFRESH_TOKEN: " " } as CloudflareEnv)).toBeNull();
    expect(adsConfig({} as CloudflareEnv)).toBeNull();
  });

  it("survives a malformed action map", () => {
    expect(
      adsConfig({ ...full, GOOGLE_ADS_CONVERSION_ACTIONS: "{" } as CloudflareEnv)
        ?.conversionActions,
    ).toEqual({});
  });
});

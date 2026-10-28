import { describe, expect, it } from "vitest";
import { publicBaseUrl, robotsTxt, SITE_URL } from "@/lib/robots";

describe("robots.txt (Rust routes/seo.rs)", () => {
  it("is the Rust text: one group, private areas hidden, crawl delay, sitemap pointer", () => {
    expect(robotsTxt("https://datxevui.com")).toBe(
      [
        "# https://www.robotstxt.org/robotstxt.html",
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /admin/",
        "Disallow: /bookings/",
        "Disallow: /payments/",
        "Crawl-delay: 1",
        "",
        "Sitemap: https://datxevui.com/sitemap.xml",
        "",
      ].join("\n"),
    );
  });

  it("names no crawler of its own, so none escapes the Disallow rules", () => {
    expect(robotsTxt(SITE_URL).match(/User-agent:/g)).toHaveLength(1);
  });

  it("points the sitemap at the configured origin, without a trailing slash", () => {
    expect(publicBaseUrl("https://example.com//")).toBe("https://example.com");
    expect(robotsTxt(publicBaseUrl("https://example.com/"))).toContain(
      "Sitemap: https://example.com/sitemap.xml",
    );
  });

  it("falls back to the site origin when nothing is configured", () => {
    expect(publicBaseUrl(undefined)).toBe(SITE_URL);
    expect(publicBaseUrl("  ")).toBe(SITE_URL);
  });
});

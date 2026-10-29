import { describe, expect, it } from "vitest";
import { vi } from "@spa/lib/i18n/vi";
import { matchPage, pageSeo } from "@spa/lib/seo";

const t = (key: string, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), vi[key] ?? key);
const seo = (path: string, query = "", facts = {}) =>
  pageSeo(path, new URLSearchParams(query), t, facts);

describe("page SEO", () => {
  it("knows every page the SPA serves, and nothing else", () => {
    for (const path of [
      "/",
      "/search",
      "/compare",
      "/privacy",
      "/terms",
      "/brands/x",
      "/trips/1",
    ]) {
      expect(matchPage(path)).not.toBeNull();
    }
    for (const path of [
      "/login",
      "/admin",
      "/admin/system",
      "/account/trips/AB12",
      "/bookings/AB12",
      "/payments/1/return",
    ]) {
      expect(matchPage(path)?.kind).toBe("private");
    }
    for (const path of ["/random", "/brands", "/brands/x/y", "/adminx", "/payments/1"]) {
      expect(matchPage(path)).toBeNull();
    }
  });

  it("makes a corridor search a page of its own, whatever its date", () => {
    const page = seo("/search", "from=Hà Nội&to=Đà Nẵng&date=2026-10-30&sort=price")!;
    expect(page.title).toContain("Hà Nội đi Đà Nẵng");
    expect(page.robots).toBe("index, follow");
    expect(page.canonical).toBe(
      "https://datxevui.com/search?from=H%C3%A0+N%E1%BB%99i&to=%C4%90%C3%A0+N%E1%BA%B5ng",
    );
    expect(seo("/search", "from=Hà Nội")!.canonical).toBe("https://datxevui.com/search");
  });

  it("names the brand on its page", () => {
    const page = seo("/brands/phuong-trang", "", {
      brand: { name: "Phương Trang", description: null },
    })!;
    expect(page.title).toContain("Phương Trang");
    expect(page.description).toContain("Phương Trang");
    expect(page.canonical).toBe("https://datxevui.com/brands/phuong-trang");
  });

  it("keeps staff, account and departed-trip pages out of the index", () => {
    expect(seo("/admin/system")).toMatchObject({ robots: "noindex, nofollow", canonical: null });
    expect(seo("/trips/abc")).toMatchObject({ robots: "noindex, follow", canonical: null });
  });
});

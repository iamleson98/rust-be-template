import { describe, expect, it } from "vitest";
import { PLACE_TYPE_KEYS, PLACE_TYPE_PREFIX_KEYS, formatPlaceType } from "@spa/lib/place-type";
import { en } from "@spa/lib/i18n/en";
import { vi } from "@spa/lib/i18n/vi";

/**
 * The place index emits hundreds of kinds; the UI must never show a raw slug
 * for the common ones, nor reference a label that does not exist.
 */
describe("place type labels", () => {
  const keys = [...Object.values(PLACE_TYPE_KEYS), ...PLACE_TYPE_PREFIX_KEYS.map(([, k]) => k)];

  it("every referenced label exists in Vietnamese and English", () => {
    for (const k of keys) {
      expect(vi[k as keyof typeof vi], `vi ${k}`).toBeTruthy();
      expect(en[k as keyof typeof en], `en ${k}`).toBeTruthy();
    }
  });

  it("falls back to the key's label for kinds with no specific label", () => {
    const t = ((k: string) => (vi as Record<string, string>)[k] ?? k) as Parameters<
      typeof formatPlaceType
    >[1];
    expect(formatPlaceType("shop_bakery", t)).toBe("Cửa hàng");
    expect(formatPlaceType("amenity_restaurant", t)).toBe("Nhà hàng");
    expect(formatPlaceType("amenity_veterinary", t)).toBe("Tiện ích");
    expect(formatPlaceType("road_primary", t)).toBe("Đường chính");
    expect(formatPlaceType("address", t)).toBe("Địa chỉ");
    expect(formatPlaceType("something_new", t)).toBe("something new"); // last resort, still readable
  });
});

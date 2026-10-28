import { describe, expect, it } from "vitest";
import { isValidVnPhone, validateCreateAlert } from "@/lib/services/price-alerts";

// Port of the Rust `price_alert_service.rs` tests.
describe("isValidVnPhone", () => {
  it("accepts mobile numbers", () => {
    for (const p of ["0912345678", "0312345678", "0812345678"])
      expect(isValidVnPhone(p)).toBe(true);
  });

  it("accepts the country-code forms", () => {
    expect(isValidVnPhone("+84912345678")).toBe(true);
    expect(isValidVnPhone("84912345678")).toBe(true);
  });

  it("rejects a short number, a wrong prefix and a landline", () => {
    expect(isValidVnPhone("091234567")).toBe(false);
    expect(isValidVnPhone("0112345678")).toBe(false);
    expect(isValidVnPhone("0241234567")).toBe(false);
  });
});

describe("validateCreateAlert (CreatePriceAlertRequest)", () => {
  const ok = { phone: "0912345678", fromName: "Hà Nội", toName: "Đà Nẵng", targetPrice: 250_000 };

  it("returns the price, accepting the legacy maxPrice alias", () => {
    expect(validateCreateAlert(ok)).toBe(250_000);
    expect(validateCreateAlert({ ...ok, targetPrice: undefined, maxPrice: 300_000 })).toBe(300_000);
  });

  it("applies the field rules", () => {
    expect(() => validateCreateAlert({ ...ok, phone: "" })).toThrow();
    expect(() => validateCreateAlert({ ...ok, phone: " 0912345678" })).toThrow();
    expect(() => validateCreateAlert({ ...ok, email: "nope" })).toThrow();
    expect(() => validateCreateAlert({ ...ok, fromName: "" })).toThrow();
    expect(() => validateCreateAlert({ ...ok, targetPrice: -1 })).toThrow();
    expect(() => validateCreateAlert({ ...ok, targetPrice: 1_000_000_001 })).toThrow();
    expect(() => validateCreateAlert({ ...ok, frequency: "x".repeat(11) })).toThrow();
  });
});

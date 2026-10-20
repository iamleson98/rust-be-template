import { describe, expect, it } from "vitest";
import {
  classOf,
  fareOf,
  fareTable,
  normalizeClass,
  ticket,
  type ChildPolicy,
} from "@/lib/services/fares";
import { chooseStops, type Stop } from "@/lib/services/trip-stops";
import {
  bankNameForBin,
  buildVietQr,
  constantTimeEq,
  crc16,
  percentEncode,
} from "@/lib/services/payment";

/** Ports of the `fares.rs`, `trip_stops.rs`, `vietqr.rs` and `vnpay.rs` unit tests. */

const POLICY: ChildPolicy = { maxAge: 10, discountAmount: 100_000 };

const table = () =>
  fareTable({ basePriceAdult: 300_000, basePriceChild: null }, [
    { seatClass: "vip", priceAdult: 450_000, priceChild: null },
    { seatClass: "premium", priceAdult: 380_000, priceChild: 250_000 },
  ]);

describe("fares", () => {
  it("classes fall back to the standard fare", () => {
    const t = table();
    expect(fareOf(t, null).adult).toBe(300_000);
    expect(fareOf(t, "vip").adult).toBe(450_000);
    expect(fareOf(t, "bed_upper").adult).toBe(300_000);
  });

  it("no policy means everyone pays the adult fare", () => {
    const fare = fareOf(table(), "vip");
    expect(ticket(4, fare.adult, fare, null)).toEqual({ kind: "adult", price: 450_000 });
  });

  it("children get the brand discount amount, up to the age limit", () => {
    const fare = fareOf(table(), "vip");
    expect(ticket(10, fare.adult, fare, POLICY)).toEqual({ kind: "child", price: 350_000 });
    expect(ticket(11, fare.adult, fare, POLICY)).toEqual({ kind: "adult", price: 450_000 });
  });

  it("a class child price beats the discount but never the adult price", () => {
    const premium = fareOf(table(), "premium");
    expect(ticket(5, premium.adult, premium, POLICY).price).toBe(250_000);
    // A seat still sold at an older, lower price caps the child price.
    expect(ticket(5, 200_000, premium, POLICY).price).toBe(200_000);
  });

  it("a discount above the fare makes children free", () => {
    const fare = fareOf(table(), null);
    expect(ticket(3, fare.adult, fare, { ...POLICY, discountAmount: 500_000 })).toEqual({
      kind: "child",
      price: 0,
    });
  });

  it("classes are normalized", () => {
    expect(normalizeClass(" VIP ")).toBe("vip");
    expect(normalizeClass("Standard")).toBeNull();
    expect(normalizeClass("")).toBeNull();
    expect(normalizeClass(null)).toBeNull();
    expect(classOf({ seatClass: null })).toBe("standard");
    expect(classOf({ seatClass: "VIP" })).toBe("vip");
  });
});

describe("trip stops", () => {
  const stop = (order: number): Stop => ({
    id: crypto.randomUUID(),
    order,
    name: `Stop ${order}`,
    address: null,
    lat: null,
    lon: null,
    kind: null,
    pickupPoint: false,
  });

  it("boarding must come before dropping", () => {
    const stops = [stop(1), stop(2), stop(3)];
    const chosen = chooseStops(stops, stops[0].id, stops[2].id);
    expect([chosen?.on.order, chosen?.off.order]).toEqual([1, 3]);
    expect(() => chooseStops(stops, stops[2].id, stops[0].id)).toThrow();
    expect(() => chooseStops(stops, stops[1].id, stops[1].id)).toThrow();
  });

  it("stops are required exactly when the trip has some", () => {
    const stops = [stop(1), stop(2)];
    expect(() => chooseStops(stops, null, null)).toThrow();
    expect(() => chooseStops(stops, crypto.randomUUID(), stops[1].id)).toThrow();
    expect(chooseStops([], null, null)).toBeNull();
    expect(() => chooseStops([], stops[0].id, null)).toThrow();
  });
});

describe("VietQR and VNPay encoding", () => {
  it("the CRC matches the NAPAS reference vector", () => {
    expect(crc16("")).toBe(0xffff);
    expect(crc16("123456789")).toBe(0x29b1);
  });

  it("the payload has the NAPAS shape and a valid checksum", () => {
    const s = buildVietQr("970436", "0011001938111", 150000, "VEXEVN-ABC123", "ABC123");
    // Hand-assembled from the Rust layout: indicator, dynamic QR, NAPAS merchant
    // account (AID, bin+account, service 5769), MCC 4111, VND, amount, VN,
    // bill number + memo, then CRC16 (checked independently of this code).
    expect(s).toBe(
      "00020101021226450010A0000007270119970436001100193811102045769520441115303704" +
        "540615000058" +
        "02VN62270106ABC1230813VEXEVN-ABC1236304" +
        "8F94",
    );
    expect(s.slice(0, -4).endsWith("6304")).toBe(true);
  });

  it("percent-encodes like Rust", () => {
    expect(percentEncode("Vé xe")).toBe("V%C3%A9%20xe");
    expect(percentEncode("a-b_c.d~e")).toBe("a-b_c.d~e");
    expect(percentEncode("a+b&c=d")).toBe("a%2Bb%26c%3Dd");
  });

  it("compares signatures in constant time", () => {
    expect(constantTimeEq("abc", "abc")).toBe(true);
    expect(constantTimeEq("abc", "abd")).toBe(false);
    expect(constantTimeEq("abc", "abcd")).toBe(false);
  });

  it("names the known banks and falls back to the BIN", () => {
    expect(bankNameForBin("970436")).toBe("Vietcombank");
    expect(bankNameForBin("123456")).toBe("123456");
  });
});

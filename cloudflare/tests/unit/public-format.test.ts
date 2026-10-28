import { describe, expect, it } from "vitest";
import {
  amenityLabel,
  arrivalIso,
  departureIso,
  minutesOf,
  onSale,
  parseAmenities,
  resolveVehicleType,
  standardChildPrice,
  vehicleTypeLabel,
  type VehicleTypeRow,
} from "@/lib/services/public-format";

/** Port of the `public_service.rs` and `trip_search.rs` helper unit tests. */

describe("parseAmenities", () => {
  it("reads a JSON array", () => {
    expect(parseAmenities('["wifi","ac","charging"]')).toEqual(["wifi", "ac", "charging"]);
  });

  it("reads a comma-separated list", () => {
    expect(parseAmenities("wifi,ac,charging")).toEqual(["wifi", "ac", "charging"]);
    expect(parseAmenities(" wifi , ,ac ")).toEqual(["wifi", "ac"]);
  });

  it("is empty for nothing, empty and blank", () => {
    expect(parseAmenities(null)).toEqual([]);
    expect(parseAmenities("")).toEqual([]);
    expect(parseAmenities("   ")).toEqual([]);
  });

  it("falls back to comma-separated unless the JSON is an array of strings (as serde does)", () => {
    expect(parseAmenities("[1,2]")).toEqual(["[1", "2]"]);
    expect(parseAmenities('["wifi",""]')).toEqual(["wifi", ""]);
  });
});

describe("labels", () => {
  it("maps known vehicle types", () => {
    expect(vehicleTypeLabel("sleeper")).toBe("Giường nằm");
    expect(vehicleTypeLabel("limousine")).toBe("Limousine");
    expect(vehicleTypeLabel("semi-sleeper")).toBe("Giường nằm đơn");
    expect(vehicleTypeLabel("standard")).toBe("Ghế ngồi");
    expect(vehicleTypeLabel("unknown")).toBe("Ghế ngồi");
  });

  it("labels amenities, and leaves an unknown key without a label", () => {
    expect(amenityLabel("wifi")).toBe("WiFi");
    expect(amenityLabel("blanket")).toBe("Chăn mền");
    expect(amenityLabel("sauna")).toBe("");
  });
});

describe("resolveVehicleType", () => {
  const limo: VehicleTypeRow = { id: "vt-1", code: "Limousine", label: "Limousine 9 chỗ" };
  const catalog = new Map([[limo.id, limo]]);

  it("prefers the schedule's own catalog entry", () => {
    expect(resolveVehicleType("vt-1", "sleeper", catalog)).toEqual([
      "Limousine",
      "Limousine 9 chỗ",
    ]);
  });

  it("labels a legacy layout code from a catalog entry with that code, else the static map", () => {
    expect(resolveVehicleType(null, "limousine", catalog)).toEqual([
      "limousine",
      "Limousine 9 chỗ",
    ]);
    expect(resolveVehicleType(null, "sleeper", catalog)).toEqual(["sleeper", "Giường nằm"]);
  });

  it("defaults to standard", () => {
    expect(resolveVehicleType(null, null, new Map())).toEqual(["standard", "Ghế ngồi"]);
    expect(resolveVehicleType("gone", null, new Map())).toEqual(["standard", "Ghế ngồi"]);
  });
});

describe("minutesOf", () => {
  it("reads HH:MM", () => {
    expect(minutesOf("08:30")).toBe(510);
    expect(minutesOf("0:00")).toBe(0);
    expect(minutesOf("23:59")).toBe(1439);
    expect(minutesOf(" 07:05 ")).toBe(425);
  });

  it("reads only the first two minute characters, as Rust does", () => {
    expect(minutesOf("8:305")).toBe(510);
    expect(minutesOf("8:5")).toBe(485);
  });

  it("rejects what is not a time", () => {
    for (const bad of ["", "8", "24:00", "12:60", "ab:cd", "-1:30", "12:xx"])
      expect(minutesOf(bad), bad).toBeNull();
  });
});

describe("departure and arrival stamps", () => {
  it("builds the departure from the date and the schedule time", () => {
    expect(departureIso("2026-08-05", "08:30")).toBe("2026-08-05T08:30:00");
  });

  it("falls back to the time inside the date, else none", () => {
    expect(departureIso("2026-08-05T07:00", "")).toBe("2026-08-05T07:00:00");
    expect(departureIso("2026-08-05", "")).toBeNull();
    expect(departureIso("", "08:30")).toBeNull();
  });

  it("keeps a same-day arrival", () => {
    expect(arrivalIso("2026-08-05", "08:30", "14:45")).toBe("2026-08-05T14:45:00");
  });

  it("rolls an overnight arrival one day, equality included", () => {
    expect(arrivalIso("2026-08-05", "22:00", "06:00")).toBe("2026-08-06T06:00:00");
    expect(arrivalIso("2026-12-31", "23:30", "23:30")).toBe("2027-01-01T23:30:00");
  });

  it("rejects garbage", () => {
    expect(arrivalIso("2026-08-05", "08:30", "not-a-time")).toBeNull();
    expect(arrivalIso("garbage", "08:30", "14:45")).toBeNull();
    expect(arrivalIso("2026-02-30", "08:30", "14:45")).toBeNull();
  });
});

describe("onSale", () => {
  const day = (offset: number) =>
    new Date(Date.now() + (offset * 24 + 7) * 3_600_000).toISOString().slice(0, 10);
  const trip = (days: number, status = "scheduled", actualDepartureAt: string | null = null) => ({
    status,
    departureDate: day(days),
    actualDepartureAt,
  });
  const schedule = { departureTime: "08:00" };

  it("sells scheduled trips that have not left", () => {
    expect(onSale(trip(2), schedule)).toBe(true);
    expect(onSale(trip(-1), schedule)).toBe(false);
    expect(onSale(trip(2, "cancelled"), schedule)).toBe(false);
  });

  it("reads the departure as Vietnam time", () => {
    // 08:00 on 2026-10-10 in Vietnam is 01:00 UTC.
    const t = { status: "scheduled", departureDate: "2026-10-10", actualDepartureAt: null };
    expect(onSale(t, schedule, new Date("2026-10-10T00:59:00Z"))).toBe(true);
    expect(onSale(t, schedule, new Date("2026-10-10T01:00:00Z"))).toBe(false);
  });

  it("closes sale at a recorded departure", () => {
    const t = trip(2, "scheduled", "2020-01-01T00:00:00Z");
    expect(onSale(t, schedule)).toBe(false);
  });

  it("keeps selling a trip whose time cannot be read", () => {
    const t = { status: "scheduled", departureDate: "soon", actualDepartureAt: null };
    expect(onSale(t, schedule)).toBe(true);
  });
});

describe("standardChildPrice", () => {
  const schedule = { basePriceAdult: 100_000, basePriceChild: null };
  it("is 0 without child tickets", () => {
    expect(standardChildPrice(schedule, null)).toBe(0);
  });
  it("takes the brand's discount, or the schedule's own child price", () => {
    expect(standardChildPrice(schedule, { maxAge: 10, discountAmount: 30_000 })).toBe(70_000);
    expect(
      standardChildPrice(
        { ...schedule, basePriceChild: 50_000 },
        { maxAge: 10, discountAmount: 30_000 },
      ),
    ).toBe(50_000);
  });
});

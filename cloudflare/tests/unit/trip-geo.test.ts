import { describe, expect, it } from "vitest";
import { geoBox, haversineKm, nearestPair, type StopHit } from "@/lib/services/trip-geo";

/** The pure half of the coordinate search (`public_service.rs`: `geo_box`, `nearest_pair`). */

const HANOI = [21.03, 105.85] as const;
const DANANG = [16.05, 108.21] as const;

const stop = (order: number, lat: number, lon: number, over: Partial<StopHit> = {}): StopHit => ({
  order,
  name: `Stop ${order}`,
  lat,
  lon,
  ...over,
});

describe("haversineKm", () => {
  it("measures great-circle distance", () => {
    expect(haversineKm(...HANOI, ...HANOI)).toBe(0);
    expect(haversineKm(...HANOI, ...DANANG)).toBeCloseTo(607.0, 1);
  });
});

describe("geoBox", () => {
  it("holds every point within the distance, with a margin", () => {
    const box = geoBox(HANOI, 50);
    for (const [dLat, dLon] of [
      [0.45, 0],
      [-0.45, 0],
      [0, 0.48],
      [0, -0.48],
    ]) {
      const [lat, lon] = [HANOI[0] + dLat, HANOI[1] + dLon];
      expect(lat).toBeGreaterThan(box.latMin);
      expect(lat).toBeLessThan(box.latMax);
      expect(lon).toBeGreaterThan(box.lonMin);
      expect(lon).toBeLessThan(box.lonMax);
    }
    expect(box.latMax - HANOI[0]).toBeCloseTo((50 / 111) * 1.2);
  });

  it("stays finite near the poles", () => {
    const box = geoBox([90, 0], 10);
    expect(Number.isFinite(box.lonMax)).toBe(true);
  });
});

describe("nearestPair", () => {
  it("picks the nearest pickup and a LATER drop-off", () => {
    const hits = [
      stop(1, 21.03, 105.85), // pickup, at the place
      stop(2, 21.1, 105.9), // pickup, farther
      stop(3, 16.05, 108.21), // drop-off, at the place
      stop(4, 16.2, 108.3), // drop-off, farther
    ];
    const pair = nearestPair(hits, HANOI, DANANG, 50);
    expect(pair?.[0]).toMatchObject({ name: "Stop 1", distanceKm: 0 });
    expect(pair?.[1]).toMatchObject({ name: "Stop 3", distanceKm: 0 });
  });

  it("is none when the drop-off comes first, or when nothing is near both", () => {
    const backwards = [stop(1, 16.05, 108.21), stop(2, 21.03, 105.85)];
    expect(nearestPair(backwards, HANOI, DANANG, 50)).toBeNull();
    expect(nearestPair([stop(1, 21.03, 105.85)], HANOI, DANANG, 50)).toBeNull();
    expect(nearestPair([stop(1, 21.03, 105.85), stop(2, 10, 100)], HANOI, DANANG, 50)).toBeNull();
  });

  it("ignores stops beyond the maximum distance", () => {
    const hits = [stop(1, 21.5, 105.85), stop(2, 16.05, 108.21)]; // ~52 km from the pickup
    expect(nearestPair(hits, HANOI, DANANG, 50)).toBeNull();
    expect(nearestPair(hits, HANOI, DANANG, 60)).not.toBeNull();
  });

  it("minimises the TOTAL distance, rounds to 0.1 km and keeps the stop's time", () => {
    const hits = [
      stop(1, 21.05, 105.85, { time: "07:00" }), // 2.2 km
      stop(2, 21.031, 105.85, { time: "07:20" }), // 0.1 km
      stop(5, 16.07, 108.21, { time: "13:00" }),
    ];
    const pair = nearestPair(hits, HANOI, DANANG, 50);
    expect(pair?.[0]).toEqual({ name: "Stop 2", time: "07:20", distanceKm: 0.1 });
    expect(pair?.[1]).toEqual({ name: "Stop 5", time: "13:00", distanceKm: 2.2 });
  });
});

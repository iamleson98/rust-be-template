/**
 * Regression tests for the D1 bound-parameter cap on the admin write paths:
 * a schedule with more than 14 stops and a bus layout with more than 12
 * seats used to fail with HTTP 500 because their multi-row INSERTs bound
 * 40 rows at a time (280/320 parameters — D1 allows 100 per query).
 *
 * These tests push through the real route handlers against a real (Miniflare)
 * D1, at sizes well past the caps: a 24-stop schedule, a 22-bed layout and
 * a 20-class fare table.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { scheduleFares, schedulePoints, seats } from "@/lib/db/schema";
import { POST as postSchedule } from "@/app/api/admin/schedules/route";
import { PUT as putSchedule } from "@/app/api/admin/schedules/[id]/route";
import { POST as postLayout } from "@/app/api/admin/bus-layouts/route";
import { setCloudflareContext } from "../helpers/context";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";
import { eq } from "drizzle-orm";

beforeAll(migrate);

let f: Fixture;
let admin: string;
const auth = async () => ({
  authorization: `Bearer ${await signAccessToken(admin)}`,
});
const json = async (body: unknown) => ({
  headers: { "content-type": "application/json", ...(await auth()) },
  method: "POST",
  body: JSON.stringify(body),
});

beforeEach(async () => {
  setCloudflareContext();
  f = await fixture(1);
  admin = await owner("admin");
});

/** A two-deck 22-bed plan in the style the migration generates. */
const berth22 = () => {
  const deck = (letter: string, cls: string, n: number) => {
    const cells: any[] =
      letter === "A"
        ? [
            { row: 1, col: 1, kind: "driver" },
            { row: 1, col: 5, kind: "door" },
          ]
        : [{ row: 1, col: 5, kind: "stairs" }];
    let i = 0;
    for (let r = 0; r < Math.ceil(n / 3); r++) {
      for (const col of [1, 3, 5]) {
        if (i >= n) break;
        i += 1;
        cells.push({ row: 2 + r, col, kind: "bed", label: `${letter}${i}`, seatClass: cls });
      }
    }
    return { rows: 6, cols: 5, cells };
  };
  return { decks: [deck("A", "bed_lower", 11), deck("B", "bed_upper", 11)] };
};

describe("admin writes stay under D1's parameter cap", () => {
  it("creates a bus layout with 22 beds (seat rows chunked)", async () => {
    const res = await postLayout(
      new Request("https://datxevui.com/api/admin/bus-layouts", {
        ...(await json({
          brandId: f.brandId,
          name: "Giường nằm 22 chỗ (regression)",
          vehicleType: "sleeper",
          totalSeats: 22,
          plan: berth22(),
        })),
      }) as any,
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as any;
    const db = await getDb();
    const rows = await db.select().from(seats).where(eq(seats.busLayoutId, id));
    expect(rows).toHaveLength(22);
  });

  it("creates a schedule with 24 stops (points chunked)", async () => {
    const db = await getDb();
    const addressIds: string[] = [];
    for (let i = 0; i < 24; i++) {
      const id = crypto.randomUUID();
      addressIds.push(id);
      await db.insert((await import("@/lib/db/schema")).addresses).values({
        id,
        brandId: f.brandId,
        name: `Điểm dừng ${i + 1}`,
        cityId: "ha-noi",
        province: "Hà Nội",
      });
    }
    const res = await postSchedule(
      new Request("https://datxevui.com/api/admin/schedules", {
        ...(await json({
          routeId: f.routeId,
          departureTime: "06:00",
          basePriceAdult: 350000,
          classFares: Array.from({ length: 20 }, (_, i) => ({
            seatClass: `post_class_${i + 1}`,
            priceAdult: 300000 + i * 10000,
          })),
          points: addressIds.map((addressId, i) => ({
            addressId,
            arrivalTime: `${String(7 + Math.floor(i / 6)).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}`,
          })),
        })),
      }) as any,
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as any;
    const pts = await db.select().from(schedulePoints).where(eq(schedulePoints.scheduleId, id));
    expect(pts).toHaveLength(24);
    // kinds follow position: departure / intermediate / destination
    expect(pts.find((p) => p.stopOrder === 1)?.kind).toBe("departure");
    expect(pts.find((p) => p.stopOrder === 24)?.kind).toBe("destination");
  });

  it("PUT replaces 24 stops and 20 class fares (both chunked)", async () => {
    const db = await getDb();
    const addressIds: string[] = [];
    for (let i = 0; i < 24; i++) {
      const id = crypto.randomUUID();
      addressIds.push(id);
      await db.insert((await import("@/lib/db/schema")).addresses).values({
        id,
        brandId: f.brandId,
        name: `Điểm dừng PUT ${i + 1}`,
        cityId: "hai-phong",
        province: "Hải Phòng",
      });
    }
    const res = await putSchedule(
      new Request(`https://datxevui.com/api/admin/schedules/${f.scheduleId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...(await auth()) },
        body: JSON.stringify({
          points: addressIds.map((addressId, i) => ({
            addressId,
            arrivalTime: `${String(8 + Math.floor(i / 6)).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}`,
          })),
          classFares: Array.from({ length: 20 }, (_, i) => ({
            seatClass: `class_${i + 1}`,
            priceAdult: 300000 + i * 10000,
          })),
        }),
      }) as any,
      { params: Promise.resolve({ id: f.scheduleId }) },
    );
    expect(res.status).toBe(200);
    const pts = await db
      .select()
      .from(schedulePoints)
      .where(eq(schedulePoints.scheduleId, f.scheduleId));
    expect(pts).toHaveLength(24);
    const fares = await db
      .select()
      .from(scheduleFares)
      .where(eq(scheduleFares.scheduleId, f.scheduleId));
    expect(fares).toHaveLength(20);
  });
});

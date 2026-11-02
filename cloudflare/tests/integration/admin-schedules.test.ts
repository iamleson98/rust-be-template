import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { addresses, schedulePoints, schedules } from "@/lib/db/schema";
import { POST as create } from "@/app/api/admin/schedules/route";
import { PUT as update } from "@/app/api/admin/schedules/[id]/route";
import { setCloudflareContext } from "../helpers/context";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";

/** `POST` / `PUT /api/admin/schedules`: checked input, partial updates, all-or-nothing lists. */

beforeAll(migrate);

let f: Fixture;
let admin: string;
let stops: string[];
beforeEach(async () => {
  setCloudflareContext();
  f = await fixture(1);
  admin = await owner("admin");
  const db = await getDb();
  stops = [crypto.randomUUID(), crypto.randomUUID()];
  for (const [i, id] of stops.entries())
    await db.insert(addresses).values({ id, brandId: f.brandId, name: `Stop ${i}` });
});

const send = async (body: unknown, id?: string) => {
  const req = new Request("https://datxevui.com/api/admin/schedules", {
    method: id ? "PUT" : "POST",
    headers: {
      authorization: `Bearer ${await signAccessToken(admin)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const res = id ? await update(req, { params: Promise.resolve({ id }) }) : await create(req);
  return { status: res.status, body: (await res.json()) as { id?: string } };
};
const row = async (id: string) =>
  (await (await getDb()).select().from(schedules).where(eq(schedules.id, id)))[0]!;
const pointsOf = async (id: string) =>
  (await getDb()).select().from(schedulePoints).where(eq(schedulePoints.scheduleId, id));

describe("schedule writes", () => {
  it("creates a schedule with its stops; every day is stored as no mask", async () => {
    const made = await send({
      routeId: f.routeId,
      departureTime: "21:30",
      daysOfWeek: "1111111",
      basePriceAdult: 300_000,
      points: stops.map((addressId) => ({ addressId, arrivalTime: null })),
    });
    expect(made.status).toBe(201);
    expect(await row(made.body.id!)).toMatchObject({ departureTime: "21:30", daysOfWeek: null });
    expect(await pointsOf(made.body.id!)).toHaveLength(2);
  });

  it("keeps the layout and vehicle type an update leaves out", async () => {
    const before = await row(f.scheduleId);
    expect(before.busLayoutId).toBe(f.layoutId);
    expect((await send({ basePriceAdult: 420_000 }, f.scheduleId)).status).toBe(200);
    expect(await row(f.scheduleId)).toMatchObject({
      basePriceAdult: 420_000,
      busLayoutId: f.layoutId,
      departureTime: before.departureTime,
    });
    await send({ busLayoutId: null }, f.scheduleId);
    expect((await row(f.scheduleId)).busLayoutId).toBeNull();
  });

  it("refuses bad input and changes nothing", async () => {
    const before = await row(f.scheduleId);
    const pointsBefore = await pointsOf(f.scheduleId);
    for (const body of [
      { departureTime: "25:00" },
      { basePriceAdult: -1 },
      { basePriceAdult: "350000" },
      { daysOfWeek: "0000000" },
      { daysOfWeek: "monday" },
      { effectiveFrom: "2026-12-01", effectiveTo: "2026-11-01" },
      { routeId: crypto.randomUUID() },
      // A valid price with a bad stop list: the price must not be written either.
      { basePriceAdult: 1, points: [{ addressId: stops[0] }] },
      { basePriceAdult: 1, classFares: [{ seatClass: "vip", priceAdult: 0 }] },
    ]) {
      expect((await send(body, f.scheduleId)).status).toBe(400);
    }
    expect(await row(f.scheduleId)).toEqual(before);
    expect(await pointsOf(f.scheduleId)).toEqual(pointsBefore);
  });

  it("answers 404 for an unknown schedule and requires route and time to create", async () => {
    expect((await send({ basePriceAdult: 1 }, crypto.randomUUID())).status).toBe(404);
    expect((await send({ routeId: f.routeId })).status).toBe(400);
  });
});

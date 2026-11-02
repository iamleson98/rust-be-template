import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { busLayouts, pickupPoints, routes } from "@/lib/db/schema";
import { PUT as update } from "@/app/api/admin/routes/[id]/route";
import { PUT as updateLayout } from "@/app/api/admin/bus-layouts/[id]/route";
import { POST as createPickup } from "@/app/api/admin/pickup-points/route";
import { setCloudflareContext } from "../helpers/context";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";

/** Admin catalog updates: a field left out keeps its value; what is sent is checked. */

beforeAll(migrate);

let f: Fixture;
let admin: string;
beforeEach(async () => {
  setCloudflareContext();
  f = await fixture(1);
  admin = await owner("admin");
});

const request = async (method: string, body: unknown) =>
  new Request("https://datxevui.com/api/admin/x", {
    method,
    headers: {
      authorization: `Bearer ${await signAccessToken(admin)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
const put = async (body: unknown, id = f.routeId) =>
  (await update(await request("PUT", body), { params: Promise.resolve({ id }) })).status;
const row = async () =>
  (await (await getDb()).select().from(routes).where(eq(routes.id, f.routeId)))[0]!;

describe("route updates", () => {
  it("keeps the brand when the body leaves it out, and detaches it on null", async () => {
    expect(await put({ status: "inactive" })).toBe(200);
    expect(await row()).toMatchObject({ brandId: f.brandId, status: "inactive" });
    await put({ brandId: null });
    expect((await row()).brandId).toBeNull();
  });

  it("refuses an unknown status or an empty name, and 404s an unknown route", async () => {
    expect(await put({ status: "archived" })).toBe(400);
    expect(await put({ name: " " })).toBe(400);
    expect(await put({ name: "X" }, crypto.randomUUID())).toBe(404);
    expect((await row()).status).toBe("active");
  });
});

describe("bus layout updates", () => {
  it("keeps the brand when left out and never takes a plan (that is /plan's job)", async () => {
    const db = await getDb();
    const [before] = await db.select().from(busLayouts).where(eq(busLayouts.id, f.layoutId));
    const res = await updateLayout(
      await request("PUT", { name: "Renamed", layoutData: "{}", totalSeats: 99 }),
      { params: Promise.resolve({ id: f.layoutId }) },
    );
    expect(res.status).toBe(200);
    const [after] = await db.select().from(busLayouts).where(eq(busLayouts.id, f.layoutId));
    expect(after).toMatchObject({
      name: "Renamed",
      brandId: f.brandId,
      layoutData: before!.layoutData,
      totalSeats: before!.totalSeats,
    });
  });
});

describe("pickup point creation", () => {
  it("stores checked coordinates and refuses impossible ones", async () => {
    const ok = await createPickup(
      await request("POST", { routeId: f.routeId, name: "Bến xe", lat: 21.03, lon: 105.85 }),
    );
    expect(ok.status).toBe(201);
    const { id } = (await ok.json()) as { id: string };
    const [row] = await (await getDb()).select().from(pickupPoints).where(eq(pickupPoints.id, id));
    expect(row).toMatchObject({ lat: 21.03, lon: 105.85, stopOrder: 0 });
    for (const body of [
      { routeId: f.routeId, lat: 200, lon: 0 },
      { routeId: f.routeId, lat: "21", lon: 105 },
      { routeId: crypto.randomUUID() },
    ]) {
      expect((await createPickup(await request("POST", body))).status).toBe(400);
    }
  });
});

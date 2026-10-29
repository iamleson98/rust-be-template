/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { addresses, schedulePoints } from "@/lib/db/schema";
import { GET as list, POST as create } from "@/app/api/admin/addresses/route";
import { DELETE as remove, PUT as update } from "@/app/api/admin/addresses/[id]/route";
import { setCloudflareContext } from "../helpers/context";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";

/** A pickup/drop-off point always belongs to exactly one of our cities. */

beforeAll(migrate);

let f: Fixture;
let admin: string;
beforeEach(async () => {
  setCloudflareContext();
  f = await fixture(1);
  admin = await owner("admin");
});

const send = async (method: string, body: unknown) =>
  new Request("https://datxevui.com/api/admin/addresses", {
    method,
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await signAccessToken(admin)}`,
    },
  });
const point = (over: Record<string, unknown> = {}) => ({
  brandId: f.brandId,
  name: "Bến xe Mỹ Đình",
  lat: 21.028,
  lon: 105.778,
  cityId: "ha-noi",
  ...over,
});
const row = async (id: string) =>
  (await (await getDb()).select().from(addresses).where(eq(addresses.id, id)))[0];

describe("address city", () => {
  it("stores the city and its name as the province", async () => {
    const res = await create(await send("POST", point({ province: "Đà Nẵng" })));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as any;
    expect(await row(id)).toMatchObject({ cityId: "ha-noi", province: "Hà Nội" });
    const listed = (await (await list(await send("GET", undefined))).json()) as any;
    expect(listed.items.find((a: any) => a.id === id)).toMatchObject({ cityId: "ha-noi" });
  });

  it("requires a city, and one of ours", async () => {
    for (const cityId of [undefined, " ", "atlantis", "Hà Nội"]) {
      const res = await create(await send("POST", point({ cityId })));
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).message).toContain("cityId");
    }
  });

  it("changes the city on update only to one of ours, and keeps it otherwise", async () => {
    const { id } = (await (await create(await send("POST", point()))).json()) as any;
    const ctx = { params: Promise.resolve({ id }) };
    expect((await update(await send("PUT", { cityId: "atlantis" }), ctx)).status).toBe(400);
    expect((await update(await send("PUT", { name: "Mỹ Đình" }), ctx)).status).toBe(200);
    expect(await row(id)).toMatchObject({ name: "Mỹ Đình", cityId: "ha-noi" });
    expect((await update(await send("PUT", { cityId: "da-nang" }), ctx)).status).toBe(200);
    expect(await row(id)).toMatchObject({ cityId: "da-nang", province: "Đà Nẵng" });
  });
});

describe("managing a brand's locations", () => {
  const created = async (over: Record<string, unknown> = {}) =>
    ((await (await create(await send("POST", point(over)))).json()) as any).id as string;
  const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });
  const listed = async () =>
    ((await (await list(await send("GET", undefined))).json()) as any).items as any[];

  it("clears a detail sent blank, and keeps one not sent", async () => {
    const id = await created({ address: "1 Phạm Hùng", district: "Nam Từ Liêm" });
    await update(await send("PUT", { address: "  ", ward: "Mỹ Đình 1" }), ctxOf(id));
    expect(await row(id)).toMatchObject({
      address: null,
      district: "Nam Từ Liêm",
      ward: "Mỹ Đình 1",
    });
    expect((await update(await send("PUT", { name: " " }), ctxOf(id))).status).toBe(400);
  });

  it("counts the schedule stops at each location and refuses to delete a used one", async () => {
    const used = await created();
    const free = await created({ name: "Bến xe Giáp Bát" });
    await (await getDb()).insert(schedulePoints).values({
      id: crypto.randomUUID(),
      scheduleId: f.scheduleId,
      addressId: used,
      stopOrder: 0,
      kind: "pickup",
    });
    const counts = Object.fromEntries((await listed()).map((a) => [a.id, a.stopCount]));
    expect(counts).toMatchObject({ [used]: 1, [free]: 0 });

    const refused = await remove(await send("DELETE", undefined), ctxOf(used));
    expect(refused.status).toBe(409);
    expect(await row(used)).toBeDefined();
    expect((await remove(await send("DELETE", undefined), ctxOf(free))).status).toBe(200);
    expect(await row(free)).toBeUndefined();
  });
});

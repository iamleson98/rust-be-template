/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { addresses } from "@/lib/db/schema";
import { GET as list, POST as create } from "@/app/api/admin/addresses/route";
import { PUT as update } from "@/app/api/admin/addresses/[id]/route";
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

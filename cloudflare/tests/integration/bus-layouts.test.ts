/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { busLayouts } from "@/lib/db/schema";
import { GET as list } from "@/app/api/admin/bus-layouts/route";
import { setCloudflareContext } from "../helpers/context";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";

/** The staff layout list: a brand's own layouts, and the shared catalog on request. */

beforeAll(migrate);

let f: Fixture;
let admin: string;
let shared: string;
beforeEach(async () => {
  setCloudflareContext();
  f = await fixture(1);
  admin = await owner("admin");
  shared = crypto.randomUUID();
  await (
    await getDb()
  )
    .insert(busLayouts)
    .values({ id: shared, brandId: null, name: "Sleeper 40 chỗ", totalSeats: 40 });
});

const ids = async (qs: string) => {
  const res = await list(
    new Request(`https://datxevui.com/api/admin/bus-layouts?${qs}`, {
      headers: { authorization: `Bearer ${await signAccessToken(admin)}` },
    }),
  );
  return ((await res.json()) as any).items.map((l: any) => l.id).sort();
};

describe("bus layout list", () => {
  it("lists only the brand's own layouts for a brand", async () => {
    expect(await ids(`brandId=${f.brandId}`)).toEqual([f.layoutId]);
  });

  it("adds the shared catalog for the schedule form", async () => {
    expect(await ids(`brandId=${f.brandId}&includeShared=true`)).toEqual(
      [f.layoutId, shared].sort(),
    );
  });
});

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { routes } from "@/lib/db/schema";
import { PUT as update } from "@/app/api/admin/routes/[id]/route";
import { setCloudflareContext } from "../helpers/context";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";

/** `PUT /api/admin/routes/{id}`: a field left out keeps its value. */

beforeAll(migrate);

let f: Fixture;
let admin: string;
beforeEach(async () => {
  setCloudflareContext();
  f = await fixture(1);
  admin = await owner("admin");
});

const put = async (body: unknown, id = f.routeId) =>
  (
    await update(
      new Request("https://datxevui.com/api/admin/routes/x", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${await signAccessToken(admin)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    )
  ).status;
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

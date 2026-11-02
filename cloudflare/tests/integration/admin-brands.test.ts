import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { POST as create } from "@/app/api/admin/brands/route";
import { PUT as update } from "@/app/api/admin/brands/[id]/route";
import { setCloudflareContext } from "../helpers/context";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";

/** `POST` / `PUT /api/admin/brands`: what the brand form sends is checked and saved. */

beforeAll(migrate);

let f: Fixture;
let admin: string;
beforeEach(async () => {
  setCloudflareContext();
  f = await fixture(1);
  admin = await owner("admin");
});

const send = async (body: unknown, id?: string, who = admin) => {
  const req = new Request("https://datxevui.com/api/admin/brands", {
    method: id ? "PUT" : "POST",
    headers: {
      authorization: `Bearer ${await signAccessToken(who)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const res = id ? await update(req, { params: Promise.resolve({ id }) }) : await create(req);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const row = async (id: string) =>
  (await (await getDb()).select().from(brands).where(eq(brands.id, id)))[0]!;

describe("brand writes", () => {
  it("saves, keeps and clears the child-fare policy the form sends", async () => {
    const fare = { childFare: { maxAge: 10, discountAmount: 50_000 } };
    expect((await send(fare, f.brandId)).status).toBe(200);
    expect(await row(f.brandId)).toMatchObject({ childMaxAge: 10, childDiscountAmount: 50_000 });
    await send({ name: "Renamed" }, f.brandId); // absent: kept
    expect(await row(f.brandId)).toMatchObject({ name: "Renamed", childMaxAge: 10 });
    await send({ childFare: null }, f.brandId);
    expect(await row(f.brandId)).toMatchObject({ childMaxAge: null, childDiscountAmount: null });
  });

  it("creates a brand with a slug from its name, and refuses a taken slug", async () => {
    const made = await send({ name: "Sao Việt Đỏ", childFare: { maxAge: 5, discountAmount: 0 } });
    expect(made).toMatchObject({ status: 201, body: { slug: "sao-viet-do" } });
    expect(await row(made.body.id as string)).toMatchObject({ status: "active", childMaxAge: 5 });
    expect((await send({ name: "Sao Viet Do" })).status).toBe(409);
  });

  it("refuses what the form could never send", async () => {
    for (const body of [
      { name: "  " },
      { status: "deleted" },
      { contactEmail: "not-an-email" },
      { logoUrl: "javascript:alert(1)" },
      { childFare: { maxAge: 30, discountAmount: 0 } },
      { childFare: { maxAge: 5, discountAmount: 1500 } },
      { description: "x".repeat(5001) },
    ]) {
      expect((await send(body, f.brandId)).status).toBe(400);
    }
    expect((await row(f.brandId)).status).toBe("active");
  });

  it("answers 404 for an unknown brand and 403 for a customer", async () => {
    expect((await send({ name: "X" }, crypto.randomUUID())).status).toBe(404);
    expect((await send({ name: "X" }, f.brandId, await owner("user"))).status).toBe(403);
  });
});

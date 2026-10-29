import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { getDb } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { POST as upload } from "@/app/api/uploads/brand-logo/route";
import { PUT as updateBrand } from "@/app/api/admin/brands/[id]/route";
import { setCloudflareContext } from "../helpers/context";
import { fakeImages } from "../helpers/fake-images";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";

/**
 * Brand logos: a raster upload is re-encoded to a small WebP before R2 sees it,
 * an SVG is kept, and the brand form can clear a logo it set.
 */

beforeAll(migrate);

let f: Fixture;
let admin: string;
beforeEach(async () => {
  setCloudflareContext({ UPLOADS: env.UPLOADS, IMAGES: fakeImages });
  f = await fixture(1);
  admin = await owner("admin");
  const stored = await env.UPLOADS.list();
  await env.UPLOADS.delete(stored.objects.map((o) => o.key));
});

/** A PNG header (signature + IHDR) of the given size. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

async function post(file: Blob | string | null, who: string | null = admin): Promise<Response> {
  const form = new FormData();
  if (file !== null) form.append("file", file instanceof Blob ? file : new Blob([file]));
  return upload(
    new Request("https://datxevui.com/x", {
      method: "POST",
      body: form,
      headers: who ? { authorization: `Bearer ${await signAccessToken(who)}` } : {},
    }),
  );
}
const asPng = (b: Uint8Array) => new Blob([b as BlobPart], { type: "image/png" });

describe("POST /api/uploads/brand-logo", () => {
  it("stores a raster logo as WebP scaled to 512 px, never the original", async () => {
    const res = await post(asPng(png(2000, 1000)));
    expect(res.status).toBe(201);
    const { key, url } = (await res.json()) as { key: string; url: string };
    expect(key).toMatch(/^brands\/logos\/[0-9a-f]{16}\.webp$/);
    expect(url).toBe(`/api/media/${key}`);
    const object = await env.UPLOADS.get(key);
    expect(object?.httpMetadata).toMatchObject({
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(
      JSON.parse(new TextDecoder().decode((await object!.arrayBuffer()).slice(12))),
    ).toMatchObject({
      width: 512,
      height: 256,
    });
    expect((await env.UPLOADS.list()).objects).toHaveLength(1);
  });

  it("keeps an SVG as it is", async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
    const res = await post(new Blob([svg], { type: "image/svg+xml" }));
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: string; url: string };
    expect(key).toMatch(/\.svg$/);
    expect(await (await env.UPLOADS.get(key))!.text()).toBe(svg);
  });

  it("refuses a raster logo when image processing is unavailable, and what is not an image", async () => {
    expect((await post("<html>")).status).toBe(415);
    expect((await post(null)).status).toBe(400);
    setCloudflareContext({ UPLOADS: env.UPLOADS });
    expect((await post(asPng(png(10, 10)))).status).toBe(503);
    expect((await env.UPLOADS.list()).objects).toHaveLength(0);
  });

  it("needs a signed-in admin", async () => {
    expect((await post(asPng(png(10, 10)), null)).status).toBe(401);
    expect((await post(asPng(png(10, 10)), await owner())).status).toBe(403);
  });
});

describe("PUT /api/admin/brands/{id} logoUrl", () => {
  const put = async (body: unknown) =>
    updateBrand(
      new Request("https://x", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${await signAccessToken(admin)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: f.brandId }) },
    );
  const logo = async () =>
    (await (await getDb()).select().from(brands).where(eq(brands.id, f.brandId)))[0]!.logoUrl;

  it("sets, keeps and clears the logo", async () => {
    await put({ logoUrl: "/api/media/brands/logos/0123456789abcdef.webp" });
    expect(await logo()).toBe("/api/media/brands/logos/0123456789abcdef.webp");
    await put({ name: "Renamed" }); // absent: kept
    expect(await logo()).toBe("/api/media/brands/logos/0123456789abcdef.webp");
    await put({ logoUrl: null });
    expect(await logo()).toBeNull();
  });
});

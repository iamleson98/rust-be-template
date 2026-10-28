/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { signAccessToken } from "@/lib/auth/jwt";
import { setCloudflareContext } from "../helpers/context";
import { fixture, migrate, owner, type Fixture } from "../helpers/fixture";
import { getDb } from "@/lib/db/client";
import { routePictures } from "@/lib/db/schema";
import { GET as serve } from "@/app/api/media/[...key]/route";
import { GET as publicGallery } from "@/app/api/routes/[id]/pictures/route";
import {
  DELETE as clearGallery,
  GET as adminGallery,
  POST as upload,
} from "@/app/api/admin/routes/[id]/pictures/route";
import {
  DELETE as deleteOne,
  PATCH as patchOne,
} from "@/app/api/admin/routes/[id]/pictures/[pictureId]/route";
import { DELETE as deleteRoute } from "@/app/api/admin/routes/[id]/route";

/**
 * The route picture gallery end to end (Rust `route_media_service`,
 * `admin/route_pictures.rs`, `routes/media.rs`): upload rules, content
 * addressing, list-insert reordering, deletion with object clean-up and the
 * strict key grammar of the public media proxy.
 */

declare global {
  interface Response {
    json(): Promise<any>;
  }
}

beforeAll(migrate);

let f: Fixture;
let admin: string;
beforeEach(async () => {
  setCloudflareContext({ UPLOADS: env.UPLOADS });
  f = await fixture(1);
  admin = await owner("admin");
  const stored = await env.UPLOADS.list();
  await env.UPLOADS.delete(stored.objects.map((o) => o.key));
});

/** A PNG header (signature + IHDR) of the given size; `salt` makes distinct content. */
function png(width: number, height: number, salt = 0): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b[32] = salt;
  return b;
}

const auth = async (who: string | null): Promise<Record<string, string>> =>
  who ? { authorization: `Bearer ${await signAccessToken(who)}` } : {};
const ctx = () => ({ params: Promise.resolve({ id: f.routeId }) });
const picture = (pictureId: string) => ({ params: Promise.resolve({ id: f.routeId, pictureId }) });

async function post(
  parts: [string, Blob | string][],
  who: string | null = admin,
  routeId = f.routeId,
): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of parts) form.append(name, value);
  return upload(
    new Request("https://datxevui.com/x", { method: "POST", body: form, headers: await auth(who) }),
    { params: Promise.resolve({ id: routeId }) },
  );
}
const file = (bytes: Uint8Array) =>
  ["file", new Blob([bytes as BlobPart], { type: "image/png" })] as [string, Blob];
const add = (w = 800, h = 600, salt = 0, alt?: string) =>
  post([file(png(w, h, salt)), ...(alt ? ([["alt_text", alt]] as [string, string][]) : [])]);

describe("uploading", () => {
  it("stores the original content-addressed, reads the size and answers 201 with Rust's body", async () => {
    const res = await add(1280, 720, 1, "  Bến xe  ");
    expect(res.status).toBe(201);
    const { ok, deduped, picture } = await res.json();
    expect({ ok, deduped }).toEqual({ ok: true, deduped: false });
    expect(picture).toMatchObject({
      routeId: f.routeId,
      sortOrder: 0,
      width: 1280,
      height: 720,
      mimeType: "image/png",
      sizeBytes: 33,
      altText: "Bến xe",
    });
    expect(picture.url).toMatch(new RegExp(`^/api/media/routes/${f.routeId}/[0-9a-f]{16}\\.png$`));
    expect(picture.thumbUrl).toBe(picture.url); // no Images binding: the original stands in
    const object = await env.UPLOADS.get(picture.url.replace("/api/media/", ""));
    expect(object?.httpMetadata).toMatchObject({
      contentType: "image/png",
      cacheControl: "public, max-age=31536000, immutable",
    });
  });

  it("answers 200 for the same content again and keeps one row", async () => {
    await add(10, 10, 5);
    const again = await add(10, 10, 5);
    expect(again.status).toBe(200);
    expect((await again.json()).deduped).toBe(true);
    expect(await (await getDb()).select().from(routePictures)).toHaveLength(1);
  });

  it("refuses what is not a picture of a route that exists, with Rust's statuses", async () => {
    const notImage = await post([["file", new Blob(["<html>"])]]);
    expect(notImage.status).toBe(400);
    expect((await notImage.json()).message).toContain("unsupported image format");
    expect((await post([file(png(0, 0))])).status).toBe(400); // unreadable header
    expect((await post([["alt_text", "x"]])).status).toBe(400); // no file
    expect((await post([file(png(1, 1, 1)), file(png(1, 1, 2))])).status).toBe(400); // two files
    expect((await add(1, 1, 3, "a".repeat(256))).status).toBe(400);
    expect((await post([file(png(1, 1, 4))], admin, crypto.randomUUID())).status).toBe(404);
  });

  it("caps a route at 12 pictures", async () => {
    for (let i = 0; i < 12; i++) expect((await add(10, 10, i)).status).toBe(201);
    const over = await add(10, 10, 99);
    expect(over.status).toBe(400);
    expect((await over.json()).message).toBe(
      "validation failed: route already has 12 pictures (max 12)",
    );
  });

  it("rejects an oversized body before reading it (413)", async () => {
    const res = await upload(
      new Request("https://datxevui.com/x", {
        method: "POST",
        headers: { ...(await auth(admin)), "content-length": String(11 * 1024 * 1024) },
        body: new FormData(),
      }),
      ctx(),
    );
    expect(res.status).toBe(413);
  });

  it("needs a signed-in admin with the routes:write permission", async () => {
    expect((await post([file(png(1, 1))], null)).status).toBe(401);
    expect((await post([file(png(1, 1))], await owner())).status).toBe(403);
  });
});

describe("the gallery", () => {
  async function seed(n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await (await add(10, 10, i)).json()).picture.id);
    return ids;
  }
  const order = async () =>
    (await (await publicGallery(new Request("https://x"), ctx())).json()).items.map(
      (p: any) => p.id,
    );

  it("lists in position order with the route id, publicly and for admins", async () => {
    const ids = await seed(3);
    const body = await (await publicGallery(new Request("https://x"), ctx())).json();
    expect(body.routeId).toBe(f.routeId);
    expect(body.items.map((p: any) => p.id)).toEqual(ids);
    const adminRes = await adminGallery(
      new Request("https://x", { headers: await auth(admin) }),
      ctx(),
    );
    expect((await adminRes.json()).items).toHaveLength(3);
    const empty = await publicGallery(new Request("https://x"), {
      params: Promise.resolve({ id: crypto.randomUUID() }),
    });
    expect((await empty.json()).items).toEqual([]);
  });

  async function patch(pictureId: string, body: unknown) {
    return patchOne(
      new Request("https://x", {
        method: "PATCH",
        headers: { ...(await auth(admin)), "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      picture(pictureId),
    );
  }

  it("moves a picture to a position and shifts the others (list-insert, not a tie)", async () => {
    const [a, b, c] = await seed(3);
    expect((await (await patch(c!, { sortOrder: 0 })).json()).sortOrder).toBe(0);
    expect(await order()).toEqual([c, a, b]);
    await patch(c!, { sortOrder: 99 }); // past the end: last
    expect(await order()).toEqual([a, b, c]);
    const rows = await (await getDb()).select().from(routePictures);
    expect(rows.map((r) => r.sortOrder).sort()).toEqual([0, 1, 2]);
  });

  it("sets and clears the alt text and validates the body", async () => {
    const [a] = await seed(1);
    expect((await (await patch(a!, { altText: " Cổng " })).json()).altText).toBe("Cổng");
    expect(await (await patch(a!, { altText: "   " })).json()).not.toHaveProperty("altText");
    expect((await patch(a!, { sortOrder: -1 })).status).toBe(400);
    expect((await patch(a!, { altText: "x".repeat(256) })).status).toBe(400);
    expect((await patch(crypto.randomUUID(), {})).status).toBe(404);
  });

  it("deletes one picture and its object, or the whole gallery", async () => {
    const [a] = await seed(3);
    const key = (await (await getDb()).select().from(routePictures))[0]!.storageKey;
    const res = await deleteOne(
      new Request("https://x", { method: "DELETE", headers: await auth(admin) }),
      picture(a!),
    );
    expect(await res.json()).toEqual({ ok: true, id: a });
    expect((await env.UPLOADS.list()).objects).toHaveLength(2);
    void key;
    const cleared = await clearGallery(
      new Request("https://x", { method: "DELETE", headers: await auth(admin) }),
      ctx(),
    );
    expect(await cleared.json()).toEqual({ ok: true, deleted: 2 });
    expect((await env.UPLOADS.list()).objects).toHaveLength(0);
    const missing = await deleteOne(
      new Request("https://x", { method: "DELETE", headers: await auth(admin) }),
      picture(a!),
    );
    expect(missing.status).toBe(404);
  });

  it("deleting a route removes its pictures' objects first", async () => {
    await seed(2);
    const res = await deleteRoute(
      new Request("https://x", { method: "DELETE", headers: await auth(admin) }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect((await env.UPLOADS.list()).objects).toHaveLength(0);
  });
});

describe("GET /api/media", () => {
  const get = (key: string, headers: Record<string, string> = {}) =>
    serve(new Request(`http://x/api/media/${key}`, { headers }), {
      params: Promise.resolve({ key: key.split("/") }),
    });
  const ROUTE_KEY = `routes/${"0".repeat(8)}-0000-0000-0000-000000000000/0123456789abcdef.webp`;
  const LOGO_KEY = "brands/logos/0123456789abcdef.svg";

  beforeEach(async () => {
    await env.UPLOADS.put(ROUTE_KEY, "webp-bytes", { httpMetadata: { contentType: "text/plain" } });
    await env.UPLOADS.put(
      LOGO_KEY,
      "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>",
      {
        httpMetadata: { contentType: "image/svg+xml" },
      },
    );
  });

  it("serves a route picture with the type from its key, the hash as ETag and immutable caching", async () => {
    const res = await get(ROUTE_KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("etag")).toBe('"0123456789abcdef"');
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("webp-bytes");
  });

  it("answers If-None-Match without reading storage, even when the object is gone", async () => {
    await env.UPLOADS.delete(ROUTE_KEY);
    for (const inm of [
      '"0123456789abcdef"',
      'W/"0123456789abcdef"',
      '"x", "0123456789abcdef"',
      "*",
    ]) {
      const res = await get(ROUTE_KEY, { "if-none-match": inm });
      expect(res.status, inm).toBe(304);
    }
    expect((await get(ROUTE_KEY, { "if-none-match": '"other"' })).status).toBe(404);
  });

  it("serves brand logos with the object's own ETag and neutralises active content", async () => {
    const first = await get(LOGO_KEY);
    expect(first.headers.get("content-type")).toBe("image/svg+xml");
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(first.headers.get("content-security-policy")).toContain("sandbox");
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
    await first.arrayBuffer();
    expect((await get(LOGO_KEY, { "if-none-match": etag })).status).toBe(304);
  });

  it("404s (plain text) every key this app did not generate, and a missing object", async () => {
    for (const key of [
      "nope.png",
      "a/b",
      "routes/x/y.jpg",
      "brands/logos/short.png",
      `routes/${"0".repeat(8)}-0000-0000-0000-000000000000/ffffffffffffffff.jpg`, // well-formed, absent
    ]) {
      const res = await serve(new Request(`http://x/api/media/${key}`), {
        params: Promise.resolve({ key: key.split("/") }),
      });
      expect(res.status, key).toBe(404);
      expect(await res.text()).toBe("media not found");
    }
    const traversal = await serve(new Request("http://x/api/media/a"), {
      params: Promise.resolve({ key: ["..", "x"] }),
    });
    expect(traversal.status).toBe(404);
  });
});

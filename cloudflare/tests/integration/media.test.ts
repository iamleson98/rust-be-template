import { beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { setCloudflareContext } from "../helpers/context";
import { GET } from "@/app/api/media/[...key]/route";

const KEY = "brands/logos/abc123.svg";

function get(headers: Record<string, string> = {}): Promise<Response> {
  return GET(new Request(`http://x/api/media/${KEY}`, { headers }), {
    params: Promise.resolve({ key: KEY.split("/") }),
  });
}

beforeAll(async () => {
  setCloudflareContext({ UPLOADS: env.UPLOADS });
  await env.UPLOADS.put(KEY, "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", {
    httpMetadata: { contentType: "image/svg+xml" },
  });
});

describe("GET /api/media", () => {
  it("serves a single-quoted ETag and answers If-None-Match with 304", async () => {
    const first = await get();
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
    await first.arrayBuffer();

    const again = await get({ "if-none-match": etag });
    expect(again.status).toBe(304);
    const weak = await get({ "if-none-match": `W/${etag}` });
    expect(weak.status).toBe(304);
    const stale = await get({ "if-none-match": '"other"' });
    expect(stale.status).toBe(200);
    await stale.arrayBuffer();
  });

  it("neutralises active content in uploaded SVGs", async () => {
    const res = await get();
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    await res.arrayBuffer();
  });

  it("404s a missing key and rejects traversal", async () => {
    const miss = await GET(new Request("http://x/api/media/nope.png"), {
      params: Promise.resolve({ key: ["nope.png"] }),
    });
    expect(miss.status).toBe(404);
    const bad = await GET(new Request("http://x/api/media/a"), {
      params: Promise.resolve({ key: ["..", "x"] }),
    });
    expect(bad.status).toBe(400);
  });
});

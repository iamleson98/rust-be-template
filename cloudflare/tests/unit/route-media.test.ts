import { describe, expect, it } from "vitest";
import {
  contentTypeOf,
  etagOf,
  keysFor,
  parseMediaKey,
  sniffFormat,
} from "@/lib/services/route-media";

// Port of the Rust `route_media_service.rs` tests, plus the header parsers
// that stand in for Rust's full image decode.
const ROUTE = "00000000-0000-0000-0000-000000000000";
const key = (hash: string, ext: string) => `routes/${ROUTE}/${hash}.${ext}`;
const bytes = (...v: number[]) => Uint8Array.from(v);

describe("sniffFormat", () => {
  it("rejects what is not an image", () => {
    expect(sniffFormat(new TextEncoder().encode("<html><body>"))).toBeNull();
    expect(sniffFormat(new Uint8Array())).toBeNull();
  });

  it("recognises JPEG, PNG and WebP by magic bytes", () => {
    expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2d))).toEqual({
      ext: "png",
      mime: "image/png",
    });
    const webp = new Uint8Array(12);
    webp.set(new TextEncoder().encode("RIFF"), 0);
    webp.set(new TextEncoder().encode("WEBP"), 8);
    expect(sniffFormat(webp)).toEqual({ ext: "webp", mime: "image/webp" });
  });
});

describe("parseMediaKey", () => {
  it("accepts the shapes the service generates", () => {
    const p = parseMediaKey(key("0123456789abcdef", "webp"))!;
    expect(p.hash16).toBe("0123456789abcdef");
    expect(p.thumb).toBe(false);
    expect(contentTypeOf(p)).toBe("image/webp");
    expect(etagOf(p)).toBe('"0123456789abcdef"');
    const t = parseMediaKey(`routes/${ROUTE}/t0123456789abcdef.webp`)!;
    expect(t.thumb).toBe(true);
    expect(contentTypeOf(t)).toBe("image/webp");
  });

  it("still serves objects stored before WebP (jpg and png originals, jpg thumbnails)", () => {
    expect(contentTypeOf(parseMediaKey(key("0123456789abcdef", "png"))!)).toBe("image/png");
    const legacyThumb = parseMediaKey(`routes/${ROUTE}/t0123456789abcdef.jpg`)!;
    expect(contentTypeOf(legacyThumb)).toBe("image/jpeg");
  });

  it("rejects hostile shapes", () => {
    for (const bad of [
      "routes/../../etc/passwd",
      `routes/${ROUTE}/../../../etc/passwd`,
      key("zzzzzzzzzzzzzzzz", "jpg"),
      key("0123456789abc", "jpg"),
      `other/${ROUTE}/0123456789abcdef.jpg`,
      `routes/${ROUTE}/t0123456789abcdef.png`, // a thumbnail is jpg or webp
      `routes/${ROUTE}/0123456789abcdef.jpg/extra`,
      "routes/not-a-uuid/0123456789abcdef.jpg",
    ]) {
      expect(parseMediaKey(bad), bad).toBeNull();
    }
  });
});

describe("keysFor", () => {
  it("builds the content-addressed pair, and both survive the strict parser", () => {
    const { key: full, thumbKey } = keysFor(ROUTE, "0123456789abcdef");
    expect(full).toBe(`routes/${ROUTE}/0123456789abcdef.webp`);
    expect(thumbKey).toBe(`routes/${ROUTE}/t0123456789abcdef.webp`);
    expect(parseMediaKey(full)).not.toBeNull();
    expect(parseMediaKey(thumbKey)).not.toBeNull();
  });
});

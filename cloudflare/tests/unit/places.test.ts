import { describe, expect, it } from "vitest";
import { MAX_SHARD_RECORDS, buildIndex, canonicalProvince, dedupe } from "@/lib/places/build";
import type { RawPlace } from "@/lib/places/format";
import {
  cachedLoader,
  candidateKeys,
  popularIndex,
  reverseIndex,
  searchIndex,
  type Loader,
} from "@/lib/places/search";

let nextId = 1;
function place(over: Partial<RawPlace> & Pick<RawPlace, "name">): RawPlace {
  return {
    osmId: nextId++,
    osmType: "node",
    kind: "city",
    province: "Hà Nội",
    district: null,
    ward: null,
    lat: 21.0,
    lon: 105.8,
    population: 0,
    ...over,
  };
}

/** A loader over the built files, counting fetches. */
function loaderFor(raw: RawPlace[]) {
  const { files, manifest } = buildIndex(raw, "2026-10-20T00:00:00.000Z");
  const fetched: string[] = [];
  const load: Loader = async (path) => {
    fetched.push(path);
    const body = files.get(path);
    return body === undefined ? null : JSON.parse(body);
  };
  return { load, fetched, files, manifest };
}

const FIXTURE: RawPlace[] = [
  place({
    name: "Hà Nội",
    kind: "city",
    province: "Thành phố Hà Nội",
    population: 8_000_000,
    lat: 21.03,
    lon: 105.85,
  }),
  place({
    name: "Hà Nội",
    osmType: "relation",
    kind: "province",
    province: "Thành phố Hà Nội",
    lat: 21.04,
    lon: 105.84,
  }),
  place({
    name: "Hải Phòng",
    kind: "city",
    province: "Thành phố Hải Phòng",
    population: 2_000_000,
    lat: 20.86,
    lon: 106.68,
  }),
  place({
    name: "Bến xe Mỹ Đình",
    kind: "bus_station",
    province: "Thành phố Hà Nội",
    district: "Nam Từ Liêm",
    lat: 21.028,
    lon: 105.78,
  }),
  place({
    name: "Bến xe Giáp Bát",
    kind: "bus_station",
    province: "Thành phố Hà Nội",
    district: "Hoàng Mai",
    lat: 20.98,
    lon: 105.84,
  }),
  place({
    name: "Hà Nội",
    kind: "rail_station",
    province: "Thành phố Hà Nội",
    lat: 21.024,
    lon: 105.841,
  }),
  place({
    name: "Sân bay Nội Bài",
    kind: "airport",
    province: "Thành phố Hà Nội",
    lat: 21.22,
    lon: 105.8,
  }),
  place({
    name: "Phường Bến Nghé",
    kind: "ward",
    province: "Thành phố Hồ Chí Minh",
    district: "Quận 1",
    lat: 10.78,
    lon: 106.7,
  }),
  place({ name: "Đà Lạt", kind: "city", province: "Tỉnh Lâm Đồng", lat: 11.94, lon: 108.44 }),
  place({
    name: "Hồ Hoàn Kiếm",
    altNames: ["Hồ Gươm"],
    kind: "nature",
    province: "Thành phố Hà Nội",
    lat: 21.0288,
    lon: 105.8523,
  }),
  place({
    name: "Bệnh viện Chợ Rẫy",
    kind: "amenity_hospital",
    province: "Thành phố Hồ Chí Minh",
    lat: 10.7576,
    lon: 106.6595,
  }),
  place({
    name: "Đường Nguyễn Huệ",
    kind: "road_primary",
    province: "Thành phố Hồ Chí Minh",
    lat: 10.7745,
    lon: 106.7036,
  }),
  place({
    name: "Đường Nguyễn Huệ",
    kind: "road_residential",
    province: "Thành phố Hồ Chí Minh",
    lat: 10.7747,
    lon: 106.7038,
  }),
];

describe("buildIndex", () => {
  it("merges an OSM node and relation for the same city into one place", () => {
    const merged = dedupe(FIXTURE);
    const hanoi = merged.filter((p) => p.name === "Hà Nội" && p.kind !== "rail_station");
    expect(hanoi).toHaveLength(1);
    expect(hanoi[0].kind).toBe("city"); // higher-priority kind wins
    expect(hanoi[0].population).toBe(8_000_000);
    expect(hanoi[0].province).toBe("Thành phố Hà Nội");
    // The railway station that shares the city's name is a different place.
    expect(merged.some((p) => p.name === "Hà Nội" && p.kind === "rail_station")).toBe(true);
  });

  it("maps OSM province spellings onto the app's own list, and rejects the rest", () => {
    expect(canonicalProvince("Tỉnh Lâm Đồng")).toBe("Lâm Đồng");
    expect(canonicalProvince("Thành phố Hà Nội")).toBe("Hà Nội");
    expect(canonicalProvince("Thành phố Hồ Chí Minh")).toMatch(/Hồ Chí Minh$/);
    // A city that became the province, known to the list by its alias.
    expect(canonicalProvince("Thành phố Huế")).toBe("Thừa Thiên Huế");
    expect(canonicalProvince("Tỉnh Hưng Yên")).toBe("Hưng Yên");
    expect(canonicalProvince("广西壮族自治区")).toBeNull();
    expect(canonicalProvince("Palawan")).toBeNull();
    expect(canonicalProvince(null)).toBeNull();
  });

  it("drops places outside the served provinces and reports how many", () => {
    const built = buildIndex(
      [
        place({ name: "Đà Lạt", province: "Tỉnh Lâm Đồng" }),
        place({ name: "Bằng Tường", kind: "city", province: "广西壮族自治区" }),
        place({ name: "广西壮族自治区", kind: "province", province: "广西壮族自治区" }),
        place({ name: "Lost point", province: null }),
      ],
      "t",
    );
    expect(built.manifest.count).toBe(1);
    expect(built.dropped).toBe(3);
  });

  it("lets a point borrow its province from a twin element", () => {
    const built = buildIndex(
      [
        place({ name: "Sa Pa", kind: "town", province: null, lat: 22.34, lon: 103.84 }),
        place({
          name: "Sa Pa",
          kind: "ward",
          province: "Tỉnh Lào Cai",
          lat: 22.33,
          lon: 103.85,
        }),
      ],
      "t",
    );
    expect(built.manifest.count).toBe(1);
    expect(JSON.parse(built.files.get("popular.json") ?? "[]")[0][3]).toBe("Lào Cai");
  });

  it("keeps same-named places that are far apart", () => {
    const merged = dedupe([
      place({ name: "Tân Phú", kind: "ward", lat: 10.79, lon: 106.62 }),
      place({ name: "Tân Phú", kind: "ward", lat: 11.3, lon: 107.4 }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("is deterministic and drops rows without usable coordinates", () => {
    const a = buildIndex([...FIXTURE, place({ name: "Nowhere", lat: Number.NaN })], "t");
    const b = buildIndex([...FIXTURE].reverse(), "t");
    expect([...a.files.entries()]).toEqual([...b.files.entries()]);
    expect(a.manifest.count).toBe(11);
  });

  it("splits oversized prefixes into longer keys without losing records", () => {
    const many = Array.from({ length: MAX_SHARD_RECORDS + 50 }, (_, i) =>
      place({
        name: `Tân Bình ${["An", "Cát", "Dũng"][i % 3]}${i}`,
        kind: "village",
        lat: 10 + (i % 40) * 0.2,
        lon: 100 + Math.floor(i / 40) * 0.2,
      }),
    );
    const { manifest, files } = buildIndex(many, "t");
    expect(manifest.keys.bin).toBeUndefined(); // "binh" moved to a 4-char key
    expect(manifest.keys.binh).toBe(many.length);
    expect(files.has("s/binh.json")).toBe(true);
  });

  it("never keys a record by a type word like Đường / Phường / Xã", () => {
    const built = buildIndex(
      [
        place({ name: "Đường Lê Lợi", kind: "village" }),
        place({ name: "Phường Bến Nghé", kind: "ward", lat: 10.78, lon: 106.7 }),
        place({ name: "Xã", kind: "village", lat: 12, lon: 107 }),
      ],
      "t",
    );
    const keys = Object.keys(built.manifest.keys);
    expect(keys).not.toContain("duo");
    expect(keys).not.toContain("phu");
    expect(keys).toContain("le");
    expect(keys).toContain("ben");
    // ...but a name made only of type words stays findable.
    expect(keys).toContain("xa");
  });
});

describe("searchIndex", () => {
  const { load } = loaderFor(FIXTURE);

  it("finds a place regardless of tones, case and spacing", async () => {
    for (const q of ["Hà Nội", "ha noi", "HANOI", "hà nội"]) {
      const hits = await searchIndex(load, q);
      expect(hits[0]?.name, q).toBe("Hà Nội");
    }
  });

  it("finds a multi-word name typed as one word, and vice versa", async () => {
    expect((await searchIndex(load, "hanoi"))[0]?.name).toBe("Hà Nội");
    expect((await searchIndex(load, "benxemydinh"))[0]?.name).toBe("Bến xe Mỹ Đình");
    expect((await searchIndex(load, "ben xe my dinh"))[0]?.name).toBe("Bến xe Mỹ Đình");
  });

  it("matches on prefixes while typing", async () => {
    const hits = await searchIndex(load, "bến xe mỹ");
    expect(hits.map((h) => h.name)).toEqual(["Bến xe Mỹ Đình"]);
    expect((await searchIndex(load, "hai ph"))[0]?.name).toBe("Hải Phòng");
  });

  it("finds a place by its alternative names, and shows the main one", async () => {
    const hits = await searchIndex(load, "ho guom");
    expect(hits[0]).toMatchObject({ name: "Hồ Hoàn Kiếm", type: "nature" });
    expect((await searchIndex(load, "hoguom"))[0]?.name).toBe("Hồ Hoàn Kiếm");
    expect((await searchIndex(load, "ho hoan kiem"))[0]?.name).toBe("Hồ Hoàn Kiếm");
  });

  it("finds landmarks and streets, merging one street's segments into one hit", async () => {
    expect((await searchIndex(load, "benh vien cho ray"))[0]).toMatchObject({
      type: "amenity_hospital",
    });
    const streets = (await searchIndex(load, "nguyen hue")).filter((h) =>
      h.type.startsWith("road_"),
    );
    expect(streets).toHaveLength(1);
    expect(streets[0].type).toBe("road_primary"); // the higher class wins the merge
  });

  it("treats type words (ga, bến xe, phường) as optional", async () => {
    const station = await searchIndex(load, "ga ha noi");
    expect(station.map((h) => h.type)).toContain("rail_station");
    expect((await searchIndex(load, "thanh pho ha noi"))[0]?.name).toBe("Hà Nội");
    // ...but a query of only type words still has to match them.
    const only = await searchIndex(load, "ben xe");
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((h) => /bến xe/i.test(h.name))).toBe(true);
  });

  it("does not let context-only matches outrank the place itself", async () => {
    const hits = await searchIndex(load, "ho chi minh");
    // Only the ward is inside Hồ Chí Minh in this fixture; the province is
    // not a place of its own here, so nothing should pretend to be it.
    expect(hits.every((h) => /^Phường Bến Nghé$/.test(h.name))).toBe(true);
  });

  it("uses address context (province / district) as extra tokens", async () => {
    const all = await searchIndex(load, "bến xe hà nội");
    // The two bus stations lead; the city itself only matches the address words.
    expect(
      all
        .slice(0, 2)
        .map((h) => h.name)
        .sort(),
    ).toEqual(["Bến xe Giáp Bát", "Bến xe Mỹ Đình"]);
    const one = await searchIndex(load, "ben xe hoang mai");
    expect(one.map((h) => h.name)).toEqual(["Bến xe Giáp Bát"]);
  });

  it("ranks the city above lesser matches and exposes the hit shape", async () => {
    const hits = await searchIndex(load, "ha noi");
    expect(hits[0]).toMatchObject({
      name: "Hà Nội",
      type: "city",
      nameNoTones: "ha noi",
      lat: 21.03,
      lon: 105.85,
    });
    expect(hits[0].id).toMatch(/^[nwr]\d+$/);
  });

  it("finds a street through its identifying words, with or without 'đường'", async () => {
    const { load } = loaderFor([
      place({ name: "Đường Lê Lợi", kind: "village", province: "Thành phố Hà Nội" }),
      place({
        name: "Phường Bến Nghé",
        kind: "ward",
        province: "Thành phố Hồ Chí Minh",
        lat: 10.78,
        lon: 106.7,
      }),
    ]);
    expect((await searchIndex(load, "duong le loi"))[0]?.name).toBe("Đường Lê Lợi");
    expect((await searchIndex(load, "le loi"))[0]?.name).toBe("Đường Lê Lợi");
    expect((await searchIndex(load, "p. bến nghé"))[0]?.name).toBe("Phường Bến Nghé");
  });

  it("expands administrative abbreviations", async () => {
    expect((await searchIndex(load, "P. Bến Nghé"))[0]?.name).toBe("Phường Bến Nghé");
  });

  it("falls back to another query token when the longest has no shard", async () => {
    const hits = await searchIndex(load, "zzzzzz da lat");
    expect(hits).toEqual([]); // every token must match: honest empty result
    expect((await searchIndex(load, "da lat"))[0]?.name).toBe("Đà Lạt");
  });

  it("returns [] for empty, symbol-only and unknown queries; honours the limit", async () => {
    expect(await searchIndex(load, "")).toEqual([]);
    expect(await searchIndex(load, "?!")).toEqual([]);
    expect(await searchIndex(load, "qwertyuiop")).toEqual([]);
    expect(await searchIndex(load, "ben", 1)).toHaveLength(1);
  });

  it("reads only the shard(s) a query needs, not the whole index", async () => {
    const probe = loaderFor(FIXTURE);
    await searchIndex(probe.load, "da lat");
    const shardReads = probe.fetched.filter((p) => p.startsWith("s/"));
    expect(shardReads.length).toBeLessThanOrEqual(4);
    expect(probe.fetched).not.toContain("popular.json");
  });

  it("returns nothing (not an error) when the index is missing", async () => {
    expect(await searchIndex(async () => null, "ha noi")).toEqual([]);
  });
});

describe("candidateKeys", () => {
  it("covers both shorter-than-key tokens and split keys", () => {
    const keys = { phu: 3, phuo: 1500, phuc: 40, ha: 5, han: 900 };
    // "phu" is kept: it still holds records whose token is exactly "phu".
    expect(candidateKeys(keys, "phuong")).toEqual(["phuo", "phu"]);
    expect(candidateKeys(keys, "ph")).toEqual(["phuo", "phuc", "phu"]);
    expect(candidateKeys(keys, "han")).toEqual(["han"]);
  });
});

describe("reverseIndex / popularIndex", () => {
  const { load } = loaderFor(FIXTURE);

  it("returns the nearest places first", async () => {
    const hits = await reverseIndex(load, 21.027, 105.781, 3);
    expect(hits[0].name).toBe("Hà Nội"); // the only area within range of this point
    expect(hits.length).toBeGreaterThan(0);
  });

  it("finds places in the neighbouring cell across a cell boundary", async () => {
    // Cell edges fall on multiples of 0.25°: 21.0 is the boundary here, and
    // Hà Nội (21.03) sits in the cell to the north of this point.
    const hits = await reverseIndex(load, 20.999, 105.85, 5);
    expect(hits.map((h) => h.name)).toContain("Hà Nội");
  });

  it("answers with areas rather than landmarks when both are near", async () => {
    // Mỹ Đình bus station is nearest, but the user is "in" a place, not a station.
    const hits = await reverseIndex(load, 21.028, 105.78, 3);
    expect(hits.every((h) => !["bus_station", "airport", "rail_station"].includes(h.type))).toBe(
      true,
    );
  });

  it("returns [] far from anything", async () => {
    expect(await reverseIndex(load, 0, 0)).toEqual([]);
  });

  it("lists the biggest places for the default autocomplete", async () => {
    const hits = await popularIndex(load, 3);
    expect(hits.map((h) => h.name)).toEqual(["Hà Nội", "Hải Phòng", "Đà Lạt"]);
  });
});

describe("cachedLoader", () => {
  it("fetches each file once, bounds its size, and does not cache misses", async () => {
    let calls = 0;
    const inner: Loader = async (path) => {
      calls++;
      return path.startsWith("missing") ? null : { path };
    };
    const load = cachedLoader(inner, 2);
    await load("a");
    await load("a");
    expect(calls).toBe(1);
    await load("missing");
    await load("missing");
    expect(calls).toBe(3);
    await load("b");
    await load("c"); // evicts the oldest ("a")
    await load("a");
    expect(calls).toBe(6);
  });

  it("does not cache a failed fetch", async () => {
    let calls = 0;
    const load = cachedLoader(async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return { ok: true };
    });
    await expect(load("x")).rejects.toThrow("boom");
    expect(await load("x")).toEqual({ ok: true });
  });
});

/**
 * Build the static place index from the extractor's NDJSON.
 *
 *   bun scripts/build-place-shards.ts <places.ndjson> [--out public/places]
 *
 * Pipeline (weekly CI, .github/workflows/place-index.yml):
 *   vietnam-latest.osm.pbf → tools/place-extract → places.ndjson → here
 *   → public/places/** → shipped with the Worker as static assets.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { buildIndex } from "../src/lib/places/build";
import type { RawPlace } from "../src/lib/places/format";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const outFlag = args.indexOf("--out");
const out = resolve(outFlag >= 0 ? args[outFlag + 1] : "public/places");

if (!input) {
  console.error("usage: bun scripts/build-place-shards.ts <places.ndjson> [--out dir]");
  process.exit(2);
}

const raw: RawPlace[] = readFileSync(input, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as RawPlace);
if (raw.length < 100) {
  // A near-empty extract means the download or the extractor failed; shipping
  // it would silently blank place search for a week.
  console.error(`refusing to publish an index of only ${raw.length} places`);
  process.exit(1);
}

const { files, manifest, dropped } = buildIndex(raw);

rmSync(out, { recursive: true, force: true });
let bytes = 0;
let gzipped = 0;
let largest = { path: "", size: 0 };
for (const [path, body] of files) {
  const target = join(out, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
  const size = Buffer.byteLength(body);
  bytes += size;
  gzipped += gzipSync(body).length;
  if (size > largest.size) largest = { path, size };
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
console.log(
  `place index: ${raw.length} extracted (${dropped} outside served provinces) → ${manifest.count} unique places, ` +
    `${files.size} files, ${mb(bytes)} MB (${mb(gzipped)} MB gzipped), ` +
    `${Object.keys(manifest.keys).length} search shards, ${manifest.cells.length} geo cells; ` +
    `largest ${largest.path} ${(largest.size / 1024).toFixed(0)} KB → ${out}`,
);

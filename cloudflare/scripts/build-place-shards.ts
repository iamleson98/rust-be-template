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

// Workers static assets: 20,000 files per version on the Free plan, 100,000 on
// Paid. The app's own build contributes roughly 3,000 of them.
const FREE_PLAN_FILES = 20_000;
const PAID_PLAN_FILES = 100_000;
const APP_ASSET_FILES = 3_500;
if (files.size + APP_ASSET_FILES > PAID_PLAN_FILES) {
  console.error(`index has ${files.size} files: over the Paid-plan asset limit`);
  process.exit(1);
}
if (files.size + APP_ASSET_FILES > FREE_PLAN_FILES) {
  console.warn(
    `note: ${files.size} index files + the app's assets exceed the Free plan's ` +
      `${FREE_PLAN_FILES}-file limit; deploying needs Workers Paid (or a smaller --profile)`,
  );
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
console.log(
  `place index: ${raw.length} extracted (${dropped} outside served provinces) → ${manifest.count} unique places, ` +
    `${files.size} files, ${mb(bytes)} MB (${mb(gzipped)} MB gzipped), ` +
    `${Object.keys(manifest.keys).length} search shards, ${manifest.cells.length} geo cells; ` +
    `largest ${largest.path} ${(largest.size / 1024).toFixed(0)} KB → ${out}`,
);

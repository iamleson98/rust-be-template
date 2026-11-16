/**
 * Writes `.br` (Brotli, quality 11) and `.gz` (gzip, level 9) twins of every
 * compressible file in `dist/`, so the backend's `ServeDir` hands them out
 * as they are (`precompressed_br` / `precompressed_gzip`) with no compression
 * work per request. Brotli is a good tenth smaller than gzip on the app's
 * scripts and styles, and every browser still in use sends `br`.
 *
 * Runs last in `bun run build`. A twin is written only when it is smaller
 * than the original; images and fonts are already compressed and are skipped.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
const COMPRESSIBLE = /\.(js|mjs|css|html|json|svg|txt|xml|webmanifest|ico|map)$/
const MIN_BYTES = 1024

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else yield path
  }
}

let written = 0
let saved = 0
for (const path of files(dist)) {
  if (!COMPRESSIBLE.test(path)) continue
  const source = readFileSync(path)
  if (source.length < MIN_BYTES) continue
  const twins = [
    [
      '.br',
      brotliCompressSync(source, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      }),
    ],
    ['.gz', gzipSync(source, { level: 9 })],
  ]
  for (const [ext, packed] of twins) {
    if (packed.length >= source.length) continue
    writeFileSync(path + ext, packed)
    written += 1
    if (ext === '.br') saved += source.length - packed.length
  }
}
console.log(
  '[precompress] ✓ wrote %d .br/.gz files (Brotli saves %d KB)',
  written,
  Math.round(saved / 1024),
)

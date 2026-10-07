/**
 * Regenerate the brand raster assets from the vector logo.
 *
 * Source of truth:
 *   - public/logo.svg      the "dx + heart" brand mark (white disc, soft
 *                          shadow, transparent outside the disc) — favicon,
 *                          in-app <img> brand marks.
 *   - public/logo-icon.svg the full-bleed square icon variant (brand
 *                          off-white background, disc at 86%, no shadow) —
 *                          app icons / PWA icons / apple-touch-icon.
 *
 * Outputs (committed to the repo):
 *   - public/icons/icon-192.png        (PWA, "any" + "maskable")
 *   - public/icons/icon-512.png        (PWA, "any" + "maskable")
 *   - public/icons/apple-touch-icon.png (180×180)
 *   - public/og-image.png              (1200×630 social share card)
 *
 * Not regenerated here (one-off, hand-tuned):
 *   - public/favicon.ico   multi-size ICO (16/32/48) — see git history.
 *   - mobile launcher / launch images — see git history.
 *
 * Run: bun run scripts/gen-icons.mjs   (or: node scripts/gen-icons.mjs)
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PUBLIC = resolve(ROOT, 'public')
const ICONS_DIR = resolve(PUBLIC, 'icons')

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('✗ sharp is required (it is a devDependency): bun install')
  process.exit(1)
}

const iconSvg = readFileSync(resolve(PUBLIC, 'logo-icon.svg'))
const markSvg = readFileSync(resolve(PUBLIC, 'logo.svg'))

// ── App / PWA icons: direct rasterization of the full-bleed variant ──────────
const iconTasks = [
  { size: 192, out: resolve(ICONS_DIR, 'icon-192.png') },
  { size: 512, out: resolve(ICONS_DIR, 'icon-512.png') },
  { size: 180, out: resolve(ICONS_DIR, 'apple-touch-icon.png') },
]
for (const { size, out } of iconTasks) {
  // 4× supersample then downscale for crisp small-size antialiasing.
  await sharp(iconSvg, { density: 96 * 4 })
    .resize(size, size)
    .png()
    .toFile(out)
  console.log(`✓ ${resolve(ROOT, out) ? out.slice(ROOT.length + 1) : out} (${size}×${size})`)
}

// ── og-image: 1200×630 social card (deep-blue brand gradient + mark) ─────────
const BLUE_DEEP = '#07254A'
const BLUE_MID = '#147CD3'
const ORANGE = '#F3740D'

// The mark SVG has its own viewBox (265 30 492 492) — nest it via <svg x y
// width height>; the outer <svg> supplies the card layout + typography.
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BLUE_MID}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${BLUE_MID}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.27" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${BLUE_MID}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="${BLUE_MID}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="${BLUE_DEEP}"/>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- echo rings, top right -->
  <circle cx="1180" cy="0" r="340" fill="none" stroke="#ffffff" stroke-opacity="0.06"/>
  <circle cx="1180" cy="0" r="260" fill="none" stroke="#ffffff" stroke-opacity="0.08"/>
  <circle cx="1180" cy="0" r="180" fill="none" stroke="#ffffff" stroke-opacity="0.10"/>

  <!-- brand mark (white disc pops on the deep blue) -->
  <svg x="80" y="115" width="400" height="400" viewBox="265 30 492 492">${markSvg
    .toString()
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')}</svg>

  <!-- typography -->
  <text x="560" y="248" font-family="Carlito, 'Segoe UI', sans-serif" font-size="108" font-weight="700" fill="#ffffff">DatXeVui</text>
  <text x="560" y="336" font-family="Carlito, 'Segoe UI', sans-serif" font-size="42" font-weight="700" fill="#d6e9fa">Đặt vé xe khách online</text>
  <text x="560" y="388" font-family="Carlito, 'Segoe UI', sans-serif" font-size="42" font-weight="700" fill="#d6e9fa">toàn Việt Nam</text>
  <rect x="560" y="424" width="120" height="4" rx="2" fill="${ORANGE}"/>
  <text x="560" y="480" font-family="Carlito, 'Segoe UI', sans-serif" font-size="30" fill="#a0bedc">limousine  ·  giường nằm  ·  ghế ngồi</text>
  <text x="560" y="545" font-family="Carlito, 'Segoe UI', sans-serif" font-size="40" font-weight="700" fill="${ORANGE}">datxevui.com</text>
</svg>`

await sharp(Buffer.from(ogSvg)).png({ quality: 90 }).toFile(resolve(PUBLIC, 'og-image.png'))
console.log('✓ public/og-image.png (1200×630)')

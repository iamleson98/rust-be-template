/**
 * Generate PWA icons (192×192, 512×512) + apple-touch-icon + og-image.
 * Uses `sharp` if installed; falls back to SVG-as-PNG otherwise.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PUBLIC = resolve(ROOT, 'public')
const ICONS_DIR = resolve(PUBLIC, 'icons')

mkdirSync(ICONS_DIR, { recursive: true })

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.warn('⚠️  sharp not installed — generating SVG-as-PNG fallback')
}

const BG = '#1d4ed8'

function maskableSvg(size) {
  const logoSize = size * 0.6
  const offset = (size - logoSize) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" />
  <g transform="translate(${offset} ${offset})">
    <svg width="${logoSize}" height="${logoSize}" viewBox="0 0 100 100">
      <rect x="20" y="35" width="60" height="40" rx="6" fill="#ffffff" />
      <circle cx="35" cy="75" r="6" fill="#1d4ed8" stroke="#fff" stroke-width="2" />
      <circle cx="65" cy="75" r="6" fill="#1d4ed8" stroke="#fff" stroke-width="2" />
      <rect x="30" y="20" width="40" height="15" rx="3" fill="#ffffff" opacity="0.9" />
    </svg>
  </g>
</svg>`
}

function ogImageSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e3a8a" />
      <stop offset="1" stop-color="#1d4ed8" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <text x="600" y="290" text-anchor="middle" font-family="-apple-system, Segoe UI, sans-serif" font-size="120" font-weight="800" fill="#ffffff">VeXeVN</text>
  <text x="600" y="380" text-anchor="middle" font-family="-apple-system, Segoe UI, sans-serif" font-size="36" font-weight="500" fill="#bfdbfe">Đặt vé xe khách online toàn Việt Nam</text>
  <text x="600" y="450" text-anchor="middle" font-family="-apple-system, Segoe UI, sans-serif" font-size="28" fill="#93c5fd">limousine · giường nằm · ghế ngồi</text>
</svg>`
}

const tasks = [
  { svg: maskableSvg(192), out: resolve(ICONS_DIR, 'icon-192.png') },
  { svg: maskableSvg(512), out: resolve(ICONS_DIR, 'icon-512.png') },
  { svg: maskableSvg(180), out: resolve(ICONS_DIR, 'apple-touch-icon.png') },
  { svg: ogImageSvg(), out: resolve(PUBLIC, 'og-image.png') },
]

if (sharp) {
  for (const t of tasks) {
    await sharp(Buffer.from(t.svg)).png().toFile(t.out)
    console.log('✓', resolve(ROOT, t.out).replace(ROOT, '.'))
  }
} else {
  for (const t of tasks) {
    writeFileSync(t.out, t.svg)
    console.log('✓ (svg-as-png)', resolve(ROOT, t.out).replace(ROOT, '.'))
  }
}
console.log('\nDone.')

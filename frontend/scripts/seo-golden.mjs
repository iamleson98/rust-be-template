/**
 * Writes `../tests/fixtures/seo-golden.json`: what the SPA's own head logic
 * (`pageSeo` in `src/lib/seo.ts`, with the Vietnamese strings) answers for a
 * spread of URLs. The backend renders the same head per request and its test
 * compares against this file, so the two cannot drift apart.
 *
 * Entries: `{ path, search, facts, expect }`
 *   - `path`   the URL path, percent-encoded as it arrives on the wire.
 *   - `search` the query string without the leading `?`.
 *   - `facts`  what only the database knows: `{ brand: { name, description } }`,
 *              `{}` when there is nothing to add, `null` for a brand page
 *              whose brand does not exist (the page answers 404).
 *   - `expect` `{ title, description, canonical, robots }`, or `null` when no
 *              page has that path (404). `canonical` is null for pages that
 *              are not indexed.
 *
 * Run: `bun run seo:golden` (after changing `src/lib/seo.ts` or its strings).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pageSeo } from '../src/lib/seo.ts'
import { vi } from '../src/lib/i18n/vi.ts'

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/seo-golden.json')

/** Crawlers and link previews get Vietnamese, filled in the way the server does. */
function t(key, params = {}) {
  let text = vi[key] ?? key
  for (const [name, value] of Object.entries(params))
    text = text.replaceAll(`{${name}}`, String(value))
  return text
}

const query = (pairs) => new URLSearchParams(pairs).toString()
const brand = (name, description = null) => ({ brand: { name, description } })

/** [path, query pairs, facts]; facts null = the brand is unknown. */
const CASES = [
  ['/', [], {}],
  ['/', [['utm_source', 'zalo']], {}],
  ['/search', [], {}],
  ['/search', [['date', '2026-12-01']], {}],
  ['/search', [['from', 'Hà Nội']], {}],
  ['/search', [['to', 'Đà Nẵng']], {}],
  [
    '/search',
    [
      ['from', 'Hà Nội'],
      ['to', 'Đà Nẵng'],
    ],
    {},
  ],
  [
    '/search',
    [
      ['from', 'Hà Nội'],
      ['to', 'Đà Nẵng'],
      ['date', '2026-12-01'],
      ['passengers', '2'],
    ],
    {},
  ],
  [
    '/search',
    [
      ['from', '  Sài Gòn '],
      ['to', ' Đà Lạt'],
    ],
    {},
  ],
  [
    '/search',
    [
      ['from', 'Hà Nội'],
      ['to', '   '],
    ],
    {},
  ],
  [
    '/search',
    [
      ['from', ''],
      ['to', 'Huế'],
    ],
    {},
  ],
  [
    '/search',
    [
      ['from', 'Phan Rang - Tháp Chàm'],
      ['to', 'Nha Trang & Cam Ranh'],
    ],
    {},
  ],
  ['/compare', [], {}],
  ['/privacy', [], {}],
  ['/terms', [], {}],
  ['/brands/phuong-trang', [], brand('Phương Trang', 'Hãng xe khách lớn nhất miền Nam.')],
  ['/brands/phuong-trang', [], brand('Phương Trang', null)],
  ['/brands/phuong-trang', [], brand('Phương Trang', '')],
  ['/brands/phuong-trang', [], brand('Phương Trang', '   ')],
  ['/brands/phuong-trang', [], brand('Phương Trang', '  Xe giường nằm, limousine.  ')],
  ['/brands/phuong-trang', [], {}],
  ['/brands/thanh-buoi', [], brand('Thành Bưởi & Co "Express"')],
  ['/brands/limousine-vi%E1%BB%87t', [], brand('Limousine Việt', 'Đi Hà Nội — Hải Phòng.')],
  ['/brands/khong-co', [], null],
  ['/brands', [], {}],
  ['/brands/', [], {}],
  ['/brands/a/b', [], {}],
  ['/trips/3f2c8c1e-0a52-4a9b-9e3a-1f5c2d7a9b10', [], {}],
  ['/trips', [], {}],
  ['/bookings/DXV-ABC123', [], {}],
  ['/payments/3f2c8c1e-0a52-4a9b-9e3a-1f5c2d7a9b10/return', [], {}],
  ['/payments/3f2c8c1e-0a52-4a9b-9e3a-1f5c2d7a9b10', [], {}],
  ['/login', [], {}],
  ['/login', [['redirect', '/account']], {}],
  ['/admin', [], {}],
  ['/admin/brands', [], {}],
  ['/account', [], {}],
  ['/account/trips/DXV-ABC123', [], {}],
  ['/search/', [], {}],
  ['/privacy/', [], {}],
  ['/does-not-exist', [], {}],
  ['/SEARCH', [], {}],
  ['/index.html', [], {}],
]

const golden = CASES.map(([path, pairs, facts]) => {
  const search = query(pairs)
  const seo = facts === null ? null : pageSeo(path, new URLSearchParams(search), t, facts)
  return { path, search, facts, expect: seo }
})

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(golden, null, 2) + '\n', 'utf-8')
console.log('[seo-golden] ✓ wrote tests/fixtures/seo-golden.json (%d entries)', golden.length)

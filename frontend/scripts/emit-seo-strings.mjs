/**
 * Writes `dist/seo-strings.json`: `{ key: Vietnamese text }` for every
 * translation key the page head is built from (`SEO_STRING_KEYS` in
 * `src/lib/seo.ts`). The backend renders each page's `<head>` from these
 * strings, filling `{name}`, `{from}` and `{to}` itself, so the browser's
 * `document.title` and the server's `<title>` come from one source.
 *
 * Runs after `vite build` (`bun run build`); fails when a key has no text.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEO_STRING_KEYS } from '../src/lib/seo.ts'
import { vi } from '../src/lib/i18n/vi.ts'

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/seo-strings.json')

const missing = SEO_STRING_KEYS.filter((key) => typeof vi[key] !== 'string')
if (missing.length > 0) {
  console.error('[seo-strings] ✗ no Vietnamese text for: %s', missing.join(', '))
  process.exit(1)
}

const strings = Object.fromEntries(SEO_STRING_KEYS.map((key) => [key, vi[key]]))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(strings, null, 2) + '\n', 'utf-8')
console.log('[seo-strings] ✓ wrote dist/seo-strings.json (%d keys)', SEO_STRING_KEYS.length)

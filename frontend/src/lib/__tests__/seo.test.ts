import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { vi } from '@/lib/i18n/vi'
import { SEO_STRING_KEYS, SITE_URL, matchPage, pageSeo, type PageFacts } from '@/lib/seo'

/** Vietnamese, filled in the way the server renders a head. */
const t = (key: string, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), vi[key] ?? key)
const seo = (path: string, query = '', facts: PageFacts = {}) =>
  pageSeo(path, new URLSearchParams(query), t, facts)

interface GoldenEntry {
  path: string
  search: string
  /** `null`: a brand page whose brand does not exist (404). */
  facts: PageFacts | null
  expect: ReturnType<typeof seo>
}

// The oracle the backend's head renderer is tested against too.
const golden: GoldenEntry[] = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../../tests/fixtures/seo-golden.json'), 'utf-8'),
)

describe('seo golden fixture (tests/fixtures/seo-golden.json)', () => {
  it('has entries to compare against', () => {
    expect(golden.length).toBeGreaterThan(30)
    expect(golden.some((e) => e.expect === null)).toBe(true)
    expect(golden.some((e) => e.expect?.canonical === null)).toBe(true)
  })

  it.each(golden.map((e) => [`${e.path}${e.search ? `?${e.search}` : ''}`, e] as const))(
    'head of %s matches the golden entry',
    (_label, entry) => {
      // An unknown brand has no facts at all: the page answers 404 before any head.
      const actual = entry.facts === null ? null : seo(entry.path, entry.search, entry.facts)
      expect(actual).toEqual(entry.expect)
    },
  )
})

describe('page SEO', () => {
  it('knows every page the SPA serves, and nothing else', () => {
    for (const path of ['/', '/search', '/compare', '/privacy', '/terms', '/brands/x']) {
      expect(matchPage(path)?.kind).toBe('public')
    }
    expect(matchPage('/trips/1')?.kind).toBe('noindex')
    for (const path of [
      '/login',
      '/admin',
      '/admin/system',
      '/account/trips/AB12',
      '/bookings/AB12',
      '/payments/1/return',
    ]) {
      expect(matchPage(path)?.kind).toBe('private')
    }
    for (const path of ['/random', '/brands', '/brands/x/y', '/adminx', '/payments/1', '/SEARCH']) {
      expect(matchPage(path)).toBeNull()
    }
  })

  it('makes a corridor search a page of its own, whatever its date', () => {
    const page = seo('/search', 'from=Hà Nội&to=Đà Nẵng&date=2026-10-30&sort=price')!
    expect(page.title).toContain('Hà Nội đi Đà Nẵng')
    expect(page.robots).toBe('index, follow')
    expect(page.canonical).toBe(
      `${SITE_URL}/search?from=H%C3%A0+N%E1%BB%99i&to=%C4%90%C3%A0+N%E1%BA%B5ng`,
    )
    expect(seo('/search', 'from=Hà Nội')!.canonical).toBe(`${SITE_URL}/search`)
  })

  it('names the brand on its page, preferring its own description', () => {
    const plain = seo('/brands/phuong-trang', '', {
      brand: { name: 'Phương Trang', description: null },
    })!
    expect(plain.title).toContain('Phương Trang')
    expect(plain.description).toContain('Phương Trang')
    expect(plain.canonical).toBe(`${SITE_URL}/brands/phuong-trang`)
    const described = seo('/brands/phuong-trang', '', {
      brand: { name: 'Phương Trang', description: '  Giường nằm.  ' },
    })!
    expect(described.description).toBe('Giường nằm.')
  })

  it('keeps staff, account and departed-trip pages out of the index', () => {
    expect(seo('/admin/system')).toMatchObject({ robots: 'noindex, nofollow', canonical: null })
    expect(seo('/trips/abc')).toMatchObject({ robots: 'noindex, follow', canonical: null })
  })

  it('has Vietnamese text for every key the server renders a head from', () => {
    for (const key of SEO_STRING_KEYS) expect(vi[key], key).toBeTruthy()
  })
})

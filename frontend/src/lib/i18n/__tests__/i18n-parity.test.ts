import { describe, expect, it, vi as vitest } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { vi as viCore } from '@/lib/i18n/vi'
import { en as enCore } from '@/lib/i18n/en'
import { viAdmin } from '@/lib/i18n/vi-admin'
import { enAdmin } from '@/lib/i18n/en-admin'

const viDict = { ...viCore, ...viAdmin }
const enDict = { ...enCore, ...enAdmin }

/**
 * Dictionary parity guard — the vi and en dictionaries must carry
 * EXACTLY the same key set. A missing translation would silently render
 * the raw i18n key (or the wrong language after the fallback chain), so
 * drift is caught here at CI time instead.
 */
describe('i18n dictionaries', () => {
  it('vi and en expose the same key set', () => {
    const viKeys = Object.keys(viDict).sort()
    const enKeys = Object.keys(enDict).sort()
    expect(viKeys).toEqual(enKeys)
  })

  it('no empty translations', () => {
    for (const [key, value] of Object.entries(viDict)) {
      expect(value.trim(), `vi.${key} is empty`).not.toBe('')
    }
    for (const [key, value] of Object.entries(enDict)) {
      expect(value.trim(), `en.${key} is empty`).not.toBe('')
    }
  })

  it('placeholder params match across languages', () => {
    // Every {param} used in the vi string must appear in the en string
    // (and vice versa) — otherwise one language interpolates a value the
    // other drops.
    const placeholders = (s: string) =>
      Array.from(s.matchAll(/\{(\w+)\}/g))
        .map((m) => m[1])
        .sort()
        .join(',')
    for (const [key, viValue] of Object.entries(viDict)) {
      const enValue = enDict[key]
      expect(placeholders(viValue), `placeholder mismatch for ${key}`).toBe(placeholders(enValue))
    }
  })

  it('keeps every key in the one file that its language and area belong to', async () => {
    // The console merges its strings into the core maps in place; read fresh ones.
    vitest.resetModules()
    const freshVi = (await import('@/lib/i18n/vi')).vi
    const freshEn = (await import('@/lib/i18n/en')).en
    for (const key of Object.keys(viAdmin)) expect(Object.hasOwn(freshVi, key), key).toBe(false)
    for (const key of Object.keys(enAdmin)) expect(Object.hasOwn(freshEn, key), key).toBe(false)
    expect(Object.keys(viAdmin).sort()).toEqual(Object.keys(enAdmin).sort())
  })

  it('uses the console strings only inside the console, which is what loads them', () => {
    const consoleKeys = new Set(Object.keys(viAdmin))
    const inConsole = (path: string) =>
      path.includes(`${sep}features${sep}admin${sep}`) ||
      path.includes(`${sep}app${sep}layout${sep}admin`) ||
      path.includes(`${sep}i18n${sep}`) ||
      path.includes('__tests__')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !inConsole(path)) files.push(path)
      }
    }
    walk(join(import.meta.dirname, '../../..'))
    const literal = /['"`]([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9_.]+)['"`]/g
    const leaks: string[] = []
    for (const file of files) {
      for (const [, key] of readFileSync(file, 'utf-8').matchAll(literal)) {
        if (consoleKeys.has(key)) leaks.push(`${file}: ${key}`)
      }
    }
    expect(leaks).toEqual([])
  })
})

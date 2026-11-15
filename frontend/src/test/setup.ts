/**
 * Vitest test setup — runs before every test file.
 *
 * - Mocks browser APIs that jsdom doesn't implement.
 * - Provides global helpers (render, screen, etc.).
 */

import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// ── Web storage ──────────────────────────────────────────────
// Node 25+ ships its own `localStorage` / `sessionStorage` globals. Without
// `--localstorage-file` they are an unusable placeholder that shadows jsdom's
// real Storage (reads give undefined, so `localStorage.clear()` throws).
// Point the globals back at jsdom's own implementation.
{
  const dom = (globalThis as { jsdom?: { window: Window } }).jsdom
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    // Never read the global first: touching Node's placeholder logs a warning.
    if (dom) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: true,
        get: () => dom.window[name],
      })
    }
  }
}

// Auto-cleanup after each test (unmount React components).
afterEach(() => {
  cleanup()
})

// ── Mock matchMedia (used by useMediaQuery, shadcn/ui) ─────────
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// ── Mock IntersectionObserver (used by LazySection) ───────────
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = '0px'
  readonly thresholds: ReadonlyArray<number> = []
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn().mockReturnValue([])
}
window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

// ── Mock ResizeObserver (used by some shadcn components) ──────
class MockResizeObserver implements ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

// ── Mock Element.getAnimations (Base UI waits on exit animations) ──
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => []
}

// ── Mock scrollTo (jsdom doesn't implement it) ────────────────
window.scrollTo = vi.fn()

// ── Mock navigator.sendBeacon (web vitals) ───────────────────
if (!navigator.sendBeacon) {
  ;(
    navigator as Navigator & { sendBeacon?: (url: string, data?: BodyInit) => boolean }
  ).sendBeacon = vi.fn().mockReturnValue(true)
}

// ── Mock crypto.randomUUID ───────────────────────────────────
if (!crypto.randomUUID) {
  ;(crypto as Crypto & { randomUUID?: () => string }).randomUUID = () =>
    '00000000-0000-4000-8000-000000000000'
}

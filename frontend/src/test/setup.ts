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
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn().mockReturnValue([])
}
;(window as any).IntersectionObserver = MockIntersectionObserver

// ── Mock ResizeObserver (used by some shadcn components) ──────
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
;(window as any).ResizeObserver = MockResizeObserver

// ── Mock scrollTo (jsdom doesn't implement it) ────────────────
window.scrollTo = vi.fn()

// ── Mock navigator.sendBeacon (web vitals) ───────────────────
if (!navigator.sendBeacon) {
  ;(navigator as any).sendBeacon = vi.fn().mockReturnValue(true)
}

// ── Mock crypto.randomUUID ───────────────────────────────────
if (!crypto.randomUUID) {
  ;(crypto as any).randomUUID = () =>
    '00000000-0000-4000-8000-000000000000'
}

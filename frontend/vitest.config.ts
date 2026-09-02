import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Vitest configuration. Runs in jsdom (widest API coverage — many shadcn/ui
// components depend on layout primitives like getBoundingClientRect and
// matchMedia that jsdom implements more completely than happy-dom).
//
// Coverage: V8 provider (faster than Istanbul, no instrumentation needed).
// Reporters: text + html + json-summary. Includes source files except
// generated types, test setup itself, entry points, and shadcn/ui primitives.
//
// Unit tests match src/**/*.test.{ts,tsx} — the Playwright browser tests in
// /e2e (UI component gallery) are excluded here; run them with
// `bun run test:e2e`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/test/**',
        'src/entry-*.tsx',
        'src/components/ui/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})

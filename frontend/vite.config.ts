import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import viteCompression from 'vite-plugin-compression'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'

// ── Vite 8 config for the VeXeVN SPA ───────────────────────────
// Produces a client bundle that the Rust (Axum) backend serves as
// static files. The homepage is pre-rendered to static HTML at build
// time (see prerender.mjs) for SEO; interactive views (search, chat,
// booking, login, admin) are lazy-loaded client-side islands.
//
// Precompressed assets: `vite-plugin-compression` emits `.gz` (gzip)
// and `.br` (brotli) sidecar files for every asset ≥1024 bytes. The
// Rust `ServeDir::precompressed_gzip()` / `.precompressed_br()`
// fallback in `backend-rust/src/main.rs` serves these directly when
// the client advertises `Accept-Encoding: gzip` / `br`, skipping
// runtime compression entirely. Net effect: ~70-85% smaller wire
// bytes for JS/CSS at zero per-request CPU cost.
export default defineConfig({
  plugins: [
    react(),
    // Gzip sidecars — compatible with every browser since ~2002.
    viteCompression({ algorithm: 'gzip', threshold: 1024 }),
    // Brotli sidecars — ~15-20% smaller than gzip; supported by every
    // modern browser (Chrome 50+, Firefox 44+, Safari 11+).
    viteCompression({ algorithm: 'brotliCompress', threshold: 1024 }),
    // Bundle visualizer — emits dist/stats.html with a treemap of the
    // production bundle. Run `bun run build:client` and open the file
    // to spot oversized deps / duplicate imports.
    visualizer({
      open: false,
      filename: 'dist/stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  css: {
    postcss: './postcss.config.mjs',
  },
  build: {
    outDir: 'dist',
    // Modern browsers only — smaller bundles (no transpilation of class
    // fields, optional chaining, nullish coalescing, top-level await, etc.
    // down to ES5/ES2015).
    target: 'es2022',
    // CSS code-split per chunk (Vite default; explicit so future versions
    // don't change behavior under us).
    cssCodeSplit: true,
    // Vite 8 uses Oxc (rolldown) as its built-in minifier — `true` selects it.
    // The legacy `'esbuild'` value is deprecated in Vite 8 and requires the
    // `esbuild` package to be installed separately. Oxc is faster and produces
    // comparable gzipped sizes for this bundle shape.
    minify: true,
    // Generate an ssr-manifest so the prerender step can map chunk
    // imports to their built asset paths.
    ssrManifest: true,
    // Raise the warning threshold — the app shell (React + Base UI + store
    // + i18n + forms + TanStack Query) legitimately weighs ~250KB gzip;
    // the lazy islands are already code-split. manualChunks below keeps
    // the shell stable across island updates for better long-term caching.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'index.html'),
      output: {
        // Rolldown (Vite 8) requires manualChunks as a FUNCTION, not an object.
        // Split vendor code into stable, cacheable chunks. Islands that
        // import the same vendor lib (e.g. Base UI Dialog used by both
        // BookingDialog and ChatWidget) will share a single vendor chunk,
        // so navigating between islands doesn't re-download React.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          // React core — changes almost never; cached effectively forever.
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react'
          }
          // Base UI primitives — shared across most shadcn/ui components.
          if (id.includes('@base-ui/react')) {
            return 'vendor-base-ui'
          }
          // Form validation stack — used by every form island.
          if (
            id.includes('react-hook-form') ||
            id.includes('@hookform/resolvers') ||
            id.includes('/zod/')
          ) {
            return 'vendor-form'
          }
          // TanStack Query — server state management.
          if (id.includes('@tanstack/react-query')) {
            return 'vendor-query'
          }
          // Leaflet map — heavy (~155KB), only needed for map views.
          if (id.includes('leaflet') || id.includes('react-leaflet')) {
            return 'vendor-leaflet'
          }
          // Charts — heavy, only needed by admin dashboard.
          if (id.includes('recharts') || id.includes('d3-')) {
            return 'vendor-charts'
          }
          // Icons — shared by shell + all islands.
          if (id.includes('lucide-react')) {
            return 'vendor-icons'
          }
          // Date utilities — used by search + booking calendars.
          if (id.includes('date-fns') || id.includes('react-day-picker')) {
            return 'vendor-date'
          }
          // Everything else in node_modules goes to a generic vendor chunk.
          return 'vendor-misc'
        },
      },
    },
  },
  server: {
    // Bind to 0.0.0.0 so the Caddy gateway (reverse-proxying to :3000)
    // can reach the Vite dev server from outside the container.
    host: '0.0.0.0',
    // Port 3000 matches the Caddyfile's default upstream so the SPA is
    // served at the sandbox preview URL with no extra config.
    port: 3000,
    // Proxy all backend routes to the Rust (Axum) backend on :8080.
    //
    // The frontend SDK uses RELATIVE URLs (e.g. /api/auth/me) so all
    // HTTP requests go through this proxy → same-origin → cookies work.
    // WsClient + AudioCallWidget also use window.location.host (i.e.
    // localhost:3000) → same-origin → Vite proxies the WS upgrade.
    //
    // IMPORTANT: '/ws-call' MUST be listed BEFORE '/ws' — Vite matches
    // proxy entries by path prefix, and '/ws-call' starts with '/ws'.
    // If '/ws' is first, it catches '/ws-call' too and proxies it to
    // the wrong endpoint.
    proxy: {
      // HTTP API — all /api/* requests go to the backend.
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // WebSocket — audio-call signaling relay.
      // MUST be listed BEFORE '/ws' — Vite matches proxy entries by
      // path prefix in insertion order. Since '/ws-call' starts with
      // '/ws', the '/ws' rule would catch it first if listed before.
      '/ws-call': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
      // WebSocket — chat hub. Vite intercepts the HTTP upgrade
      // request and proxies it to the backend's /ws endpoint.
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
      // Other backend routes.
      '/health': 'http://localhost:8080',
      '/docs': 'http://localhost:8080',
      '/swagger-ui': 'http://localhost:8080',
      '/api-docs': 'http://localhost:8080',
      '/sitemap.xml': 'http://localhost:8080',
      '/robots.txt': 'http://localhost:8080',
      '/sw.js': 'http://localhost:8080',
    },
  },
})

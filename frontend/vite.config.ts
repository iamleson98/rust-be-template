import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'

// ── Vite 8 config for the VeXeVN SPA ───────────────────────────
// Produces a client bundle that the Rust (Axum) backend serves as
// static files. The homepage is pre-rendered to static HTML at build
// time (see prerender.mjs) for SEO; interactive views (search, chat,
// booking, login, admin) are lazy-loaded client-side islands.
//
// Precompressed assets: `scripts/precompress.mjs` (the last step of
// `bun run build`) writes `.br` and `.gz` twins of every compressible file.
// The backend's `ServeDir::precompressed_br()` / `.precompressed_gzip()`
// (`src/web/mod.rs`) serves them directly when the client advertises
// `Accept-Encoding: br` / `gzip`, with no per-request compression work.
/**
 * Where the dev server sends API and WebSocket traffic: the backend on :8080
 * unless DEV_API_TARGET says otherwise (a second backend on another port).
 */
const API = process.env.DEV_API_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [
    react(),
    // Bundle visualizer — `ANALYZE=1 bun run build:client` writes
    // dist/stats.html, a treemap of the production bundle, to spot oversized
    // deps / duplicate imports. Not part of a release: the file is 1.5 MB.
    ...(process.env.ANALYZE
      ? [visualizer({ open: false, filename: 'dist/stats.html', gzipSize: true, brotliSize: true })]
      : []),
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
    // (The basemap is a raster CARTO TileLayer since the OpenFreeMap/
    // MapLibre-GL bridge removal — no ~950KB vector renderer chunk anymore,
    // only Leaflet's ~155KB, lazy-loaded by map views.)
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'index.html'),
      output: {
        // Chunks follow what a first visit needs. React and everything the
        // entry imports statically (router, query, the parts of Base UI the
        // header uses, i18n, stores) become three cacheable files. What a page
        // loads later is grouped by library so it arrives in a few files, not
        // one per icon: the rest of Base UI, the icons, the form and date
        // libraries, the shared UI components, Leaflet. (Grouping a whole
        // library into one chunk *first* made the first page download the
        // parts only other pages use: all of Base UI, every icon the admin
        // shows, the form and date libraries.) Groups are filled in priority
        // order: a module the first visit needs stays in its initial chunk.
        codeSplitting: {
          groups: [
            // Changes only when React does: cached for as long as the release lives.
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 5,
            },
            { name: 'vendor', test: /node_modules/, tags: ['$initial'], priority: 4 },
            { name: 'app', tags: ['$initial'], priority: 3 },
            { name: 'vendor-leaflet', test: /node_modules[\\/].*leaflet/, priority: 2 },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react/, priority: 2 },
            {
              name: 'vendor-base-ui',
              test: /node_modules[\\/](@base-ui|@floating-ui)/,
              priority: 2,
            },
            {
              name: 'vendor-date',
              test: /node_modules[\\/](date-fns|react-day-picker)/,
              priority: 2,
            },
            {
              name: 'vendor-form',
              test: /node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/,
              priority: 2,
            },
            { name: 'ui', test: /src[\\/]components[\\/]ui[\\/]/, priority: 2 },
          ],
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
    // Proxy all backend routes to the Rust (Axum) backend (`API`, :8080).
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
        target: API,
        changeOrigin: true,
      },
      // WebSocket — audio-call signaling relay.
      // MUST be listed BEFORE '/ws' — Vite matches proxy entries by
      // path prefix in insertion order. Since '/ws-call' starts with
      // '/ws', the '/ws' rule would catch it first if listed before.
      '/ws-call': {
        target: API,
        ws: true,
        changeOrigin: true,
      },
      // WebSocket — chat hub. Vite intercepts the HTTP upgrade
      // request and proxies it to the backend's /ws endpoint.
      // target must be http:// (not ws://) — Vite's http-proxy uses
      // the target for the initial HTTP upgrade handshake.
      '/ws': {
        target: API,
        ws: true,
        changeOrigin: true,
      },
      // Other backend routes.
      '/health': API,
      '/docs': API,
      '/swagger-ui': API,
      '/api-docs': API,
      '/sitemap.xml': API,
      '/robots.txt': API,
      '/sw.js': API,
    },
  },
})

/**
 * Prerender script — runs AFTER `vite build` to produce the final
 * `dist/index.html` with the homepage shell rendered to static HTML.
 *
 * Flow:
 *  1. `vite build` produces:
 *     - `dist/index.html` (template, has `<!--app-html-->` placeholder + <script> tags)
 *     - `dist/assets/*.{js,css}` (client bundles)
 *     - `dist/.vite/ssr-manifest.json` (chunk → asset mapping)
 *  2. This script loads `entry-server.tsx` via Vite's SSR loader, calls
 *     `render('/')` to get the HTML string, and injects it into the
 *     template in place of `<!--app-html-->`.
 *  3. The result is written back to `dist/index.html`.
 *
 * The static HTML gives us:
 *  - Real SEO content (crawlers see the marketing copy without executing JS)
 *  - Fast first paint (no blank white screen while JS downloads)
 *  - Progressive enhancement (islands hydrate on demand)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { gzipSync, brotliCompressSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = __dirname
const distDir = resolve(root, 'dist')

async function main() {
  const templatePath = resolve(distDir, 'index.html')
  let template = readFileSync(templatePath, 'utf-8')

  // Load the server entry via Vite's SSR module system (handles TSX, aliases).
  const vite = await createServer({
    root,
    mode: 'production',
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    const { render } = await vite.ssrLoadModule('/src/entry-server.tsx')
    const appHtml = await render('/')

    // Inject the rendered HTML where the placeholder lives.
    template = template.replace('<!--app-html-->', appHtml)

    writeFileSync(templatePath, template, 'utf-8')
    console.log('[prerender] ✓ wrote dist/index.html (%d bytes)', template.length)

    // Re-compress so the Rust backend's precompressed_gzip / precompressed_br
    // serve the prerendered HTML, not the stale placeholder from vite build.
    const buf = Buffer.from(template, 'utf-8')
    writeFileSync(templatePath + '.gz', gzipSync(buf, { level: 9 }))
    writeFileSync(templatePath + '.br', brotliCompressSync(buf))
    console.log('[prerender] ✓ regenerated index.html.gz and index.html.br')
  } finally {
    await vite.close()
  }
}

main().catch((err) => {
  console.error('[prerender] ✗ failed:', err)
  process.exit(1)
})

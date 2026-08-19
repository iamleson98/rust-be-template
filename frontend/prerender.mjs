/**
 * Prerender script — runs AFTER `vite build` to produce the final
 * `dist/index.html` with the homepage shell rendered to static HTML.
 *
 * Also injects Google Search Console verification + GA4 script tags
 * from env vars (VITE_GSC_VERIFICATION, VITE_GA4_ID).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { gzipSync, brotliCompressSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = __dirname
const distDir = resolve(root, 'dist')

// ── Google env vars ────────────────────────────────────────────
const GSC_VERIFICATION = process.env.VITE_GSC_VERIFICATION?.trim() || ''
const GA4_ID = process.env.VITE_GA4_ID?.trim() || ''

async function main() {
  const templatePath = resolve(distDir, 'index.html')
  let template = readFileSync(templatePath, 'utf-8')

  // ── Inject Google Search Console verification meta tag ──────
  // Replaces `<!-- %VITE_GSC_VERIFICATION_META% -->` in index.html.
  if (GSC_VERIFICATION) {
    const gscTag = `<meta name="google-site-verification" content="${GSC_VERIFICATION}" />`
    template = template.replace('<!-- %VITE_GSC_VERIFICATION_META% -->', gscTag)
    console.log('[prerender] ✓ injected Google Search Console verification')
  } else {
    template = template.replace('<!-- %VITE_GSC_VERIFICATION_META% -->', '')
  }

  // ── Inject GA4 script tags ───────────────────────────────────
  // Replaces `<!-- %VITE_GA4_SCRIPT% -->` in index.html.
  if (GA4_ID) {
    const ga4Script = `
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA4_ID}', { send_page_view: false });
</script>`
    template = template.replace('<!-- %VITE_GA4_SCRIPT% -->', ga4Script)
    console.log('[prerender] ✓ injected GA4 (ID: %s)', GA4_ID)
  } else {
    template = template.replace('<!-- %VITE_GA4_SCRIPT% -->', '')
  }

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

/**
 * Prerender script — runs AFTER `vite build` to finish `dist/index.html`
 * (the Google tags) and to write `dist/<page>.html` for the content pages in
 * PAGES (the backend serves those for `/<page>`), so crawlers and the OAuth
 * providers' reviewers read the privacy policy and terms without running
 * scripts. Every other page is a client-rendered shell: the backend fills
 * `<!--app-head-->` in these files per request (title, description,
 * canonical, robots, Open Graph, structured data).
 *
 * Also injects the Google tags into the built template, from env vars:
 *   - `VITE_GSC_VERIFICATION` — Search Console verification meta tag
 *   - `VITE_GA4_ID`           — GA4 measurement (G-…)
 *   - `VITE_GOOGLE_ADS_ID`    — Google Ads tag (AW-…)
 *   - `VITE_GOOGLE_ADS_CONVERSIONS` — JSON map of conversion labels
 *     (see docs/GOOGLE_ADS.md)
 *
 * gtag.js is one shared script regardless of how many Google tag IDs
 * exist — the script src just needs any one of them; each ID gets its
 * own `gtag('config', …)` line.
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
const GOOGLE_ADS_ID = process.env.VITE_GOOGLE_ADS_ID?.trim() || ''
const GOOGLE_ADS_CONVERSIONS = process.env.VITE_GOOGLE_ADS_CONVERSIONS?.trim() || ''

/** Content pages whose text is prerendered into their own `dist/<page>.html`. */
const PAGES = ['/privacy', '/terms']

/** Writes `file` plus the .gz/.br twins the backend serves precompressed. */
function writeHtml(file, html) {
  writeFileSync(file, html, 'utf-8')
  const buf = Buffer.from(html, 'utf-8')
  writeFileSync(file + '.gz', gzipSync(buf, { level: 9 }))
  writeFileSync(file + '.br', brotliCompressSync(buf))
}

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

  // ── Inject Google tags (GA4 + Google Ads) ──────────────────────
  // Replaces `<!-- %GOOGLE_TAGS% -->` in index.html. One gtag.js
  // script, one config line per configured tag ID, plus the Ads
  // conversion-label map as a tiny runtime config object.
  //
  // The conversion-label script must run before the app bundle so
  // `window.__GOOGLE_ADS_CONVERSIONS__` is set before any
  // `trackConversion()` call — head placement guarantees that.
  const tagIds = [GA4_ID, GOOGLE_ADS_ID].filter(Boolean)
  if (tagIds.length > 0) {
    const configLines = [
      ...(GA4_ID ? [`gtag('config', '${GA4_ID}', { send_page_view: false });`] : []),
      ...(GOOGLE_ADS_ID ? [`gtag('config', '${GOOGLE_ADS_ID}');`] : []),
    ]
    const conversionsScript = GOOGLE_ADS_CONVERSIONS
      ? `\n  window.__GOOGLE_ADS_CONVERSIONS__ = ${GOOGLE_ADS_CONVERSIONS};`
      : ''
    const googleTagsScript = `
<script async src="https://www.googletagmanager.com/gtag/js?id=${tagIds[0]}"></script>
<script>${conversionsScript}
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  ${configLines.join('\n  ')}
</script>`
    template = template.replace('<!-- %GOOGLE_TAGS% -->', googleTagsScript)
    console.log(
      '[prerender] ✓ injected Google tags (GA4: %s, Ads: %s, conversions: %s)',
      GA4_ID || '—',
      GOOGLE_ADS_ID || '—',
      GOOGLE_ADS_CONVERSIONS ? 'yes' : 'no',
    )
  } else {
    template = template.replace('<!-- %GOOGLE_TAGS% -->', '')
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

    for (const url of PAGES) {
      const html = template.replace('<!--app-html-->', await render(url))
      writeHtml(resolve(distDir, `${url.slice(1)}.html`), html)
      console.log('[prerender] ✓ wrote dist%s.html (%d bytes)', url, html.length)
    }

    // The shell the backend serves for every other page: no prerendered body.
    // Re-compressed so the backend's precompressed_gzip / precompressed_br
    // serve this file, not the placeholder from vite build.
    template = template.replace('<!--app-html-->', '')
    writeHtml(templatePath, template)
    console.log('[prerender] ✓ wrote dist/index.html (+ .gz, .br; %d bytes)', template.length)
  } finally {
    await vite.close()
  }
}

main().catch((err) => {
  console.error('[prerender] ✗ failed:', err)
  process.exit(1)
})

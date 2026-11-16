/**
 * Prerender script — runs AFTER `vite build` to finish `dist/index.html`
 * (the Google tags) and to write `dist/<page>.html` for the content pages in
 * PAGES (the backend serves those for `/<page>`), so crawlers and the OAuth
 * providers' reviewers read the privacy policy and terms without running
 * scripts. Every other page is a client-rendered shell: the backend fills
 * `<!--app-head-->` in these files per request (title, description,
 * canonical, robots, Open Graph, structured data) and `<!--app-html-->` with
 * the page's text (`src/web/content.rs`), which the app replaces on mount.
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
 * own `gtag('config', …)` line. The script itself is fetched once the page
 * has loaded and the browser is idle, never in the way of the first paint:
 * the `gtag()` calls queue in `dataLayer` until it arrives.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

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

/**
 * Starts the app's scripts once the page has loaded (its hero photo, styles
 * and fonts included) and painted, instead of in the middle of loading them:
 * the first paint is the server's HTML, so it needs no script, and a script
 * that downloads and compiles beside the photo takes the bandwidth and the
 * main thread the photo is waiting for. A timer starts them anyway if `load`
 * is slow (a stuck image). The links the
 * server wrote work meanwhile as ordinary navigations.
 */
function deferAppScripts(html) {
  // The entry script and the preload links Vite wrote for its static imports.
  const tag =
    /(?:<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"><\/script>|<link rel="modulepreload" crossorigin href="(\/assets\/[^"]+\.js)">)\s*/g
  const sources = [...html.matchAll(tag)].map((m) => m[1] ?? m[2])
  if (sources.length === 0) throw new Error('no module script in the built index.html')
  const loader = `<script>
      (function () {
        var sources = ${JSON.stringify(sources)};
        var started = false;
        function start() {
          if (started) return;
          started = true;
          sources.forEach(function (src) {
            var script = document.createElement('script');
            script.type = 'module';
            script.crossOrigin = '';
            script.src = src;
            document.head.appendChild(script);
          });
        }
        // A moment after load: the photo and the text have been presented by then.
        addEventListener('load', function () {
          setTimeout(start, 250);
        });
        setTimeout(start, 3000);
      })();
    </script>`
  return html.replace(tag, '').replace('</head>', `${loader}\n  </head>`)
}

async function main() {
  const templatePath = resolve(distDir, 'index.html')
  let template = deferAppScripts(readFileSync(templatePath, 'utf-8'))

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
<script>${conversionsScript}
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  ${configLines.join('\n  ')}
  addEventListener('load', function () {
    (window.requestIdleCallback ? function (f) { requestIdleCallback(f, { timeout: 4000 }); } : function (f) { setTimeout(f, 2000); })(function () {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=${tagIds[0]}';
      document.head.appendChild(s);
    });
  });
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
      writeFileSync(resolve(distDir, `${url.slice(1)}.html`), html, 'utf-8')
      console.log('[prerender] ✓ wrote dist%s.html (%d bytes)', url, html.length)
    }

    // The shell the backend serves for every other page: no prerendered body;
    // the `<!--app-html-->` marker stays for the backend to fill per page.
    writeFileSync(templatePath, template, 'utf-8')
    console.log('[prerender] ✓ wrote dist/index.html (%d bytes)', template.length)
  } finally {
    await vite.close()
  }
}

main().catch((err) => {
  console.error('[prerender] ✗ failed:', err)
  process.exit(1)
})

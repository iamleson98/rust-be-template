/**
 * Server entry — used by prerender.mjs to render the app to static HTML
 * at build time. This is NOT shipped to the client; it only runs in Node
 * during `bun run build:prerender`.
 *
 * We create a fresh router with memory history for the requested URL,
 * load the route (awaiting any route-level loaders), then render with a
 * fresh QueryClient.
 *
 * ── Why two-pass rendering (not `renderToString` alone) ───────────
 * The app uses `React.lazy()` + `<Suspense>` for code-splitting both
 * route components (HomePage, SearchPage, …) and persistent shell
 * pieces (Header's NotificationBell / WishlistButton / LoyaltyWidget,
 * Footer, MobileNav, SupportFab). The legacy `renderToString` API is
 * synchronous and predates Suspense — it throws
 *   "The server used renderToString which does not support Suspense"
 * the moment it hits any Suspense boundary.
 *
 * Switching to `renderToReadableStream` alone fixes the crash but
 * produces HTML where lazy content lives in `<div hidden id="S:n">`
 * blocks at the bottom of the document, swapped in client-side via
 * `$RC("B:n","S:n")` scripts. Googlebot (executes JS) sees the content
 * after hydration, but crawlers that don't run JS (Bingbot's first pass,
 * Facebook/Twitter link preview, readers) see an empty `<main>`.
 *
 * The two-pass approach gets us the best of both worlds:
 *
 *   PASS 1 — `renderToReadableStream`
 *     Renders the full tree. Every `React.lazy()` component suspends,
 *     its dynamic-import promise resolves (Vite's SSR loader resolves
 *     synchronously), and React caches the resolved component on the
 *     lazy wrapper. We discard the HTML output from this pass.
 *
 *   PASS 2 — `renderToString`
 *     Renders the same tree again. Now every `React.lazy()` component
 *     finds its resolved component in the cache and renders inline —
 *     NO Suspense boundary is hit, so `renderToString` works fine. The
 *     output is fully inlined HTML: the home page's marketing copy
 *     (hero, popular routes, brands, testimonials, FAQ, …) is plain,
 *     crawler-visible HTML inside `<main>`. Maximum SEO.
 *
 * Client hydration + code-splitting behaviour is unchanged — the lazy
 * chunks still load on demand on the client.
 *
 * ── CJS / ESM interop ─────────────────────────────────────────────
 * `react-dom/server` resolves to a CommonJS module under Node. Vite's
 * SSR module runner can statically detect some named exports
 * (`renderToString` has been on the allow-list since React 16) but NOT
 * `renderToReadableStream` (added in React 18). Importing it as a
 * named export throws:
 *   "Named export 'renderToReadableStream' not found. The requested
 *    module 'react-dom/server' is a CommonJS module, …"
 * The workaround recommended by Node's own interop error message is to
 * grab the default export and destructure at runtime — that's what we
 * do below. The `as typeof import('react-dom/server')` cast preserves
 * full type safety.
 *
 * ── Error handling ─────────────────────────────────────────────────
 * If pass 2 still hits a Suspense boundary (e.g. a lazy component that
 * wasn't triggered in pass 1 because it's conditionally rendered), we
 * fall back to the pass-1 streaming HTML — still SEO-useful (content
 * in hidden divs, visible to Googlebot). If even pass 1 fails fatally,
 * we return an empty string so the build still produces a valid
 * `dist/index.html` (the client mounts a fresh root, see
 * `entry-client.tsx` → `hasSSRContent` check).
 */
import ReactDOMServer from 'react-dom/server'
import type { ReactElement } from 'react'
import { createMemoryHistory } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from './router'

const { renderToString, renderToReadableStream } =
  ReactDOMServer as typeof import('react-dom/server')

/** Remove inline <script> blocks injected by TanStack Router (scroll
 *  restoration) — they violate `script-src 'self'` CSP and are useless
 *  in a static prerender. */
function stripInlineScripts(html: string): string {
  return html.replace(/<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/gi, '')
}

/**
 * Render a React element to a full HTML string using the streaming
 * renderer. We collect the entire `ReadableStream` into a string via
 * `new Response(stream).text()` — this waits for all Suspense
 * boundaries to resolve, giving us the complete HTML (with lazy
 * content in hidden divs + swap scripts).
 */
async function renderToFullStringStreaming(
  element: ReactElement,
  onError: (err: unknown) => void,
): Promise<string> {
  const stream = await renderToReadableStream(element, { onError })
  return await new Response(stream).text()
}

export async function render(url: string = '/'): Promise<string> {
  const history = createMemoryHistory({ initialEntries: [url] })
  const router = createAppRouter(history)
  // Load any route-level loaders (beforeLoad, etc.) before rendering.
  try {
    await router.load()
  } catch {
    // If a route guard throws (e.g. /admin redirect), we still render
    // the shell — the client will handle the redirect on hydration.
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })

  // Mirror entry-client.tsx exactly (minus StrictMode/ErrorBoundary — pure wrappers)
  // so the server-rendered tree matches what hydrateRoot sees on the client.
  const app = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  // ── Preload lazy chunks ──────────────────────────────────────────
  // Putting the modules in Node's import cache before pass 1 means the
  // `React.lazy()` dynamic-import promises resolve on the same
  // microtask, so React caches the resolved components by the time
  // pass 2 runs. (Without this, the first render still triggers the
  // load, but adding it is belt-and-suspenders and costs nothing at
  // runtime — the modules are needed anyway.)
  await Promise.all([
    import('./routes/home'),
    import('./components/bus/footer'),
    import('./components/bus/mobile-nav'),
    import('./components/bus/support-fab'),
    import('./components/bus/notification-bell'),
    import('./components/bus/wishlist-button'),
    import('./components/bus/loyalty-widget'),
  ])

  // ── PASS 1: streaming render to warm React.lazy's cache ─────────
  // The streaming renderer handles Suspense — every lazy component
  // suspends, its promise resolves, and React stores the resolved
  // component on the lazy wrapper. We keep the output as a fallback
  // in case pass 2 fails.
  const ssrWarnings: unknown[] = []
  let streamingHtml = ''
  try {
    streamingHtml = await renderToFullStringStreaming(
      app,
      (err) => ssrWarnings.push(err),
    )
  } catch (fatalErr) {
    console.error('[render] Pass 1 (streaming) failed:', fatalErr)
    // No fallback HTML available — return empty shell
    return ''
  }

  // ── PASS 2: sync render — lazy components are cached, no Suspense ─
  // Now every `React.lazy()` wrapper has its resolved component cached,
  // so rendering the same tree again hits NO Suspense boundaries. The
  // legacy `renderToString` API works fine and produces fully inlined
  // HTML (no hidden divs, no swap scripts) — maximum SEO.
  try {
    const inlinedHtml = renderToString(app)
    if (ssrWarnings.length > 0) {
      console.warn(
        `[render] Pass 1 had ${ssrWarnings.length} non-fatal warning(s):`,
        ssrWarnings.map((e) => (e instanceof Error ? e.message : String(e))).join('; '),
      )
    }
    return stripInlineScripts(inlinedHtml)
  } catch (err) {
    // A Suspense boundary was still hit in pass 2 (shouldn't happen
    // for the home route, but could for other routes with lazy
    // components we didn't preload). Fall back to the streaming HTML
    // — content is in hidden divs, still visible to Googlebot.
    console.warn(
      '[render] Pass 2 (sync) hit a Suspense boundary; falling back to streaming HTML:',
      err instanceof Error ? err.message : err,
    )
    return stripInlineScripts(streamingHtml)
  }
}

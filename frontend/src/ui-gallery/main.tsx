/**
 * Dev-only entry point for the UI component gallery.
 *
 * This page is NOT part of the production bundle — vite.config.ts's
 * rollupOptions.input only lists index.html, so `ui-gallery.html` is
 * served exclusively by the Vite dev server at /ui-gallery.html.
 *
 * It exists so Playwright (see /e2e) can exercise every base
 * shadcn/ui component in src/components/ui/ with the exact same
 * Tailwind 4 + Geist + Base UI pipeline the real app uses.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Gallery } from './gallery'
import '../styles.css'

// The InfiniteSelect demo needs a QueryClient context — same setup the
// real app provides, kept permissive for a demo page (no retries).
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 5_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Gallery />
    </QueryClientProvider>
  </StrictMode>,
)

/**
 * Client entry — hydrates the server-rendered HTML (production) or mounts
 * a fresh client-side render (dev mode, where no prerendered HTML exists).
 *
 * TanStack Router handles all routing client-side after hydration. The
 * prerender step (prerender.mjs) renders the home route to static HTML
 * for SEO + fast first paint.
 */
import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import App from './App'
import { QueryProvider } from './components/providers/query-provider'
import { ErrorBoundary } from './components/error-boundary'
import './styles.css'

const rootEl = document.getElementById('root')!

const app = (
  <StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <App />
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>
)

// Static prerender: always mount fresh. The prerendered HTML provides SEO
// content and fast first paint; React takes over without needing to match
// the SSR router instance, avoiding hydration mismatches (#418).
createRoot(rootEl).render(app)

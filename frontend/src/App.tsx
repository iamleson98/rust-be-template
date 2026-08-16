/**
 * Root app component.
 *
 * The app shell (Header + Footer + persistent overlays) lives in the
 * root route (`src/router.tsx` → RootComponent). This file just mounts
 * the TanStack Router provider and the global Toaster.
 *
 * Routing is URL-driven: every view has a real path (`/`, `/search`,
 * `/trips/$id`, `/brands/$slug`, `/bookings`, `/admin`, `/map`,
 * `/login`, `/compare`). Browser history, deep links, and SEO all work
 * out of the box.
 *
 * Server state is owned by TanStack Query (see `src/lib/queries/`).
 * Transient UI dialog state (chat, booking flow, auth, share, etc.)
 * is owned by the Zustand store (see `src/lib/store.ts`).
 */
import { RouterProvider } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { router } from './router'

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster position="top-right" richColors closeButton />
    </>
  )
}

/**
 * QueryProvider — wraps the app in a TanStack Query QueryClientProvider.
 *
 * Created as a client component so the QueryClient is instantiated once
 * per browser session (not on every render).
 */

import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '@/lib/query-client'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createQueryClient())
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

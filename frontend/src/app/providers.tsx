import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '@/api/query-client'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createQueryClient())
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

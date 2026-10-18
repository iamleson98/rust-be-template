'use client'

import { useEffect, useState } from 'react'

/**
 * Debounce a fast-changing value (e.g. a search input) so effect-heavy
 * consumers (server queries) fire at most once per `delay` ms.
 *
 * Used by the infinite-scroll select to avoid a request per keystroke —
 * the community-standard pattern for search-as-you-type.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    // Cancel the pending update when `value` changes again first.
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

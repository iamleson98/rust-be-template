import { useEffect, useState } from 'react'
import { storage } from '@/stores/storage'
import type { Filters } from './filters'

const KEY = 'bus_saved_searches'
const LIMIT = 20

export type SavedSearch = {
  id: string
  savedAt: number
  from: string
  to: string
  date: string
  adults: number
  children: number
  sort: string
  vehicleTypes: string[]
  filters: Filters
}

/** Starred searches, kept in localStorage (read after mount so SSR markup matches). */
export function useSavedSearches() {
  const [items, setItems] = useState<SavedSearch[]>([])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(storage.getJson<SavedSearch[]>(KEY, []))
  }, [])

  const commit = (next: SavedSearch[]) => {
    setItems(next)
    storage.setJson(KEY, next)
  }
  return {
    items,
    add: (search: Omit<SavedSearch, 'id' | 'savedAt'>) =>
      commit([{ ...search, id: `s${Date.now()}`, savedAt: Date.now() }, ...items].slice(0, LIMIT)),
    remove: (id: string) => commit(items.filter((s) => s.id !== id)),
  }
}

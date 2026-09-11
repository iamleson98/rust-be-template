'use client'

/**
 * Saved searches — localStorage-backed list of searches the user starred
 * on the results page. `loadSavedSearches` / `persistSavedSearches` + the
 * `SavedSearch` type are used by `search-results.tsx` (which owns the state
 * and the save/apply handlers); `SavedSearchesList` renders the chips.
 *
 * Extracted from the original `search-results.tsx`.
 */

import { Bookmark, X } from 'lucide-react'
import type { Filters } from './helpers'

const SAVED_SEARCHES_KEY = 'bus_saved_searches'

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

export function loadSavedSearches(): SavedSearch[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY)
    return raw ? (JSON.parse(raw) as SavedSearch[]) : []
  } catch {
    return []
  }
}

export function persistSavedSearches(items: SavedSearch[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(items))
  } catch { }
}

export function SavedSearchesList({
  savedSearches,
  applySavedSearch,
  removeSavedSearch,
}: {
  savedSearches: SavedSearch[]
  applySavedSearch: (s: SavedSearch) => void
  removeSavedSearch: (id: string) => void
}) {
  return (
    <div className="mb-3 rounded-xl border bg-rose-50/40 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 mb-2">
        <Bookmark className="h-3.5 w-3.5" />
        Tìm kiếm đã lưu ({savedSearches.length})
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
        {savedSearches.slice(0, 6).map((s) => (
          <div
            key={s.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-2 py-1 text-[11px]"
          >
            <button
              onClick={() => applySavedSearch(s)}
              className="text-rose-700 font-medium hover:underline"
            >
              {s.from} → {s.to}
            </button>
            <span className="text-muted-foreground">• {s.date}</span>
            <button
              onClick={() => removeSavedSearch(s.id)}
              className="text-muted-foreground hover:text-rose-600"
              title="Xoá"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

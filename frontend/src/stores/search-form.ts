import { create } from 'zustand'
import { parseSearch, type SearchParams } from '@/lib/search-params'
import { storage } from './storage'

const KEY = 'bus_search_params'

function defaults(): SearchParams {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return {
    ...parseSearch({}),
    from: 'Hà Nội',
    to: 'Đà Nẵng',
    date: tomorrow.toISOString().slice(0, 10),
  }
}

/** A `/search` deep link seeds the form; places and date fall back to the defaults. */
function fromUrl(base: SearchParams): SearchParams {
  const q = parseSearch(Object.fromEntries(new URLSearchParams(window.location.search)))
  return { ...q, from: q.from || base.from, to: q.to || base.to, date: q.date || base.date }
}

function initial(): SearchParams {
  const base = defaults()
  if (typeof window === 'undefined') return base
  if (window.location.pathname === '/search') return fromUrl(base)
  return { ...base, ...storage.getJson<Partial<SearchParams>>(KEY, {}) }
}

type SearchFormState = {
  searchParams: SearchParams
  setSearchParams: (patch: Partial<SearchParams>) => void
}

/** The home search widget's draft, persisted so the last query is remembered. */
export const useSearchForm = create<SearchFormState>((set) => ({
  searchParams: initial(),
  setSearchParams: (patch) =>
    set((s) => {
      const searchParams = { ...s.searchParams, ...patch }
      storage.setJson(KEY, searchParams)
      return { searchParams }
    }),
}))

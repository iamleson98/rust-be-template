/**
 * Search route — `/search`
 *
 * Typed search params (via `validateSearch` in router.tsx) — all OPTIONAL
 * so the URL stays clean (no `?...&vehicleTypes=%5B%5D&roundTrip=false` noise):
 *   ?from=Hà+Nội&to=Đà+Nẵng&date=2026-08-05
 *   &adults=1&children=0  (only present when non-default)
 *   &sort=price           (only present when non-default)
 *   &vt=limousine,sleeper (only present when filters active)
 *
 * Defaults (adults=1, children=0, sort='departure', vehicleTypes=[],
 * roundTrip=false, returnDate='') are applied HERE at read time.
 */
import { useSearch, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useApp, type SearchParams } from '@/lib/store'
import { SearchResults } from '@/components/search/search-results'

export type RouteSearch = {
  from: string
  to: string
  date: string
  adults: number
  children: number
  sort: 'departure' | 'price' | 'duration' | 'rating'
  vehicleTypes: string[]
  roundTrip: boolean
  returnDate: string
}

export function SearchPage() {
  const raw = useSearch({ from: '/search' })
  const { searchParams, setSearchParams } = useApp()
  const navigate = useNavigate()

  // Apply defaults — the URL only carries non-default values for cleanliness.
  const search: RouteSearch = {
    from: raw.from ?? '',
    to: raw.to ?? '',
    date: raw.date ?? '',
    adults: raw.adults ?? 1,
    children: raw.children ?? 0,
    sort: raw.sort ?? 'departure',
    vehicleTypes: raw.vehicleTypes ?? [],
    roundTrip: raw.roundTrip ?? false,
    returnDate: raw.returnDate ?? '',
  }

  // Sync the router's search params into the store's searchParams so
  // the SearchWidget form stays in sync with the URL.
  useEffect(() => {
    const next: Partial<SearchParams> = {
      from: search.from,
      to: search.to,
      date: search.date,
      adults: search.adults,
      children: search.children,
      sort: search.sort,
      vehicleTypes: search.vehicleTypes,
      roundTrip: search.roundTrip,
      returnDate: search.returnDate,
    }
    const cur = useApp.getState().searchParams
    const changed =
      cur.from !== next.from ||
      cur.to !== next.to ||
      cur.date !== next.date ||
      cur.adults !== next.adults ||
      cur.children !== next.children ||
      cur.sort !== next.sort ||
      cur.vehicleTypes.join(',') !== (next.vehicleTypes ?? []).join(',') ||
      cur.roundTrip !== next.roundTrip ||
      cur.returnDate !== next.returnDate
    if (changed) setSearchParams(next)
  }, [search, setSearchParams])

  return <SearchResults routeSearch={search} navigate={navigate} />
}

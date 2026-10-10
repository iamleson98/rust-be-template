import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { routesOptions } from '@/api'
import { useT } from '@/lib/i18n'
import { buildSearchInput, type SearchParams } from '@/lib/search-params'
import { cn } from '@/lib/utils'

/** "TP. Hồ Chí Minh" → "Hồ Chí Minh": chips stay short. */
const short = (name: string) => name.replace(/^(TP\.|Tp\.|Thành phố)\s*/u, '')

/**
 * One-tap shortcuts under the home search card: the platform's own routes
 * (the same list as the popular-routes section), each filling the form and
 * running the search with the date and passengers already chosen.
 */
export function PopularRoutesQuickSelect({
  searchParams,
  setSearchParams,
}: {
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const { data } = useQuery(routesOptions())
  const routes = useMemo(() => {
    const seen = new Set<string>()
    return (data?.items ?? [])
      .filter((r) => {
        const key = `${r.from.name}→${r.to.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 5)
  }, [data])

  if (routes.length === 0) return null

  const go = (from: string, to: string) => {
    setSearchParams({ from, to })
    navigate({
      to: '/search',
      search: buildSearchInput({
        from,
        to,
        date: searchParams.date,
        adults: searchParams.adults,
        children: searchParams.children,
        sort: searchParams.sort,
        vehicleTypes: searchParams.vehicleTypes,
        roundTrip: searchParams.roundTrip,
        returnDate: searchParams.returnDate,
      }),
    })
  }

  return (
    <div className="mt-4 flex items-center gap-2 overflow-x-auto border-t border-slate-100 pt-4 scrollbar-none">
      <span className="shrink-0 text-xs font-medium text-slate-500">
        {t('search.popularRoutes')}:
      </span>
      {routes.map((r) => {
        const active = searchParams.from === r.from.name && searchParams.to === r.to.name
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => go(r.from.name, r.to.name)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-primary/40 bg-primary/5 text-primary'
                : 'border-slate-200 bg-white text-slate-600 hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
            )}
          >
            {short(r.from.name)} → {short(r.to.name)}
          </button>
        )
      })}
    </div>
  )
}

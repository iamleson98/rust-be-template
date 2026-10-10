'use client'

// Extracted from the original 'search-widget.tsx'.

import type { SearchParams } from '@/lib/search-params'
import { Route } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import { buildSearchInput } from '@/lib/search-params'

/** Quick shortcuts for the most-travelled corridors — one tap fills the
 *  form AND runs the search (the same interaction model as the popular
 *  routes section further down the page). Users who want a different
 *  date can refine it in the compact bar on the results page. */
export function PopularRoutesQuickSelect({
  searchParams,
  setSearchParams,
}: {
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
}) {
  const t = useT()
  const navigate = useNavigate()

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
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-center gap-1.5 mb-2">
        <Route className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {t('search.popularRoutes')}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          { from: 'Hà Nội', to: 'Đà Nẵng', label: 'HN → ĐN' },
          { from: 'Hà Nội', to: 'TP. Hồ Chí Minh', label: 'HN → SG' },
          { from: 'TP. Hồ Chí Minh', to: 'Đà Lạt', label: 'SG → ĐL' },
          { from: 'TP. Hồ Chí Minh', to: 'Nha Trang', label: 'SG → NT' },
        ].map((r) => {
          const active = searchParams.from === r.from && searchParams.to === r.to
          return (
            <button
              key={r.label}
              type="button"
              onClick={() => go(r.from, r.to)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-[11px] font-medium border transition-all',
                active
                  ? 'bg-primary/5 border-primary/40 text-primary'
                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-primary/40 hover:text-primary hover:bg-primary/5',
              )}
            >
              {r.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

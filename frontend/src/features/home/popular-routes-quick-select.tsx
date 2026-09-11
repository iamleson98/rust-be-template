'use client'

// Extracted from the original 'search-widget.tsx'.

import { Route } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchParams } from '@/lib/store'

export function PopularRoutesQuickSelect({
  searchParams,
  setSearchParams,
}: {
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
}) {
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-center gap-1.5 mb-2">
        <Route className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Tuyến phổ biến</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {[
          { from: 'Hà Nội', to: 'Đà Nẵng', label: 'HN → ĐN' },
          { from: 'Hà Nội', to: 'TP. Hồ Chí Minh', label: 'HN → SG' },
          { from: 'TP. Hồ Chí Minh', to: 'Đà Lạt', label: 'SG → ĐL' },
          { from: 'TP. Hồ Chí Minh', to: 'Nha Trang', label: 'SG → NT' },
        ].map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => setSearchParams({ from: r.from, to: r.to })}
            className={cn(
              'rounded-full px-3 py-1 text-[11px] font-medium border transition-all',
              searchParams.from === r.from && searchParams.to === r.to
                ? 'bg-blue-50 border-blue-400 text-blue-700 '
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}

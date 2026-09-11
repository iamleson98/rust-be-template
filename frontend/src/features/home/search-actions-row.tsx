'use client'

// Extracted from the original 'search-widget.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Search, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchParams } from '@/lib/store'
import type { SearchFormValues } from './search-widget-schema'

export function SearchActionsRow({
  form,
  searchParams,
  setSearchParams,
  submitting,
}: {
  form: UseFormReturn<SearchFormValues>
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
  submitting: boolean
}) {
  const t = useT()

  return (
    <div className="mt-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'limousine', label: '🚐 Limousine', tip: 'Xe limousine cao cấp, ghế ngả rộng' },
          { key: 'sleeper', label: '🛏️ Giường nằm', tip: 'Xe giường nằm 2 tầng, phù hợp đi đêm' },
          { key: 'semi_sleeper', label: '💺 Nằm đơn', tip: 'Ghế ngả 140°, tầm giá giữa limousine và giường nằm' },
          { key: 'minivan', label: '🚐 Minivan', tip: 'Xe minivan 16 chỗ, phù hợp tuyến ngắn, cảm giác cao cấp' },
          { key: 'standard', label: '🚌 Ghế ngồi', tip: 'Xe ghế ngồi thông thường, giá rẻ' },
        ].map((v) => {
          const active = searchParams.vehicleTypes.includes(v.key)
          return (
            <Tooltip key={v.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    const next = active
                      ? searchParams.vehicleTypes.filter((x) => x !== v.key)
                      : [...searchParams.vehicleTypes, v.key]
                    form.setValue('vehicleTypes', next, { shouldValidate: false })
                    setSearchParams({ vehicleTypes: next })
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold border transition-all duration-200 whitespace-nowrap',
                    active
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-foreground border-border hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50',
                  )}
                >
                  {v.label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{v.tip}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <Button
        type="submit"
        disabled={submitting}
        className="h-10 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white px-8 gap-2 relative overflow-hidden"
      >
        {submitting ? (
          <span className="relative z-10 flex items-center gap-2">
            <span>Đang tìm...</span>
          </span>
        ) : (
          <span className="relative z-10 flex items-center gap-2">
            <Search className="h-5 w-5" />
            <span>{t('search.btn')}</span>
            <Sparkles className="h-4 w-4 opacity-60" />
          </span>
        )}
      </Button>
    </div>
  )
}

'use client'

// Extracted from the original 'search-widget.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Search } from 'lucide-react'
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
      {/* Vehicle-type quick filters — same filter set as the results-page
          sidebar, one tap from the home page. */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'limousine', label: t('home.vehicleLimousine'), tip: t('home.vehicleLimousineTip') },
          { key: 'sleeper', label: t('home.vehicleSleeper'), tip: t('home.vehicleSleeperTip') },
          { key: 'semi_sleeper', label: t('home.vehicleSemiSleeper'), tip: t('home.vehicleSemiSleeperTip') },
          { key: 'minivan', label: t('home.vehicleMinivan'), tip: t('home.vehicleMinivanTip') },
          { key: 'standard', label: t('home.vehicleStandard'), tip: t('home.vehicleStandardTip') },
        ].map((v) => {
          const active = searchParams.vehicleTypes.includes(v.key)
          return (
            <Tooltip key={v.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={active}
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
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/25'
                      : 'bg-white text-foreground border-border hover:border-primary/40 hover:text-primary hover:bg-primary/5',
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
        className="h-11 w-full shrink-0 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground px-8 gap-2 relative overflow-hidden shadow-lg shadow-primary/25 sm:w-auto sm:min-w-44 font-semibold"
      >
        <span className="relative z-10 flex items-center justify-center gap-2">
          <Search className="h-5 w-5" />
          <span>{submitting ? t('home.searching') : t('search.btn')}</span>
        </span>
      </Button>
    </div>
  )
}

'use client'

import type { SearchParams } from '@/lib/search-params'
import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VEHICLE_TYPES } from '@/lib/vehicle-types'
import type { SearchFormValues } from './schema'

const TIPS: Record<string, string> = {
  limousine: 'home.vehicleLimousineTip',
  sleeper: 'home.vehicleSleeperTip',
  semi_sleeper: 'home.vehicleSemiSleeperTip',
  minivan: 'home.vehicleMinivanTip',
  standard: 'home.vehicleStandardTip',
}

/** Vehicle-type chips (the results sidebar's filter, one tap from home) and the search button. */
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
    <div className="mt-3 flex flex-col items-stretch justify-between gap-3 sm:mt-4 sm:flex-row sm:items-center">
      {/* Vehicle types: from sm up (on phones the results-page filter sheet has them). */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        {VEHICLE_TYPES.map((v) => {
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
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold border transition-all duration-200 whitespace-nowrap',
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-white text-foreground border-border hover:border-primary/40 hover:text-primary hover:bg-primary/5',
                  )}
                >
                  <v.Icon className="h-3.5 w-3.5" />
                  {t(v.labelKey)}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t(TIPS[v.key])}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      <Button
        type="submit"
        disabled={submitting}
        size="lg"
        className="h-11 w-full shrink-0 gap-2 sm:w-auto sm:min-w-44"
      >
        <Search className="size-4" />
        {submitting ? t('home.searching') : t('search.btn')}
      </Button>
    </div>
  )
}

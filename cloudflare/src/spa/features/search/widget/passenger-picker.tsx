'use client'

// Extracted from the original 'search-widget.tsx'.

import type { SearchParams } from '@spa/lib/search-params'
import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@spa/lib/i18n'
import { Button } from '@spa/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@spa/components/ui/popover'
import { FormField, FormItem, FormLabel, FormMessage } from '@spa/components/ui/form'
import { Users, Minus, Plus } from 'lucide-react'
import { cn } from '@spa/lib/utils'
import { FIELD_CONTROL, FIELD_ERROR, FIELD_ITEM, FIELD_LABEL } from './field-style'
import type { SearchFormValues } from './schema'

export function SearchPassengerPicker({
  form,
  searchParams,
  setSearchParams,
  paxOpen,
  setPaxOpen,
}: {
  form: UseFormReturn<SearchFormValues>
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
  paxOpen: boolean
  setPaxOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const t = useT()
  return (
    <>
      {/* Passengers */}
      <FormField
        control={form.control}
        name="adults"
        render={({ field }) => (
          <FormItem className={FIELD_ITEM}>
            <FormLabel className={FIELD_LABEL}>{t('search.passengers')}</FormLabel>
            <div className="relative group/pax">
              <Users className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 z-10 text-muted-foreground group-hover/pax:text-blue-600 transition-colors" />
              <Popover open={paxOpen} onOpenChange={setPaxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(FIELD_CONTROL, 'w-full justify-start pl-10 font-normal')}
                  >
                    {searchParams.adults + searchParams.children}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-4" align="start">
                  <div className="space-y-3">
                    <PaxRow
                      label={t('search.adults')}
                      sub={t('home.adultsHint')}
                      value={searchParams.adults}
                      onChange={(v) => {
                        const next = Math.max(1, v)
                        field.onChange(next)
                        setSearchParams({ adults: next })
                      }}
                    />
                    <PaxRow
                      label={t('search.children')}
                      sub={t('home.childrenHint')}
                      value={searchParams.children}
                      onChange={(v) => {
                        const next = Math.max(0, v)
                        form.setValue('children', next, { shouldValidate: false })
                        setSearchParams({ children: next })
                      }}
                    />
                    <Button type="button" className="w-full" onClick={() => setPaxOpen(false)}>
                      {t('home.done')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <FormMessage className={FIELD_ERROR} />
          </FormItem>
        )}
      />
    </>
  )
}

function PaxRow({
  label,
  sub,
  value,
  onChange,
}: {
  label: string
  sub: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          className="h-9 w-9 rounded-full border flex items-center justify-center hover:bg-accent disabled:opacity-40"
          disabled={value <= 0}
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-6 text-center font-semibold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="h-9 w-9 rounded-full border flex items-center justify-center hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

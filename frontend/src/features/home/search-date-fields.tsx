'use client'

// Extracted from the original 'search-widget.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { DatePicker } from '@/components/ui/date-picker'
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import type { SearchParams } from '@/lib/store'
import type { SearchFormValues } from './search-widget-schema'

export function SearchDateFields({
  form,
  searchParams,
  setSearchParams,
}: {
  form: UseFormReturn<SearchFormValues>
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
}) {
  const t = useT()

  const departDateForReturnDisabled = searchParams.date
    ? new Date(searchParams.date + 'T00:00:00')
    : new Date(new Date().setHours(0, 0, 0, 0))

  return (
    <>
      {/* Depart Date */}
      <FormField
        control={form.control}
        name="date"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pl-1">
              {searchParams.roundTrip ? 'Ngày đi' : t('search.date')}{' '}
              <span className="text-destructive" aria-hidden="true">*</span>
            </FormLabel>
            <DatePicker
              value={field.value || null}
              onChange={(v) => {
                const newDate = v ?? ''
                field.onChange(newDate)
                // If return date is before new depart date, clear it.
                if (searchParams.returnDate && newDate && searchParams.returnDate < newDate) {
                  setSearchParams({ date: newDate, returnDate: '' })
                  form.setValue('returnDate', '', { shouldValidate: false })
                } else {
                  setSearchParams({ date: newDate })
                }
              }}
              minDate={new Date()}
              placeholder="Chọn ngày"
              displayFormat="EEEE, dd/MM"
              clearable={false}
              triggerClassName="h-10 bg-white/95"
            />
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Return Date — only shown when round-trip is enabled */}
      {searchParams.roundTrip && (
        <FormField
          control={form.control}
          name="returnDate"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pl-1">
                Ngày về{' '}
                <span className="text-destructive" aria-hidden="true">*</span>
              </FormLabel>
              <DatePicker
                value={field.value || null}
                onChange={(v) => {
                  const newReturn = v ?? ''
                  field.onChange(newReturn)
                  setSearchParams({ returnDate: newReturn })
                }}
                minDate={departDateForReturnDisabled}
                placeholder="Chọn ngày về"
                displayFormat="EEEE, dd/MM"
                clearable={false}
                triggerClassName="h-10 bg-white/95"
              />
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  )
}

'use client'

// Extracted from the original 'search-widget.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { DatePicker } from '@/components/ui/date-picker'
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import type { SearchParams } from '@/lib/store'
import type { SearchFormValues } from './search-widget-schema'

/** Shared label style — darker than muted-foreground so the tiny
 *  uppercase labels stay readable on the white widget card. */
const LABEL_CLASS =
  'text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 pl-1'

export function SearchDateFields({
  form,
  searchParams,
  setSearchParams,
  compact = false,
}: {
  form: UseFormReturn<SearchFormValues>
  searchParams: SearchParams
  setSearchParams: (p: Partial<SearchParams>) => void
  compact?: boolean
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
          <FormItem className={compact ? 'space-y-1' : 'space-y-1.5'}>
            <FormLabel className={LABEL_CLASS}>
              {t('search.date')}{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
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
              placeholder={t('home.chooseDatePh')}
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
            <FormItem className={compact ? 'space-y-1' : 'space-y-1.5'}>
              <FormLabel className={LABEL_CLASS}>
                {t('search.returnDate')}{' '}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </FormLabel>
              <DatePicker
                value={field.value || null}
                onChange={(v) => {
                  const newReturn = v ?? ''
                  field.onChange(newReturn)
                  setSearchParams({ returnDate: newReturn })
                }}
                minDate={departDateForReturnDisabled}
                placeholder={t('home.chooseReturnDatePh')}
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

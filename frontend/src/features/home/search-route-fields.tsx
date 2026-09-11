'use client'

// Extracted from the original 'search-widget.tsx'.

import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { PlaceAutocomplete } from '@/features/search/place-autocomplete'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { ArrowLeftRight, CircleDot, MapPin } from 'lucide-react'
import type { SearchFormValues } from './search-widget-schema'

export function SearchRouteFields({
  form,
  swap,
}: {
  form: UseFormReturn<SearchFormValues>
  swap: () => void
}) {
  const t = useT()

  return (
    <>
      {/* From */}
      <FormField
        control={form.control}
        name="from"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pl-1">
              {t('search.from')}{' '}
              <span className="text-destructive" aria-hidden="true">*</span>
            </FormLabel>
            <FormControl>
              <PlaceAutocomplete
                value={field.value}
                onChange={(v) => {
                  field.onChange(v)
                }}
                placeholder="Thành phố / bến xe"
                icon={<CircleDot className="h-4 w-4 text-primary" />}
                pinColor="blue"
                className="[&_input]:h-10"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Swap */}
      <div className="hidden md:flex items-end justify-center pb-1">
        <button
          type="button"
          onClick={swap}
          className="relative h-10 w-10 rounded-full border bg-white hover:bg-blue-50 hover:border-blue-300 transition-colors flex items-center justify-center text-blue-600"
          title="Đổi chiều"
          aria-label="Đổi chiều"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>

      {/* To */}
      <FormField
        control={form.control}
        name="to"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pl-1">
              {t('search.to')}{' '}
              <span className="text-destructive" aria-hidden="true">*</span>
            </FormLabel>
            <FormControl>
              <PlaceAutocomplete
                value={field.value}
                onChange={(v) => {
                  field.onChange(v)
                }}
                placeholder="Thành phố / bến xe"
                icon={<MapPin className="h-4 w-4 text-rose-600 fill-rose-600/20" />}
                pinColor="red"
                className="[&_input]:h-10"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

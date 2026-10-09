'use client'

// Extracted from the original 'search-widget.tsx'.

import { useSearchForm } from '@/stores/search-form'
import type { UseFormReturn } from 'react-hook-form'
import { useT } from '@/lib/i18n'
import { PlaceAutocomplete } from '@/features/search/place-autocomplete'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { ArrowLeftRight, CircleDot, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchFormValues } from './schema'

/** Shared label style — darker than muted-foreground so the tiny
 *  uppercase labels stay readable on the white widget card. */
const LABEL_CLASS =
  'text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 pl-1'

/** Reserved space for the validation message — keeps every field the
 *  SAME height whether or not an error is showing, so an error on one
 *  field never staggers the row (the old bug: From/To inputs jumped
 *  ~30px apart when only one had a red message under it). */
function MessageSlot({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  return (
    <div className={compact ? 'min-h-4' : 'min-h-5'} aria-live="polite">
      {children}
    </div>
  )
}

export function SearchRouteFields({
  form,
  swap,
  compact = false,
  stackedSwap = false,
}: {
  form: UseFormReturn<SearchFormValues>
  swap: () => void
  compact?: boolean
  /** Render the swap button on its own centered row (mobile bottom-sheet
   *  layout — the desktop grid hides it below md). */
  stackedSwap?: boolean
}) {
  const t = useT()
  const setSearchParams = useSearchForm((s) => s.setSearchParams)

  return (
    <>
      {/* From */}
      <FormField
        control={form.control}
        name="from"
        render={({ field }) => (
          <FormItem className={compact ? 'space-y-1' : 'space-y-1.5'}>
            <FormLabel className={LABEL_CLASS}>
              {t('search.from')}{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </FormLabel>
            <FormControl>
              <PlaceAutocomplete
                value={field.value}
                onChange={(v) => {
                  field.onChange(v)
                }}
                onBlur={field.onBlur}
                onPick={(p) => {
                  // Write BOTH layers atomically: the RHF form (read at
                  // submit) and the store's live searchParams. The
                  // store→form reset guard in search-widget.tsx wipes any
                  // half-updated state on the next store update, so the
                  // name and coordinates must always move together.
                  form.setValue('fromLat', p.lat ?? undefined, { shouldValidate: false })
                  form.setValue('fromLon', p.lon ?? undefined, { shouldValidate: false })
                  form.setValue('fromCity', p.city, { shouldValidate: false })
                  setSearchParams({
                    from: p.name,
                    fromCity: p.city,
                    fromLat: p.lat ?? undefined,
                    fromLon: p.lon ?? undefined,
                  })
                }}
                placeholder={t('search.placeholder')}
                icon={<CircleDot className="h-4 w-4 text-primary" />}
                pinColor="blue"
                className="[&_input]:h-10"
              />
            </FormControl>
            <MessageSlot compact>
              <FormMessage className={compact ? 'text-xs leading-4' : undefined} />
            </MessageSlot>
          </FormItem>
        )}
      />

      {/* Swap — round icon straddling the two city fields (desktop grid
          column; below md it only appears in the bottom-sheet layout via
          `stackedSwap`, centered on its own row). */}
      <div
        className={cn(
          stackedSwap ? 'flex justify-center py-0.5' : 'hidden md:flex items-center justify-center',
          compact ? 'pb-0.5' : 'pb-1',
        )}
      >
        <button
          type="button"
          onClick={swap}
          className="relative h-10 w-10 rounded-full border bg-white hover:bg-blue-50 hover:border-blue-300 hover:rotate-180 transition-all duration-300 flex items-center justify-center text-blue-600"
          title={t('home.swapDirection')}
          aria-label={t('home.swapDirection')}
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
      </div>

      {/* To */}
      <FormField
        control={form.control}
        name="to"
        render={({ field }) => (
          <FormItem className={compact ? 'space-y-1' : 'space-y-1.5'}>
            <FormLabel className={LABEL_CLASS}>
              {t('search.to')}{' '}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </FormLabel>
            <FormControl>
              <PlaceAutocomplete
                value={field.value}
                onChange={(v) => {
                  field.onChange(v)
                }}
                onBlur={field.onBlur}
                onPick={(p) => {
                  // Keep both layers in sync — see the From field note.
                  form.setValue('toLat', p.lat ?? undefined, { shouldValidate: false })
                  form.setValue('toLon', p.lon ?? undefined, { shouldValidate: false })
                  form.setValue('toCity', p.city, { shouldValidate: false })
                  setSearchParams({
                    to: p.name,
                    toCity: p.city,
                    toLat: p.lat ?? undefined,
                    toLon: p.lon ?? undefined,
                  })
                }}
                placeholder={t('search.placeholder')}
                icon={<MapPin className="h-4 w-4 text-rose-600 fill-rose-600/20" />}
                pinColor="red"
                className="[&_input]:h-10"
              />
            </FormControl>
            <MessageSlot compact>
              <FormMessage className={compact ? 'text-xs leading-4' : undefined} />
            </MessageSlot>
          </FormItem>
        )}
      />
    </>
  )
}

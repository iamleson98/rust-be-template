'use client'

// Extracted from the original 'search-widget.tsx'.

import { Fragment } from 'react'
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
function MessageSlot({
  compact,
  collapseOnPhones = false,
  children,
}: {
  compact: boolean
  /** Reserve the space only where fields share a row (md up). */
  collapseOnPhones?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(compact ? 'min-h-4' : 'min-h-5', collapseOnPhones && 'max-md:min-h-0')}
      aria-live="polite"
    >
      {children}
    </div>
  )
}

export function SearchRouteFields({
  form,
  swap,
  compact = false,
  layout = 'row',
}: {
  form: UseFormReturn<SearchFormValues>
  swap: () => void
  compact?: boolean
  /**
   * `row`: three grid cells (from, swap, to) with labels. `stacked`: the two
   * fields as one compact group, the swap button between them, labels for
   * screen readers only (the phone bottom sheet). `auto`: stacked on
   * phones, row from md up (the home widget).
   */
  layout?: 'row' | 'stacked' | 'auto'
}) {
  const t = useT()
  const stacked = layout === 'stacked'
  const auto = layout === 'auto'
  const setSearchParams = useSearchForm((s) => s.setSearchParams)

  // Stacked: one positioned group (the swap button sits between the fields).
  // Auto: the same group on phones; `md:contents` dissolves it into the row grid.
  const Group = layout === 'row' ? Fragment : 'div'
  return (
    <Group
      {...(layout === 'row'
        ? {}
        : { className: cn('relative space-y-2', auto && 'md:contents md:space-y-0') })}
    >
      {/* From */}
      <FormField
        control={form.control}
        name="from"
        render={({ field }) => (
          <FormItem className={compact ? 'space-y-1' : 'space-y-1.5'}>
            <FormLabel className={stacked ? 'sr-only' : cn(LABEL_CLASS, auto && 'max-md:sr-only')}>
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
            {stacked ? (
              <FormMessage className="text-xs leading-4" />
            ) : (
              <MessageSlot compact={compact} collapseOnPhones={auto}>
                <FormMessage className={compact ? 'text-xs leading-4' : undefined} />
              </MessageSlot>
            )}
          </FormItem>
        )}
      />

      {/* Swap — a grid cell between the fields in the row layout; in the
          stacked layout a round button straddling the two fields. */}
      <div
        className={cn(
          stacked
            ? 'absolute right-12 top-11 z-10 -translate-y-1/2'
            : auto
              ? 'absolute right-12 top-11 z-10 -translate-y-1/2 md:static md:flex md:translate-y-0 md:items-center md:justify-center md:pb-1'
              : 'hidden md:flex items-center justify-center',
          layout === 'row' && (compact ? 'pb-0.5' : 'pb-1'),
        )}
      >
        <button
          type="button"
          onClick={swap}
          className={cn(
            'relative flex items-center justify-center rounded-full border bg-white text-blue-600 transition-all duration-300 hover:rotate-180 hover:border-blue-300 hover:bg-blue-50',
            stacked
              ? 'size-9 rotate-90 hover:rotate-270'
              : auto
                ? 'size-9 rotate-90 hover:rotate-270 md:size-10 md:rotate-0 md:hover:rotate-180'
                : 'size-10',
          )}
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
            <FormLabel className={stacked ? 'sr-only' : cn(LABEL_CLASS, auto && 'max-md:sr-only')}>
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
            {stacked ? (
              <FormMessage className="text-xs leading-4" />
            ) : (
              <MessageSlot compact={compact} collapseOnPhones={auto}>
                <FormMessage className={compact ? 'text-xs leading-4' : undefined} />
              </MessageSlot>
            )}
          </FormItem>
        )}
      />
    </Group>
  )
}

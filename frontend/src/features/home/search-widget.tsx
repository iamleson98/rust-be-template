'use client'

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import { buildSearchInput } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { searchSchema, type SearchFormValues } from './search-widget-schema'
import { SearchRouteFields } from './search-route-fields'
import { SearchDateFields } from './search-date-fields'
import { SearchPassengerPicker } from './search-passenger-picker'
import { SearchActionsRow } from './search-actions-row'
import { PopularRoutesQuickSelect } from './popular-routes-quick-select'

export function SearchWidget({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const { searchParams, setSearchParams } = useApp()
  const navigate = useNavigate()
  const [paxOpen, setPaxOpen] = useState(false)
  // Local "submitting" flag — we briefly disable the submit button while
  // the router is navigating to /search so the user gets visual feedback.
  // (The actual data fetch happens on the /search route via useTripSearch.)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<SearchFormValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: searchParams,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })

  // Sync store → form. The comparison guard means we only `reset` when
  // the store has actually diverged from the form's internal state
  // (e.g. the user clicked a popular-route chip or the swap button).
  // On every ordinary keystroke `field.onChange` + `setSearchParams`
  // move both layers together, so the guard short-circuits and we
  // don't clobber field errors / dirty state.
  useEffect(() => {
    const cur = form.getValues()
    const a = [...(cur.vehicleTypes ?? [])].sort().join(',')
    const b = [...(searchParams.vehicleTypes ?? [])].sort().join(',')
    const coordsDiverged =
      (cur.fromLat ?? null) !== (searchParams.fromLat ?? null) ||
      (cur.fromLon ?? null) !== (searchParams.fromLon ?? null) ||
      (cur.toLat ?? null) !== (searchParams.toLat ?? null) ||
      (cur.toLon ?? null) !== (searchParams.toLon ?? null)
    if (
      cur.from !== searchParams.from ||
      cur.to !== searchParams.to ||
      cur.date !== searchParams.date ||
      cur.returnDate !== searchParams.returnDate ||
      cur.adults !== searchParams.adults ||
      cur.children !== searchParams.children ||
      cur.roundTrip !== searchParams.roundTrip ||
      cur.sort !== searchParams.sort ||
      a !== b ||
      coordsDiverged
    ) {
      form.reset(searchParams)
    }
  }, [searchParams, form])

  const swap = useCallback(() => {
    // Swap names AND any smart-search coordinates so a swapped precise
    // pick stays a precise pick (coords belong to the place, not the slot).
    setSearchParams({
      from: searchParams.to,
      to: searchParams.from,
      fromLat: searchParams.toLat,
      fromLon: searchParams.toLon,
      toLat: searchParams.fromLat,
      toLon: searchParams.fromLon,
      fromCity: searchParams.toCity,
      toCity: searchParams.fromCity,
    })
  }, [
    searchParams.from,
    searchParams.to,
    searchParams.fromLat,
    searchParams.fromLon,
    searchParams.toLat,
    searchParams.toLon,
    searchParams.fromCity,
    searchParams.toCity,
    setSearchParams,
  ])

  const onValid = useCallback(
    async (values: SearchFormValues) => {
      // Navigate to the /search route with typed search params — the route's
      // `validateSearch` parses them and `useTripSearch` runs the actual fetch.
      // We still call `setSearchParams` so the form stays in sync with the
      // last-submitted values (used for round-trip UI and persistence).
      setSearchParams({
        from: values.from,
        to: values.to,
        date: values.date,
        adults: values.adults,
        children: values.children,
        sort: values.sort,
        roundTrip: values.roundTrip,
        returnDate: values.returnDate,
        vehicleTypes: values.vehicleTypes,
        fromLat: values.fromLat,
        fromLon: values.fromLon,
        toLat: values.toLat,
        toLon: values.toLon,
        fromCity: values.fromCity,
        toCity: values.toCity,
      })
      setSubmitting(true)
      try {
        navigate({
          to: '/search',
          search: buildSearchInput({
            from: values.from,
            to: values.to,
            date: values.date,
            adults: values.adults,
            children: values.children,
            sort: values.sort,
            vehicleTypes: values.vehicleTypes,
            roundTrip: values.roundTrip,
            returnDate: values.returnDate,
            fromLat: values.fromLat,
            fromLon: values.fromLon,
            toLat: values.toLat,
            toLon: values.toLon,
            fromCity: values.fromCity,
            toCity: values.toCity,
          }),
        })
      } finally {
        // Reset shortly after navigation — the route transition is async.
        setTimeout(() => setSubmitting(false), 300)
      }
    },
    [setSearchParams, navigate],
  )

  // Form submission can also be triggered programmatically (the search
  // button lives inside the <form> so this is mostly a convenience for
  // tests / future keyboard shortcuts). The shared DatePicker surfaces
  // its own validation message, so no manual "open the picker" hint.
  const onSubmit = form.handleSubmit(onValid)

  return (
    <div
      className={cn(
        'relative z-50 rounded-2xl bg-white/95 backdrop-blur-xl border border-slate-200 ring-1 ring-black/5',
        compact ? 'p-2.5 md:p-3' : 'p-4 md:p-5',
      )}
    >
      <Form {...form}>
        <form onSubmit={onSubmit} className="contents" noValidate aria-label={t('search.title')}>
          {compact ? (
            /* ── Compact bar (results page): one dense row on md+.
                Vehicle-type pills are intentionally omitted here — they
                remain fully available in the results-page filter sidebar /
                mobile filter sheet, so no functionality is lost. ── */
            <>
              <div
                className={cn(
                  'grid grid-cols-1 gap-2 md:gap-2.5 md:items-end',
                  searchParams.roundTrip
                    ? 'lg:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,0.75fr)_auto]'
                    : 'lg:grid-cols-[minmax(0,1.15fr)_auto_minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto]',
                )}
              >
                <SearchRouteFields form={form} swap={swap} compact />

                <SearchDateFields
                  form={form}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                  compact
                />

                <SearchPassengerPicker
                  form={form}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                  paxOpen={paxOpen}
                  setPaxOpen={setPaxOpen}
                  compact
                />

                <Button
                  type="submit"
                  disabled={submitting}
                  className="h-10 w-full lg:w-auto lg:min-w-36 shrink-0 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground px-5 gap-2 font-semibold"
                >
                  <Search className="h-4 w-4" />
                  <span>{submitting ? t('home.searching') : t('search.btn')}</span>
                </Button>
              </div>
            </>
          ) : (
            /* ── Full widget (home page) ── */
            <>
              <div
                className={cn(
                  'grid grid-cols-1 gap-3 items-start',
                  searchParams.roundTrip
                    ? 'md:grid-cols-[1fr_auto_1fr_1fr_1fr_1fr]'
                    : 'md:grid-cols-[1fr_auto_1fr_1fr_1fr]',
                )}
              >
                <SearchRouteFields form={form} swap={swap} />

                <SearchDateFields
                  form={form}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                />

                <SearchPassengerPicker
                  form={form}
                  searchParams={searchParams}
                  setSearchParams={setSearchParams}
                  paxOpen={paxOpen}
                  setPaxOpen={setPaxOpen}
                />
              </div>

              <SearchActionsRow
                form={form}
                searchParams={searchParams}
                setSearchParams={setSearchParams}
                submitting={submitting}
              />
            </>
          )}
        </form>
      </Form>

      {/* Popular routes quick-select */}
      {!compact && (
        <PopularRoutesQuickSelect searchParams={searchParams} setSearchParams={setSearchParams} />
      )}
    </div>
  )
}

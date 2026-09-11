'use client'

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { Form } from '@/components/ui/form'
import { buildSearchInput } from '@/lib/search-params'
import { cn } from '@/lib/utils'
import { searchSchema, type SearchFormValues } from './search-widget-schema'
import { SearchTripTypeToggle } from './search-trip-type-toggle'
import { SearchRouteFields } from './search-route-fields'
import { SearchDateFields } from './search-date-fields'
import { SearchPassengerPicker } from './search-passenger-picker'
import { SearchActionsRow } from './search-actions-row'
import { PopularRoutesQuickSelect } from './popular-routes-quick-select'

export function SearchWidget({ compact = false }: { compact?: boolean }) {
  const {
    searchParams,
    setSearchParams,
  } = useApp()
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
    if (
      cur.from !== searchParams.from ||
      cur.to !== searchParams.to ||
      cur.date !== searchParams.date ||
      cur.returnDate !== searchParams.returnDate ||
      cur.adults !== searchParams.adults ||
      cur.children !== searchParams.children ||
      cur.roundTrip !== searchParams.roundTrip ||
      cur.sort !== searchParams.sort ||
      a !== b
    ) {
      form.reset(searchParams)
    }
  }, [searchParams, form])

  const swap = useCallback(() => {
    setSearchParams({ from: searchParams.to, to: searchParams.from })
  }, [searchParams.from, searchParams.to, setSearchParams])

  const onValid = useCallback(async (values: SearchFormValues) => {
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
        }),
      })
    } finally {
      // Reset shortly after navigation — the route transition is async.
      setTimeout(() => setSubmitting(false), 300)
    }
  }, [setSearchParams, navigate])

  // Form submission can also be triggered programmatically (the search
  // button lives inside the <form> so this is mostly a convenience for
  // tests / future keyboard shortcuts). The shared DatePicker surfaces
  // its own validation message, so no manual "open the picker" hint.
  const onSubmit = form.handleSubmit(onValid)

  return (
    <div
      className={cn(
        'relative z-50 rounded-2xl bg-white/95 backdrop-blur-xl border border-slate-200 ring-1 ring-black/5 p-4 md:p-5',
        compact ? 'gap-3' : 'gap-4',
      )}
    >
      <Form {...form}>
        <form onSubmit={onSubmit} className="contents" noValidate aria-label="Tìm chuyến xe">
          {/* Trip type toggle: One-way / Round-trip */}
          <SearchTripTypeToggle
            form={form}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
          />

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
        </form>
      </Form>

      {/* Popular routes quick-select */}
      {!compact && (
        <PopularRoutesQuickSelect
          searchParams={searchParams}
          setSearchParams={setSearchParams}
        />
      )}
    </div>
  )
}

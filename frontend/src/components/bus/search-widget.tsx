'use client'

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { useT } from '@/lib/i18n'
import { PlaceAutocomplete } from './place-autocomplete'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { requiredText } from '@/lib/forms'
import { cn } from '@/lib/utils'
import { buildSearchInput } from '@/lib/search-params'
import { format } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  MapPin,
  CalendarDays,
  Search,
  ArrowLeftRight,
  ArrowRight,
  Users,
  Minus,
  Plus,
  Sparkles,
  Route,
  CircleDot,
  Repeat2,
} from 'lucide-react'

/**
 * Search-widget schema.
 *
 * Mirrors `SearchParams` from the store. We use `z.number()` (not
 * `z.coerce.number()`) for `adults` / `children` because the PAX
 * popover writes actual numbers via `field.onChange(next)` — there's
 * no string→number coercion needed at the zod layer, and using
 * `z.number()` keeps RHF's input/output types identical so
 * `form.watch` / `form.getValues` return `number` instead of
 * `unknown`. The two `.refine` calls encode the round-trip rules
 * that were previously inline `toast.error` checks in `doSearch`.
 */
const searchSchema = z
  .object({
    from: requiredText('Điểm đi'),
    to: requiredText('Điểm đến'),
    date: requiredText('Ngày đi'),
    roundTrip: z.boolean(),
    returnDate: z.string(),
    adults: z.number().int().min(1, 'Phải có ít nhất 1 người lớn'),
    children: z.number().int().min(0),
    sort: z.enum(['departure', 'price', 'duration', 'rating']),
    vehicleTypes: z.array(z.string()),
  })
  .refine((d) => !d.roundTrip || d.returnDate !== '', {
    message: 'Vui lòng chọn ngày về cho chuyến khứ hồi',
    path: ['returnDate'],
  })
  .refine((d) => !d.roundTrip || d.returnDate >= d.date, {
    message: 'Ngày về phải sau ngày đi',
    path: ['returnDate'],
  })

type SearchFormValues = z.infer<typeof searchSchema>

export function SearchWidget({ compact = false }: { compact?: boolean }) {
  const {
    searchParams,
    setSearchParams,
  } = useApp()
  const navigate = useNavigate()
  const t = useT()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [returnPickerOpen, setReturnPickerOpen] = useState(false)
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
  // tests / future keyboard shortcuts).
  const onSubmit = form.handleSubmit(onValid, () => {
    // On invalid, focus the return-date picker if the round-trip rule
    // failed — preserves the previous UX where a toast + open picker
    // hinted at the problem.
    const returnDateErr = form.formState.errors.returnDate
    if (returnDateErr && searchParams.roundTrip) {
      setReturnPickerOpen(true)
    }
  })

  const selectedDate = searchParams.date
    ? new Date(searchParams.date + 'T00:00:00')
    : undefined
  const selectedReturnDate = searchParams.returnDate
    ? new Date(searchParams.returnDate + 'T00:00:00')
    : undefined
  const departDateForReturnDisabled = searchParams.date
    ? new Date(searchParams.date + 'T00:00:00')
    : new Date(new Date().setHours(0, 0, 0, 0))

  return (
    <div
      className={cn(
        'relative z-50 rounded-2xl bg-white/95 backdrop-blur-xl border border-slate-200 ring-1 ring-black/5 p-4 md:p-5 shadow-sm',
        compact ? 'gap-3' : 'gap-4',
      )}
    >
      <Form {...form}>
        <form onSubmit={onSubmit} className="contents" noValidate aria-label="Tìm chuyến xe">
          {/* Trip type toggle: One-way / Round-trip */}
          <div className="mb-3 flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200">
              <button
                type="button"
                onClick={() => setSearchParams({ roundTrip: false })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                  !searchParams.roundTrip
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                Một chiều
              </button>
              <button
                type="button"
                onClick={() => setSearchParams({ roundTrip: true })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                  searchParams.roundTrip
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Repeat2 className="h-3.5 w-3.5" />
                Khứ hồi
              </button>
            </div>
            {searchParams.roundTrip && (
              <span className="text-[11px] text-blue-600 font-medium hidden sm:inline">
                Tiết kiệm đến 10% khi đặt vé khứ hồi
              </span>
            )}
          </div>

          <div
            className={cn(
              'grid grid-cols-1 gap-3 items-start',
              searchParams.roundTrip
                ? 'md:grid-cols-[1fr_auto_1fr_1fr_1fr_1fr]'
                : 'md:grid-cols-[1fr_auto_1fr_1fr_1fr]',
            )}
          >
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
                        setSearchParams({ from: v })
                      }}
                      placeholder="Thành phố / bến xe"
                      icon={<CircleDot className="h-4 w-4 text-blue-600" />}
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
                        setSearchParams({ to: v })
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
                  <div className="relative group/date">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 z-10 text-muted-foreground group-hover/date:text-blue-600 transition-colors" />
                    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-start text-left font-normal bg-white/95 h-10 pl-10"
                        >
                          {selectedDate
                            ? format(selectedDate, 'EEEE, dd/MM', { locale: vi })
                            : 'Chọn ngày'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={(d) => {
                            if (d) {
                              const newDate = format(d, 'yyyy-MM-dd')
                              field.onChange(newDate)
                              // If return date is before new depart date, clear it.
                              if (searchParams.returnDate && searchParams.returnDate < newDate) {
                                setSearchParams({ date: newDate, returnDate: '' })
                                form.setValue('returnDate', '', { shouldValidate: false })
                              } else {
                                setSearchParams({ date: newDate })
                              }
                              setPickerOpen(false)
                            }
                          }}
                          disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                          locale={vi}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
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
                    <div className="relative group/return">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 z-10 text-muted-foreground group-hover/return:text-blue-600 transition-colors" />
                      <Popover open={returnPickerOpen} onOpenChange={setReturnPickerOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              'w-full justify-start text-left font-normal bg-white/95 h-10 pl-10',
                              !selectedReturnDate && 'text-muted-foreground',
                            )}
                          >
                            {selectedReturnDate
                              ? format(selectedReturnDate, 'EEEE, dd/MM', { locale: vi })
                              : 'Chọn ngày về'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={selectedReturnDate}
                            onSelect={(d) => {
                              if (d) {
                                const newReturn = format(d, 'yyyy-MM-dd')
                                field.onChange(newReturn)
                                setSearchParams({ returnDate: newReturn })
                                setReturnPickerOpen(false)
                              }
                            }}
                            disabled={(d) => d < departDateForReturnDisabled}
                            locale={vi}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Passengers */}
            <FormField
              control={form.control}
              name="adults"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pl-1">
                    Khách
                  </FormLabel>
                  <div className="relative group/pax">
                    <Users className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 z-10 text-muted-foreground group-hover/pax:text-blue-600 transition-colors" />
                    <Popover open={paxOpen} onOpenChange={setPaxOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-start font-normal bg-white/95 h-10 pl-10"
                        >
                          {searchParams.adults + searchParams.children}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-4" align="start">
                        <div className="space-y-3">
                          <PaxRow
                            label="Người lớn"
                            sub="12 tuổi trở lên"
                            value={searchParams.adults}
                            onChange={(v) => {
                              const next = Math.max(1, v)
                              field.onChange(next)
                              setSearchParams({ adults: next })
                            }}
                          />
                          <PaxRow
                            label="Trẻ em"
                            sub="0 - 11 tuổi"
                            value={searchParams.children}
                            onChange={(v) => {
                              const next = Math.max(0, v)
                              form.setValue('children', next, { shouldValidate: false })
                              setSearchParams({ children: next })
                            }}
                          />
                          <Button type="button" className="w-full" onClick={() => setPaxOpen(false)}>
                            Xong
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'limousine', label: '🚐 Limousine', tip: 'Xe limousine cao cấp, ghế ngả rộng' },
                { key: 'sleeper', label: '🛏️ Giường nằm', tip: 'Xe giường nằm 2 tầng, phù hợp đi đêm' },
                { key: 'semi_sleeper', label: '💺 Nằm đơn', tip: 'Ghế ngả 140°, tầm giá giữa limousine và giường nằm' },
                { key: 'minivan', label: '🚐 Minivan', tip: 'Xe minivan 16 chỗ, phù hợp tuyến ngắn, cảm giác cao cấp' },
                { key: 'standard', label: '🚌 Ghế ngồi', tip: 'Xe ghế ngồi thông thường, giá rẻ' },
              ].map((v) => {
                const active = searchParams.vehicleTypes.includes(v.key)
                return (
                  <Tooltip key={v.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
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
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30'
                            : 'bg-white text-foreground border-border hover:border-blue-400 hover:text-blue-700 hover:bg-blue-50',
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
              className="h-10 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white px-8 gap-2 relative overflow-hidden shadow-md shadow-blue-600/30"
            >
              {submitting ? (
                <span className="relative z-10 flex items-center gap-2">
                  <span>Đang tìm...</span>
                </span>
              ) : (
                <span className="relative z-10 flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  <span>{t('search.btn')}</span>
                  <Sparkles className="h-4 w-4 opacity-60" />
                </span>
              )}
            </Button>
          </div>
        </form>
      </Form>

      {/* Popular routes quick-select */}
      {!compact && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 mb-2">
            <Route className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Tuyến phổ biến</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { from: 'Hà Nội', to: 'Đà Nẵng', label: 'HN → ĐN' },
              { from: 'Hà Nội', to: 'TP. Hồ Chí Minh', label: 'HN → SG' },
              { from: 'TP. Hồ Chí Minh', to: 'Đà Lạt', label: 'SG → ĐL' },
              { from: 'TP. Hồ Chí Minh', to: 'Nha Trang', label: 'SG → NT' },
            ].map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setSearchParams({ from: r.from, to: r.to })}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-medium border transition-all',
                  searchParams.from === r.from && searchParams.to === r.to
                    ? 'bg-blue-50 border-blue-400 text-blue-700 '
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PaxRow({ label, sub, value, onChange }: { label: string; sub: string; value: number; onChange: (v: number) => void }) {
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
          className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-accent disabled:opacity-40"
          disabled={value <= 0}
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-6 text-center font-semibold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="h-8 w-8 rounded-full border flex items-center justify-center hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { buildSearchInput } from '@/lib/search-params'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingDown, Sparkles } from 'lucide-react'
import { searchTrips as sdkSearchTrips } from '@/lib/api/sdk.gen'

// Vietnamese day-of-week short names (Mon=0 … Sun=6)
const DOW_VN = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

type DatePrice = {
  date: string // yyyy-MM-dd
  dow: string // T2 … CN
  label: string // dd/MM
  price: number | null // null = no results / loading
  loading: boolean
  isCheapest: boolean
  isPast: boolean
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

function fmtISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function fmtLabel(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${m}`
}

/**
 * Compact price formatter for the date strip.
 * - VND: "332.500₫" stays, but we keep digits tight.
 * - USD: "$13.57" unchanged.
 * Returns the formatted string guaranteed to fit a 84px-wide content area
 * at text-[11px] font (max ~10 chars).
 */
function formatPriceCompact(price: number, currency: 'VND' | 'USD'): string {
  if (currency === 'USD') {
    const usd = price / 24500
    return `$${usd.toFixed(usd >= 100 ? 0 : 1)}`
  }
  // VND: use plain grouping, append "đ" suffix in smaller size via separate span.
  return new Intl.NumberFormat('vi-VN').format(price)
}

export function DatePriceCompare() {
  const { searchParams, currency } = useApp()
  const navigate = useNavigate()
  const [prices, setPrices] = useState<DatePrice[]>([])
  const [, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  // Use the date string directly as dependency (not a Date object) to avoid infinite re-renders
  const baseDateStr = searchParams.date || fmtISO(new Date())

  // Build the 7 dates array
  const buildDates = useCallback((): DatePrice[] => {
    const baseDate = new Date(baseDateStr + 'T00:00:00')
    const now = new Date()
    const todayISO = fmtISO(now)
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(baseDate, i - 3)
      const iso = fmtISO(d)
      return {
        date: iso,
        dow: DOW_VN[d.getDay() === 0 ? 6 : d.getDay() - 1], // JS getDay: 0=Sun
        label: fmtLabel(d),
        price: null,
        loading: true,
        isCheapest: false,
        isPast: iso < todayISO,
      }
    })
  }, [baseDateStr])

  // Fetch prices for all 7 dates (batched with small delay)
  const fetchPrices = useCallback(async () => {
    // Cancel previous in-flight requests
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const dates = buildDates()
    setPrices(dates)
    setLoading(true)

    const { from, to, adults, children } = searchParams
    if (!from || !to) {
      setPrices(dates.map((d) => ({ ...d, loading: false, price: null })))
      setLoading(false)
      return
    }

    // Fetch all 7 dates in PARALLEL — the previous sequential loop with a 50ms
    // artificial delay between requests added ~400ms+ to every search. The
    // backend's per-IP rate limiter (20 burst / 10 rps) comfortably absorbs 7
    // concurrent reads from a single user, and the Moka trip-search cache
    // (30s TTL) makes repeated same-day clicks near-free.
    const fetchOne = async (d: DatePrice): Promise<{ date: string; price: number | null }> => {
      if (d.isPast) return { date: d.date, price: null }
      try {
        const { data } = await sdkSearchTrips({
          query: {
            from,
            to,
            date: d.date,
            sort: 'price',
            minSeats: (adults || 1) + (children || 0),
          },
          signal: controller.signal,
          // Send credentials so the httpOnly JWT cookie is attached.
          // (handled by the SDK's default client config)
        } as any)
        const items: { minPrice: number }[] = (data as any)?.items ?? []
        const minPrice = items.length > 0 ? items.reduce((min, t) => Math.min(min, t.minPrice), Infinity) : null
        return { date: d.date, price: minPrice }
      } catch {
        if (controller.signal.aborted) return { date: d.date, price: null }
        return { date: d.date, price: null }
      }
    }

    const results = await Promise.all(dates.map(fetchOne))

    if (controller.signal.aborted) return

    // Determine cheapest — only mark the FIRST card that has the minimum price,
    // so ties don't result in every card showing the "Rẻ nhất" badge.
    const validPrices = results.filter((r) => r.price !== null)
    const cheapest = validPrices.length > 0 ? Math.min(...validPrices.map((r) => r.price!)) : null
    const cheapestDateIdx = cheapest !== null
      ? results.findIndex((r) => r.price === cheapest)
      : -1

    const finalPrices: DatePrice[] = dates.map((d, i) => ({
      ...d,
      loading: false,
      price: results[i]?.price ?? null,
      isCheapest: i === cheapestDateIdx,
    }))

    setPrices(finalPrices)
    setLoading(false)
  }, [searchParams.from, searchParams.to, searchParams.adults, searchParams.children, buildDates])

  useEffect(() => {
    fetchPrices()
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchPrices])

  // Click a date → navigate to /search with the new date. The URL is the
  // source of truth — useTripSearch on the /search route re-runs automatically.
  const handleDateClick = (dp: DatePrice) => {
    if (dp.isPast || dp.date === searchParams.date) return
    navigate({
      to: '/search',
      search: buildSearchInput({
        from: searchParams.from,
        to: searchParams.to,
        date: dp.date,
        adults: searchParams.adults,
        children: searchParams.children,
        sort: searchParams.sort,
        vehicleTypes: searchParams.vehicleTypes,
        roundTrip: searchParams.roundTrip,
        returnDate: searchParams.returnDate,
      }),
    })
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 ring-1 ring-blue-100">
          <TrendingDown className="h-3.5 w-3.5 text-blue-600" />
        </div>
        <span className="text-sm font-semibold text-slate-700">So sánh giá các ngày lân cận</span>
        <span className="text-[11px] text-slate-400 hidden sm:inline">— chọn ngày rẻ nhất để tiết kiệm</span>
      </div>

      <div className="flex gap-2 sm:gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
        {prices.map((dp) => {
          const isSelected = dp.date === searchParams.date
          const isDisabled = dp.isPast
          const hasPrice = dp.price !== null && !dp.loading

          return (
            <button
              key={dp.date}
              onClick={() => handleDateClick(dp)}
              disabled={isDisabled}
              aria-label={`Ngày ${dp.dow} ${dp.label}${hasPrice ? `, giá ${formatCurrency(dp.price!, currency)}` : ''}`}
              className={cn(
                // Wider cards with generous padding so price never overflows.
                'relative flex flex-col items-center justify-center gap-0.5',
                'min-w-25 sm:min-w-28 shrink-0',
                'px-3.5 py-3 rounded-xl border-2 transition-all duration-200 text-center',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1',
                isSelected
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/25 scale-[1.03]'
                  : isDisabled
                    ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                    : dp.isCheapest
                      ? 'bg-blue-50 text-blue-900 border-blue-300 hover:bg-blue-100 hover:border-blue-400 hover:-translate-y-0.5'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-blue-50/50 hover:border-blue-300 hover:text-blue-700 hover:-translate-y-0.5'
              )}
            >
              {/* Cheapest badge */}
              {dp.isCheapest && !isSelected && hasPrice && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap z-10 shadow-sm flex items-center gap-0.5">
                  <Sparkles className="h-2.5 w-2.5" />
                  Rẻ nhất
                </span>
              )}

              {/* Day of week */}
              <span
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-wide leading-none',
                  isSelected ? 'text-blue-100' : isDisabled ? 'text-slate-300' : dp.isCheapest ? 'text-blue-600' : 'text-slate-500'
                )}
              >
                {dp.dow}
              </span>

              {/* Date */}
              <span
                className={cn(
                  'text-[15px] font-bold leading-tight tabular-nums',
                  isSelected ? 'text-white' : isDisabled ? 'text-slate-300' : 'text-slate-900'
                )}
              >
                {dp.label}
              </span>

              {/* Price — compact format with smaller "đ" suffix */}
              <div className="mt-1 min-h-4.5 flex items-baseline justify-center gap-0.5 w-full">
                {dp.loading ? (
                  <Skeleton className="h-3.5 w-16 rounded" />
                ) : hasPrice ? (
                  <>
                    <span
                      className={cn(
                        'text-[12px] font-bold tabular-nums leading-none',
                        isSelected ? 'text-white' : dp.isCheapest ? 'text-blue-700' : 'text-slate-700'
                      )}
                    >
                      {formatPriceCompact(dp.price!, currency)}
                    </span>
                    {currency === 'VND' && (
                      <span
                        className={cn(
                          'text-[10px] font-medium leading-none',
                          isSelected ? 'text-blue-100' : 'text-slate-500'
                        )}
                      >
                        đ
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[11px] text-slate-300 leading-none">—</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

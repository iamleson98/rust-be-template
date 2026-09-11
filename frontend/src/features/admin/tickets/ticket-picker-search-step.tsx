'use client'

import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { TripResultsSkeleton } from '@/features/search/trip-results-skeleton'
import {
  Search,
  Bus,
  Clock,
} from 'lucide-react'
import { usePlaceSearch, useTripSearch } from '@/lib/queries'
import type { TripResult } from '@/lib/api/types.gen'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── SearchStep ──────────────────────────────────────────────

export function SearchStep({
  fromQuery,
  toQuery,
  setFromQuery,
  setToQuery,
  fromPlace,
  toPlace,
  setFromPlace,
  setToPlace,
  date,
  setDate,
  fromSearch,
  toSearch,
  tripSearch,
  onSelectTrip,
}: {
  fromQuery: string
  toQuery: string
  setFromQuery: (v: string) => void
  setToQuery: (v: string) => void
  fromPlace: { id: string; name: string } | null
  toPlace: { id: string; name: string } | null
  setFromPlace: (p: { id: string; name: string } | null) => void
  setToPlace: (p: { id: string; name: string } | null) => void
  date: string
  setDate: (d: string) => void
  fromSearch: ReturnType<typeof usePlaceSearch>
  toSearch: ReturnType<typeof usePlaceSearch>
  tripSearch: ReturnType<typeof useTripSearch>
  onSelectTrip: (t: TripResult) => void
}) {
  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="relative">
          <Label className="text-[10px] text-muted-foreground uppercase">Điểm đi</Label>
          <Input
            value={fromPlace ? fromPlace.name : fromQuery}
            onChange={(e) => {
              setFromQuery(e.target.value)
              setFromPlace(null)
            }}
            placeholder="VD: Hà Nội"
            className="h-9"
          />
          {fromSearch.data?.items && fromSearch.data.items.length > 0 && !fromPlace && fromQuery && (
            <div className="absolute z-10 mt-1 w-full bg-white border rounded-md max-h-48 overflow-y-auto">
              {fromSearch.data.items.slice(0, 6).map((p) => (
                <button
                  key={p.id ?? p.name}
                  onClick={() => {
                    setFromPlace({ id: p.id ?? p.name, name: p.name })
                    setFromQuery('')
                  }}
                  className="block w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50"
                >
                  <span className="font-medium">{p.name}</span>
                  {p.province && (
                    <span className="text-muted-foreground ml-1">· {p.province}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <Label className="text-[10px] text-muted-foreground uppercase">Điểm đến</Label>
          <Input
            value={toPlace ? toPlace.name : toQuery}
            onChange={(e) => {
              setToQuery(e.target.value)
              setToPlace(null)
            }}
            placeholder="VD: Đà Nẵng"
            className="h-9"
          />
          {toSearch.data?.items && toSearch.data.items.length > 0 && !toPlace && toQuery && (
            <div className="absolute z-10 mt-1 w-full bg-white border rounded-md max-h-48 overflow-y-auto">
              {toSearch.data.items.slice(0, 6).map((p) => (
                <button
                  key={p.id ?? p.name}
                  onClick={() => {
                    setToPlace({ id: p.id ?? p.name, name: p.name })
                    setToQuery('')
                  }}
                  className="block w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50"
                >
                  <span className="font-medium">{p.name}</span>
                  {p.province && (
                    <span className="text-muted-foreground ml-1">· {p.province}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label className="text-[10px] text-muted-foreground uppercase">Ngày đi</Label>
          <DatePicker
            value={date || null}
            onChange={(v) => setDate(v ?? '')}
            minDate={todayIso()}
            displayFormat="dd/MM/yyyy"
          />
        </div>
      </div>

      <Separator />

      {/* Results */}
      {tripSearch.isLoading ? (
        <TripResultsSkeleton count={4} />
      ) : tripSearch.data?.items && tripSearch.data.items.length > 0 ? (
        <div className="space-y-2 max-h-75 overflow-y-auto">
          {tripSearch.data.items.map((t) => (
            <button
              key={t.tripId}
              onClick={() => onSelectTrip(t)}
              className="w-full text-left rounded-lg border p-2.5 hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: t.brandAccent }}
                    />
                    <span className="font-medium">{t.brandName}</span>
                    <span className="text-muted-foreground">· {t.vehicleTypeLabel}</span>
                  </div>
                  <div className="font-semibold text-sm mt-0.5">
                    {t.fromName} → {t.toName}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {t.departureTime}
                    </span>
                    <span>· {t.availableSeats} ghế trống</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-blue-700 text-sm">
                    {new Intl.NumberFormat('vi-VN').format(t.minPrice)}₫
                  </div>
                  <div className="text-[10px] text-muted-foreground">/ghế</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : fromPlace && toPlace ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          <Bus className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          Không tìm thấy chuyến nào phù hợp.
        </div>
      ) : (
        <div className="p-6 text-center text-sm text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          Chọn điểm đi, điểm đến và ngày đi để tìm chuyến.
        </div>
      )}
    </div>
  )
}

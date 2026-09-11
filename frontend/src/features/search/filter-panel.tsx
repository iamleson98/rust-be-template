'use client'

/**
 * FilterPanel — the reusable filter controls (price range, departure time,
 * minimum rating, available seats, amenities) shared by the desktop filter
 * sidebar and the mobile filter sheet of the search-results page.
 *
 * Extracted from the original `search-results.tsx`.
 */

import { useApp, type TripResult } from '@/lib/store'
import { Sunrise, Sun, Sunset, Moon, Star, Users, Wifi, Snowflake, Droplet, Zap, BedDouble } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/currency'
import { getHourOfDeparture, matchesTimeRange, type Filters, type TimeRange } from './helpers'

export const TIME_RANGE_OPTIONS: { key: TimeRange; label: string; icon: React.ReactNode }[] = [
  { key: '0-6', label: 'Sáng sớm (0-6h)', icon: <Sunrise className="h-3.5 w-3.5" /> },
  { key: '6-12', label: 'Ban ngày (6-12h)', icon: <Sun className="h-3.5 w-3.5" /> },
  { key: '12-18', label: 'Chiều (12-18h)', icon: <Sunset className="h-3.5 w-3.5" /> },
  { key: '18-24', label: 'Ban đêm (18-24h)', icon: <Moon className="h-3.5 w-3.5" /> },
]

export const AMENITY_OPTIONS: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'wifi', label: 'WiFi', icon: <Wifi className="h-3.5 w-3.5" /> },
  { key: 'ac', label: 'Điều hòa', icon: <Snowflake className="h-3.5 w-3.5" /> },
  { key: 'water', label: 'Nước uống', icon: <Droplet className="h-3.5 w-3.5" /> },
  { key: 'charging', label: 'Cắm sạc', icon: <Zap className="h-3.5 w-3.5" /> },
  { key: 'blanket', label: 'Chăn mền', icon: <BedDouble className="h-3.5 w-3.5" /> },
]

const RATING_OPTIONS = [
  { value: 0, label: 'Tất cả' },
  { value: 4.0, label: '4.0+' },
  { value: 4.5, label: '4.5+' },
  { value: 4.8, label: '4.8+' },
]

export function FilterPanel({
  searchResults,
  filters,
  setFilters,
  priceBounds,
  effectivePriceRange,
  isMobile = false,
}: {
  searchResults: TripResult[]
  filters: Filters
  setFilters: (f: Filters) => void
  priceBounds: [number, number]
  effectivePriceRange: [number, number]
  isMobile?: boolean
}) {
  const { currency } = useApp()
  const updatePrice = (val: number[]) => {
    setFilters({ ...filters, priceMin: val[0], priceMax: val[1] })
  }

  const toggleTimeRange = (key: TimeRange) => {
    const exists = filters.timeRanges.includes(key)
    setFilters({
      ...filters,
      timeRanges: exists ? filters.timeRanges.filter((x) => x !== key) : [...filters.timeRanges, key],
    })
  }

  const toggleAmenity = (key: string) => {
    const exists = filters.amenities.includes(key)
    setFilters({
      ...filters,
      amenities: exists ? filters.amenities.filter((x) => x !== key) : [...filters.amenities, key],
    })
  }

  // Count results per filter option (independent of that filter being active)
  const countForTimeRange = (key: TimeRange) =>
    searchResults.filter((t) => matchesTimeRange(getHourOfDeparture(t), key)).length

  // `?? []` defends against incomplete API items — the search endpoint may
  // return minimal trip objects before enrichment fills in `amenities`.
  const countForAmenity = (key: string) => searchResults.filter((t) => (t.amenities ?? []).includes(key)).length

  const countForRating = (value: number) =>
    value === 0 ? searchResults.length : searchResults.filter((t) => t.brandRating >= value).length

  const countAvailableOnly = searchResults.filter((t) => t.availableSeats > 5).length

  return (
    <div className={cn('space-y-4', isMobile && 'space-y-5')}>
      {/* Price Range Slider */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground shrink-0">Khoảng giá</span>
          <span className="text-[11px] font-medium text-blue-700 text-right tabular-nums leading-tight">
            {formatCurrency(effectivePriceRange[0], currency)}
            <span className="text-slate-400 mx-0.5">–</span>
            {formatCurrency(effectivePriceRange[1], currency)}
          </span>
        </div>
        <Slider
          value={[effectivePriceRange[0], effectivePriceRange[1]]}
          min={priceBounds[0]}
          max={priceBounds[1]}
          step={50000}
          onValueChange={updatePrice}
          className="py-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
          <span>{formatCurrency(priceBounds[0], currency)}</span>
          <span>{formatCurrency(priceBounds[1], currency)}</span>
        </div>
      </div>

      {/* Departure Time Range */}
      <div className="pt-3 border-t">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Giờ khởi hành</div>
        <div className="space-y-1.5">
          {TIME_RANGE_OPTIONS.map((opt) => {
            const active = filters.timeRanges.includes(opt.key)
            const count = countForTimeRange(opt.key)
            return (
              <label key={opt.key} className="flex items-center gap-2 cursor-pointer text-sm py-1 group">
                <Checkbox
                  checked={active}
                  onCheckedChange={() => toggleTimeRange(opt.key)}
                  className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                />
                <span className="flex items-center gap-1.5 group-hover:text-blue-700 transition-colors flex-1">
                  <span className="text-blue-500">{opt.icon}</span>
                  {opt.label}
                </span>
                {count > 0 && (
                  <span className="text-[10px] text-muted-foreground bg-slate-100 rounded-full px-1.5 py-0.5">{count}</span>
                )}
              </label>
            )
          })}
        </div>
      </div>

      {/* Minimum Rating */}
      <div className="pt-3 border-t">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Đánh giá tối thiểu</div>
        <RadioGroup
          value={String(filters.minRating)}
          onValueChange={(v) => setFilters({ ...filters, minRating: Number(v) })}
          className="grid grid-cols-2 gap-1.5"
        >
          {RATING_OPTIONS.map((opt) => {
            const count = countForRating(opt.value)
            return (
              <label
                key={opt.value}
                className={cn(
                  'flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-md border text-sm transition-all',
                  filters.minRating === opt.value
                    ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                    : 'border-transparent hover:bg-slate-100'
                )}
              >
                <RadioGroupItem
                  value={String(opt.value)}
                  id={`rating-${opt.value}`}
                  className="data-[state=checked]:border-blue-600 data-[state=checked]:text-blue-600"
                />
                {opt.value > 0 && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                <span className="flex-1">{opt.label}</span>
                {count > 0 && (
                  <span className="text-[10px] text-muted-foreground">{count}</span>
                )}
              </label>
            )
          })}
        </RadioGroup>
      </div>

      {/* Available Seats */}
      <div className="pt-3 border-t">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Số ghế trống</div>
        <label className="flex items-center gap-2 cursor-pointer text-sm py-1 group">
          <Checkbox
            checked={filters.availableOnly}
            onCheckedChange={(c) => setFilters({ ...filters, availableOnly: c === true })}
            className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
          />
          <span className="flex items-center gap-1.5 group-hover:text-blue-700 transition-colors flex-1">
            <Users className="h-3.5 w-3.5 text-blue-500" />
            Chỉ hiện chuyến còn &gt; 5 chỗ
          </span>
          {countAvailableOnly > 0 && (
            <span className="text-[10px] text-muted-foreground bg-slate-100 rounded-full px-1.5 py-0.5">{countAvailableOnly}</span>
          )}
        </label>
      </div>

      {/* Amenities */}
      <div className="pt-3 border-t">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Tiện ích</div>
        <div className="grid grid-cols-2 gap-1.5">
          {AMENITY_OPTIONS.map((opt) => {
            const active = filters.amenities.includes(opt.key)
            const count = countForAmenity(opt.key)
            return (
              <label
                key={opt.key}
                className={cn(
                  'flex items-center gap-1.5 cursor-pointer px-2 py-1.5 rounded-md border text-xs transition-all',
                  active
                    ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                    : 'border-slate-200 hover:bg-slate-50'
                )}
              >
                <Checkbox
                  checked={active}
                  onCheckedChange={() => toggleAmenity(opt.key)}
                  className="h-3.5 w-3.5 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                />
                <span className="text-blue-500">{opt.icon}</span>
                <span className="flex-1 truncate">{opt.label}</span>
                {count > 0 && (
                  <span className="text-[10px] text-muted-foreground">{count}</span>
                )}
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useMemo, type ReactNode } from 'react'
import {
  Building2,
  Droplet,
  Moon,
  Snowflake,
  Star,
  Sun,
  Sunrise,
  Sunset,
  BedDouble,
  Users,
  Wifi,
  Zap,
} from 'lucide-react'
import type { TripResult } from '@/api'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatCurrency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/stores/prefs'
import {
  brandOptions,
  count,
  departureHour,
  FEW_SEATS,
  inTimeRange,
  toggle,
  type TimeRange,
} from './filters'
import { CheckRow, FilterSection } from './filter-ui'
import type { ResultFilters } from './use-result-filters'

const icon = (Icon: typeof Sun) => <Icon className="h-3.5 w-3.5" />

export const TIME_RANGES: { key: TimeRange; labelKey: string; icon: ReactNode }[] = [
  { key: '0-6', labelKey: 'search.filter.earlyMorning', icon: icon(Sunrise) },
  { key: '6-12', labelKey: 'search.filter.morning', icon: icon(Sun) },
  { key: '12-18', labelKey: 'search.filter.afternoon', icon: icon(Sunset) },
  { key: '18-24', labelKey: 'searchPage.timeEvening', icon: icon(Moon) },
]

export const AMENITIES: { key: string; labelKey: string; icon: ReactNode }[] = [
  { key: 'wifi', labelKey: 'searchPage.amenityWifi', icon: icon(Wifi) },
  { key: 'ac', labelKey: 'searchPage.amenityAc', icon: icon(Snowflake) },
  { key: 'water', labelKey: 'searchPage.amenityWater', icon: icon(Droplet) },
  { key: 'charging', labelKey: 'searchPage.amenityCharging', icon: icon(Zap) },
  { key: 'blanket', labelKey: 'searchPage.amenityBlanket', icon: icon(BedDouble) },
]

const RATINGS = [0, 4.0, 4.5, 4.8]

/** The client-side filters: price, departure time, rating, brand, availability, amenities. */
export function FilterPanel({
  results,
  rf,
  mobile,
}: {
  results: TripResult[]
  rf: ResultFilters
  mobile?: boolean
}) {
  const t = useT()
  const { filters, setFilters } = rf
  const brands = useMemo(() => brandOptions(results), [results])
  const set = (patch: Partial<typeof filters>) => setFilters({ ...filters, ...patch })

  return (
    <div className={cn('space-y-4', mobile && 'space-y-5')}>
      <PriceRange rf={rf} />

      <FilterSection title={t('search.sort.departure')}>
        <div className="space-y-1.5">
          {TIME_RANGES.map((o) => (
            <CheckRow
              key={o.key}
              checked={filters.timeRanges.includes(o.key)}
              onChange={() => set({ timeRanges: toggle(filters.timeRanges, o.key) })}
              icon={o.icon}
              count={count(results, (r) => inTimeRange(departureHour(r), o.key))}
            >
              {t(o.labelKey)}
            </CheckRow>
          ))}
        </div>
      </FilterSection>

      <FilterSection title={t('searchPage.minRating')}>
        <RadioGroup
          value={String(filters.minRating)}
          onValueChange={(v) => set({ minRating: Number(v) })}
          className="grid grid-cols-2 gap-1.5"
        >
          {RATINGS.map((min) => {
            const n = min === 0 ? results.length : count(results, (r) => r.brandRating >= min)
            return (
              <label
                key={min}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-all',
                  filters.minRating === min
                    ? 'border-blue-400 bg-blue-50 font-medium text-blue-700'
                    : 'border-transparent hover:bg-slate-100',
                )}
              >
                <RadioGroupItem
                  value={String(min)}
                  id={`rating-${min}`}
                  className="data-[state=checked]:border-blue-600 data-[state=checked]:text-blue-600"
                />
                {min > 0 && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                <span className="flex-1">{min === 0 ? t('common.all') : `${min.toFixed(1)}+`}</span>
                {n > 0 && <span className="text-[10px] text-muted-foreground">{n}</span>}
              </label>
            )
          })}
        </RadioGroup>
      </FilterSection>

      {brands.length > 1 && (
        <FilterSection title={t('searchPage.brandFilter')}>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {brands.map((b) => (
              <CheckRow
                key={b.slug}
                boxed
                checked={filters.brands.includes(b.slug)}
                onChange={() => set({ brands: toggle(filters.brands, b.slug) })}
                icon={<Building2 className="h-3.5 w-3.5" />}
                count={b.count}
              >
                {b.name}
              </CheckRow>
            ))}
          </div>
        </FilterSection>
      )}

      <FilterSection title={t('searchPage.availableSeats')}>
        <CheckRow
          checked={filters.availableOnly}
          onChange={() => set({ availableOnly: !filters.availableOnly })}
          icon={<Users className="h-3.5 w-3.5" />}
          count={count(results, (r) => r.availableSeats > FEW_SEATS)}
        >
          {t('searchPage.availableOnlyLabel')}
        </CheckRow>
      </FilterSection>

      <FilterSection title={t('searchPage.amenities')}>
        <div className="grid grid-cols-2 gap-1.5">
          {AMENITIES.map((o) => (
            <CheckRow
              key={o.key}
              boxed
              checked={filters.amenities.includes(o.key)}
              onChange={() => set({ amenities: toggle(filters.amenities, o.key) })}
              icon={o.icon}
              count={count(results, (r) => (r.amenities ?? []).includes(o.key))}
            >
              {t(o.labelKey)}
            </CheckRow>
          ))}
        </div>
      </FilterSection>
    </div>
  )
}

function PriceRange({ rf }: { rf: ResultFilters }) {
  const t = useT()
  const currency = usePrefs((s) => s.currency)
  const money = (n: number) => formatCurrency(n, currency)
  const { bounds, range } = rf
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="shrink-0 text-xs font-semibold uppercase text-muted-foreground">
          {t('searchPage.priceRange')}
        </span>
        <span className="text-right text-[11px] font-medium leading-tight tabular-nums text-blue-700">
          {money(range[0])}
          <span className="mx-0.5 text-slate-400">–</span>
          {money(range[1])}
        </span>
      </div>
      <Slider
        value={[range[0], range[1]]}
        min={bounds[0]}
        max={bounds[1]}
        step={50000}
        onValueChange={([priceMin, priceMax]) => rf.setFilters({ ...rf.filters, priceMin, priceMax })}
        className="py-2"
      />
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{money(bounds[0])}</span>
        <span>{money(bounds[1])}</span>
      </div>
    </div>
  )
}

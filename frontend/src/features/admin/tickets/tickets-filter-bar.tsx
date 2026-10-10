'use client'

import { usePrefs } from '@/stores/prefs'
import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ComboboxField } from '@/components/ui/combobox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarRange, Download, Search, TrendingUp, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import type { AdminBrandsListResponse } from '@/api'
import type { UseQueryResult } from '@tanstack/react-query'
import type { AdminBookingFilter } from './api'
import { useT } from '@/lib/i18n'

// ── Constants ────────────────────────────────────────────────

const STATUS_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'adminTickets.allStatuses' },
  { value: 'awaiting', labelKey: 'adminTickets.statusAwaiting' },
  { value: 'confirmed', labelKey: 'adminTickets.statusConfirmed' },
  { value: 'completed', labelKey: 'adminTickets.statusCompleted' },
  { value: 'cancelled', labelKey: 'adminTickets.statusCancelled' },
]

const RANGE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'today', labelKey: 'adminTickets.rangeToday' },
  { value: '7d', labelKey: 'adminTickets.range7d' },
  { value: '30d', labelKey: 'adminTickets.range30d' },
  { value: '90d', labelKey: 'adminTickets.range90d' },
  { value: 'this_month', labelKey: 'adminTickets.rangeThisMonth' },
  { value: 'last_month', labelKey: 'adminTickets.rangeLastMonth' },
  { value: 'custom', labelKey: 'adminTickets.rangeCustom' },
]

export function TicketsFilterBar({
  filter,
  setFilter,
  searchInput,
  setSearchInput,
  onSearchChange,
  setRangeFilter,
  showStats,
  setShowStats,
  handleExport,
  exporting,
  brandsQuery,
  setBrandFilter,
  setStatusFilter,
  activeFilterCount,
  resetFilters,
  setDateRange,
}: {
  filter: AdminBookingFilter
  setFilter: Dispatch<SetStateAction<AdminBookingFilter>>
  searchInput: string
  setSearchInput: Dispatch<SetStateAction<string>>
  onSearchChange: (v: string) => void
  setRangeFilter: (range: string) => void
  showStats: boolean
  setShowStats: Dispatch<SetStateAction<boolean>>
  handleExport: () => void
  exporting: boolean
  brandsQuery: UseQueryResult<AdminBrandsListResponse>
  setBrandFilter: (brandId: string) => void
  setStatusFilter: (status: string) => void
  activeFilterCount: number
  resetFilters: () => void
  setDateRange: (from: string, to: string) => void
}) {
  const t = useT()
  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('adminTickets.searchPlaceholder')}
            className="pl-9"
          />
        </div>

        {/* Phones: two filters to a row, the actions sharing the last one. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <ComboboxField
            value={filter.range}
            onValueChange={setRangeFilter}
            items={RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            className="min-w-0 sm:w-36"
            placeholder={t('adminTickets.timeRange')}
            searchPlaceholder={t('combobox.search')}
            aria-label={t('adminTickets.timeRange')}
            data-testid="tickets-range-filter"
          />
          <ComboboxField
            value={filter.status ?? 'all'}
            onValueChange={setStatusFilter}
            items={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            className="min-w-0 sm:w-40"
            placeholder={t('common.status')}
            searchPlaceholder={t('combobox.search')}
            aria-label={t('adminTickets.filterStatus')}
            data-testid="tickets-status-filter"
          />
          <ComboboxField
            value={filter.brandId ?? 'all'}
            onValueChange={setBrandFilter}
            items={[
              { value: 'all', label: t('adminTickets.allBrands') },
              ...(brandsQuery.data?.items ?? []).map((b) => ({
                value: b.id,
                label: b.name ?? t('admin.brands'),
              })),
            ]}
            className="col-span-2 min-w-0 sm:w-48"
            placeholder={t('adminTickets.allBrands')}
            searchPlaceholder={t('adminTickets.searchBrand')}
            aria-label={t('adminTickets.filterBrand')}
            data-testid="tickets-brand-filter"
          />

          {filter.range === 'custom' && (
            <div className="col-span-2">
              <CustomDateRange
                dateFrom={filter.dateFrom}
                dateTo={filter.dateTo}
                onChange={setDateRange}
              />
            </div>
          )}

          <div className="col-span-2 flex gap-2 sm:ml-auto">
            <Button
              variant={showStats ? 'secondary' : 'outline'}
              className="flex-1 sm:flex-none"
              aria-pressed={showStats}
              onClick={() => setShowStats((v) => !v)}
            >
              <TrendingUp />
              {t('adminTickets.chart')}
            </Button>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download />
              {exporting ? t('adminTickets.exporting') : t('adminTickets.exportCsv')}
            </Button>
          </div>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            {filter.brandId && (
              <FilterChip
                label={t('adminTickets.chipBrand', {
                  value:
                    brandsQuery.data?.items?.find((b) => b.id === filter.brandId)?.name ??
                    filter.brandId,
                })}
                onClear={() => setBrandFilter('all')}
              />
            )}
            {filter.status && filter.status !== 'all' && (
              <FilterChip
                label={t('adminTickets.chipStatus', {
                  value:
                    STATUS_OPTIONS.find((o) => o.value === filter.status) !== undefined
                      ? t(STATUS_OPTIONS.find((o) => o.value === filter.status)!.labelKey)
                      : filter.status,
                })}
                onClear={() => setStatusFilter('all')}
              />
            )}
            {filter.search && (
              <FilterChip
                label={t('adminTickets.chipSearch', { value: filter.search })}
                onClear={() => {
                  setSearchInput('')
                  setFilter((f) => ({ ...f, search: undefined, offset: 0 }))
                }}
              />
            )}
            {filter.range && filter.range !== '30d' && (
              <FilterChip
                label={t('adminTickets.chipRange', {
                  value:
                    RANGE_OPTIONS.find((o) => o.value === filter.range) !== undefined
                      ? t(RANGE_OPTIONS.find((o) => o.value === filter.range)!.labelKey)
                      : filter.range,
                })}
                onClear={() => setRangeFilter('30d')}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              onClick={resetFilters}
            >
              <X />
              {t('adminTickets.clearFiltersCount', { count: activeFilterCount })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── FilterChip ───────────────────────────────────────────────

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pr-0.5 pl-2.5 text-xs text-primary">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="grid size-6 place-items-center rounded-full hover:bg-primary/15"
        aria-label={t('adminTickets.clearFilter')}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

// ── CustomDateRange ──────────────────────────────────────────

function CustomDateRange({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom?: string
  dateTo?: string
  onChange: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const t = useT()
  const lang = usePrefs((s) => s.lang)
  const dateLocale = lang === 'en' ? enUS : vi
  const from = dateFrom ? parseISO(dateFrom) : undefined
  const to = dateTo ? parseISO(dateTo) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <CalendarRange className="h-3.5 w-3.5" />
          <span className="text-xs">
            {dateFrom || dateTo
              ? `${dateFrom ?? '…'} → ${dateTo ?? '…'}`
              : t('adminTickets.chooseDates')}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {/* Single month on phones — two stacked months overflowed the
            popover past the viewport with no scroll. */}
        <Calendar
          mode="range"
          selected={{ from, to }}
          onSelect={(range) => {
            const f = range?.from ? format(range.from, 'yyyy-MM-dd') : ''
            const toIso = range?.to ? format(range.to, 'yyyy-MM-dd') : ''
            onChange(f, toIso)
            if (f && toIso) setOpen(false)
          }}
          numberOfMonths={isMobile ? 1 : 2}
          locale={dateLocale}
        />
      </PopoverContent>
    </Popover>
  )
}

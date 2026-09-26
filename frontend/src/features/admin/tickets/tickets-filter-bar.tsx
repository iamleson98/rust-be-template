'use client'

import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ComboboxField } from '@/components/ui/combobox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import {
  Search,
  Download,
  Filter,
  X,
  CalendarRange,
  TrendingUp,
  Bus,
  CheckCircle2,
  Clock,
  Ban,
  RotateCcw,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import {
  useAdminBrands,
  useAdminBookingExport,
  type AdminBookingFilter,
} from '@/lib/queries'
import { useT } from '@/lib/i18n'
import { useApp } from '@/lib/store'

// ── Constants ────────────────────────────────────────────────

const STATUS_OPTIONS: { value: string; labelKey: string; icon: React.ReactNode }[] = [
  { value: 'all', labelKey: 'adminTickets.allStatuses', icon: <Filter className="h-3.5 w-3.5" /> },
  { value: 'confirmed', labelKey: 'adminTickets.statusConfirmed', icon: <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> },
  { value: 'pending', labelKey: 'adminTickets.statusPending', icon: <Clock className="h-3.5 w-3.5 text-amber-600" /> },
  { value: 'completed', labelKey: 'adminTickets.statusCompleted', icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> },
  { value: 'cancelled', labelKey: 'adminTickets.statusCancelled', icon: <Ban className="h-3.5 w-3.5 text-rose-600" /> },
  { value: 'refunded', labelKey: 'adminTickets.statusRefunded', icon: <RotateCcw className="h-3.5 w-3.5 text-slate-600" /> },
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
  setShowStats,
  handleExport,
  exportMutation,
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
  setShowStats: Dispatch<SetStateAction<boolean>>
  handleExport: () => void
  exportMutation: ReturnType<typeof useAdminBookingExport>
  brandsQuery: ReturnType<typeof useAdminBrands>
  setBrandFilter: (brandId: string) => void
  setStatusFilter: (status: string) => void
  activeFilterCount: number
  resetFilters: () => void
  setDateRange: (from: string, to: string) => void
}) {
  const t = useT()
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          {/* Row 1: search + range + sort */}
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1 min-w-50">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t('adminTickets.searchPlaceholder')}
                className="pl-8 h-9"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <ComboboxField
                value={filter.range}
                onValueChange={setRangeFilter}
                items={RANGE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                className="h-9 w-full sm:w-35"
                placeholder={t('adminTickets.timeRange')}
                searchPlaceholder={t('combobox.search')}
                aria-label={t('adminTickets.timeRange')}
                data-testid="tickets-range-filter"
              />
            </div>

            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setShowStats((v) => !v)}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('adminTickets.chart')}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={handleExport}
                disabled={exportMutation.isPending}
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {exportMutation.isPending ? t('adminTickets.exporting') : t('adminTickets.exportCsv')}
                </span>
              </Button>
            </div>
          </div>

          {/* Row 2: brand + status + custom date range + reset */}
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:flex-wrap">
            <div className="flex items-center gap-1.5">
              <Bus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
                className="h-9 w-full sm:w-45"
                placeholder={t('adminTickets.allBrands')}
                searchPlaceholder={t('adminTickets.searchBrand')}
                aria-label={t('adminTickets.filterBrand')}
                data-testid="tickets-brand-filter"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <ComboboxField
                value={filter.status ?? 'all'}
                onValueChange={setStatusFilter}
                items={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                className="h-9 w-full sm:w-40"
                placeholder={t('common.status')}
                searchPlaceholder={t('combobox.search')}
                aria-label={t('adminTickets.filterStatus')}
                data-testid="tickets-status-filter"
              />
            </div>

            {filter.range === 'custom' && (
              <CustomDateRange
                dateFrom={filter.dateFrom}
                dateTo={filter.dateTo}
                onChange={setDateRange}
              />
            )}

            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-muted-foreground ml-auto"
                onClick={resetFilters}
              >
                <X className="h-3.5 w-3.5" />
                {t('adminTickets.clearFiltersCount', { count: activeFilterCount })}
              </Button>
            )}
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t">
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
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── FilterChip ───────────────────────────────────────────────

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 border border-blue-200">
      {label}
      <button
        onClick={onClear}
        className="ml-0.5 rounded-full hover:bg-blue-100 p-0.5"
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
  const t = useT()
  const lang = useApp((s) => s.lang)
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
        <Calendar
          mode="range"
          selected={{ from, to }}
          onSelect={(range) => {
            const f = range?.from ? format(range.from, 'yyyy-MM-dd') : ''
            const toIso = range?.to ? format(range.to, 'yyyy-MM-dd') : ''
            onChange(f, toIso)
            if (f && toIso) setOpen(false)
          }}
          numberOfMonths={2}
          locale={dateLocale}
        />
      </PopoverContent>
    </Popover>
  )
}

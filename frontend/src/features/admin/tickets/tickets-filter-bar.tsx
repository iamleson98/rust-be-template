'use client'

import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { vi } from 'date-fns/locale'
import {
  useAdminBrands,
  useAdminBookingExport,
  type AdminBookingFilter,
} from '@/lib/queries'

// ── Constants ────────────────────────────────────────────────

const STATUS_OPTIONS: { value: string; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'Tất cả trạng thái', icon: <Filter className="h-3.5 w-3.5" /> },
  { value: 'confirmed', label: 'Đã xác nhận', icon: <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> },
  { value: 'pending', label: 'Chờ xử lý', icon: <Clock className="h-3.5 w-3.5 text-amber-600" /> },
  { value: 'completed', label: 'Hoàn thành', icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> },
  { value: 'cancelled', label: 'Đã huỷ', icon: <Ban className="h-3.5 w-3.5 text-rose-600" /> },
  { value: 'refunded', label: 'Hoàn tiền', icon: <RotateCcw className="h-3.5 w-3.5 text-slate-600" /> },
]

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: '90d', label: '90 ngày' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: 'custom', label: 'Tùy chỉnh' },
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
                placeholder="Tìm theo mã vé, tên khách, SĐT…"
                className="pl-8 h-9"
              />
            </div>

            <Select value={filter.range} onValueChange={setRangeFilter}>
              <SelectTrigger className="h-9 w-full sm:w-35">
                <CalendarRange className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setShowStats((v) => !v)}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Biểu đồ</span>
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
                  {exportMutation.isPending ? 'Đang xuất…' : 'Xuất CSV'}
                </span>
              </Button>
            </div>
          </div>

          {/* Row 2: brand + status + custom date range + reset */}
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:flex-wrap">
            <Select
              value={filter.brandId ?? 'all'}
              onValueChange={setBrandFilter}
            >
              <SelectTrigger className="h-9 w-full sm:w-45">
                <Bus className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Tất cả hãng xe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả hãng xe</SelectItem>
                {brandsQuery.data?.items?.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: b.accentColor ?? '#64748b' }}
                      />
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filter.status ?? 'all'} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full sm:w-40">
                <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex items-center gap-2">
                      {o.icon}
                      {o.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

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
                Xoá bộ lọc ({activeFilterCount})
              </Button>
            )}
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t">
              {filter.brandId && (
                <FilterChip
                  label={`Hãng: ${brandsQuery.data?.items?.find((b) => b.id === filter.brandId)?.name ?? filter.brandId}`}
                  onClear={() => setBrandFilter('all')}
                />
              )}
              {filter.status && filter.status !== 'all' && (
                <FilterChip
                  label={`Trạng thái: ${STATUS_OPTIONS.find((o) => o.value === filter.status)?.label ?? filter.status}`}
                  onClear={() => setStatusFilter('all')}
                />
              )}
              {filter.search && (
                <FilterChip
                  label={`Tìm: "${filter.search}"`}
                  onClear={() => {
                    setSearchInput('')
                    setFilter((f) => ({ ...f, search: undefined, offset: 0 }))
                  }}
                />
              )}
              {filter.range && filter.range !== '30d' && (
                <FilterChip
                  label={`Khoảng: ${RANGE_OPTIONS.find((o) => o.value === filter.range)?.label ?? filter.range}`}
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
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 border border-blue-200">
      {label}
      <button
        onClick={onClear}
        className="ml-0.5 rounded-full hover:bg-blue-100 p-0.5"
        aria-label="Xoá bộ lọc"
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
              : 'Chọn ngày'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={{ from, to }}
          onSelect={(range) => {
            const f = range?.from ? format(range.from, 'yyyy-MM-dd') : ''
            const t = range?.to ? format(range.to, 'yyyy-MM-dd') : ''
            onChange(f, t)
            if (f && t) setOpen(false)
          }}
          numberOfMonths={2}
          locale={vi}
        />
      </PopoverContent>
    </Popover>
  )
}

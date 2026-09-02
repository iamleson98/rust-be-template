'use client'

/**
 * AddressPointSelect — a Select bound to address ids.
 *
 * Display value = address name (plus province subtitle in the dropdown);
 * actual value = the address id, exactly as the schedule-points API
 * expects. The small "＋" button next to the trigger opens the map
 * dialog so users can define a brand-new address for this point without
 * leaving the schedule form ("Tạo địa điểm mới").
 *
 * Base UI unmounts SelectContent when the popover closes, so the
 * trigger can no longer look labels up by matching the value — we keep
 * a side-table map (id → name) instead, same trick as the city select
 * in route-form.tsx.
 */

import { CircleDot, Flag, MapPin, Plus } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { AdminAddressOut } from '@/lib/api/types.gen'
import { cn } from '@/lib/utils'

type PointKind = 'pickup' | 'middle' | 'drop'

const KIND_META: Record<PointKind, { placeholder: string; icon: typeof MapPin; iconClass: string }> = {
  pickup: { placeholder: 'Chọn điểm khởi hành…', icon: CircleDot, iconClass: 'text-blue-600' },
  middle: { placeholder: 'Chọn điểm trung gian…', icon: MapPin, iconClass: 'text-amber-600' },
  drop: { placeholder: 'Chọn điểm kết thúc…', icon: Flag, iconClass: 'text-rose-600' },
}

type Props = {
  value: string | undefined
  onChange: (addressId: string | undefined) => void
  addresses: AdminAddressOut[]
  loading?: boolean
  /** Which slot this select fills — controls icon + placeholder. */
  kind: PointKind
  /** Opens the "create address" map modal (owned by the parent form). */
  onCreateNew: () => void
  disabled?: boolean
  className?: string
}

export function AddressPointSelect({
  value,
  onChange,
  addresses,
  loading,
  kind,
  onCreateNew,
  disabled,
  className,
}: Props) {
  const meta = KIND_META[kind]
  const Icon = meta.icon

  const nameById = new Map(addresses.map((a) => [a.id, a.name]))
  const labelFor = (id: string | null | undefined) => (id ? nameById.get(id) ?? null : null)

  return (
    <div className={cn('flex items-start gap-1.5', className)}>
      {loading ? (
        <Skeleton className="h-9 flex-1" />
      ) : (
        // NOTE: `value ?? ''` (never `undefined`) — Base UI's Select
        // must not switch from uncontrolled (undefined) to controlled
        // mid-lifetime: it ignores the late value and logs a React
        // warning. `''` = "no selection" keeps it controlled from
        // mount (same idiom as the working gallery/bus-layout
        // selects), so a value set later — e.g. by the address
        // creation modal — renders immediately. `''` keeps
        // hasSelectedValue false → the placeholder still shows.
        <Select
          value={value ?? ''}
          onValueChange={onChange}
          disabled={disabled || (addresses.length === 0 && !loading)}
        >
          <SelectTrigger className="flex-1 w-auto">
            <span className="flex min-w-0 items-center gap-2">
              <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.iconClass)} />
              <SelectValue placeholder={meta.placeholder}>
                {(v: string | null | undefined) => (
                  <span className="truncate">{labelFor(v) ?? meta.placeholder}</span>
                )}
              </SelectValue>
            </span>
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {addresses.length === 0 ? (
              <div className="p-3 text-xs text-center text-muted-foreground">
                Hãng chưa có địa điểm nào — bấm nút
                <Plus className="inline h-3 w-3 mx-0.5 -mt-0.5" />
                để tạo mới
              </div>
            ) : (
              addresses.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                    <span className="truncate">{a.name}</span>
                    {a.province ? (
                      <span className="text-[11px] text-muted-foreground truncate">
                        · {a.province}
                      </span>
                    ) : null}
                  </span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}

      {/* Create a new address for this point — opens the map modal. */}
      <button
        type="button"
        onClick={onCreateNew}
        disabled={disabled}
        title="Tạo địa điểm mới"
        aria-label="Tạo địa điểm mới"
        className="mt-px h-9 w-9 shrink-0 rounded-md border border-dashed flex items-center justify-center text-muted-foreground hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
}

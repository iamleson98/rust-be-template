'use client'

/**
 * AddressPointSelect — an infinite-scroll, searchable select bound to
 * address ids.
 *
 * Display value = address name; actual value = the address id, exactly
 * as the schedule-points API expects. Options come from the paginated
 * `GET /api/admin/addresses?brandId=&q=&limit=&offset=` endpoint: each
 * keystroke re-searches server-side (debounced) and scrolling to the
 * bottom of the list loads the next page — a brand with thousands of
 * stops never has to ship them all to the browser.
 *
 * `extraAddresses` (the schedule's existing points on edit + ones just
 * created in the map modal) are always merged in front of the fetched
 * pages so the current selection always resolves its label.
 *
 * The small "＋" button next to the trigger opens the map dialog so
 * users can define a brand-new address without leaving the form.
 */

import { CircleDot, Flag, MapPin, Plus } from 'lucide-react'

import { InfiniteSelect } from '@/components/ui/infinite-select'
import { Skeleton } from '@/components/ui/skeleton'
import type { AdminAddressOut } from '@/lib/api/types.gen'
import { fetchAdminAddressesPage } from '@/lib/queries'
import { cn } from '@/lib/utils'

type PointKind = 'pickup' | 'middle' | 'drop'

const KIND_META: Record<
  PointKind,
  { placeholder: string; searchPlaceholder: string; icon: typeof MapPin; iconClass: string }
> = {
  pickup: {
    placeholder: 'Chọn điểm khởi hành…',
    searchPlaceholder: 'Tìm điểm khởi hành…',
    icon: CircleDot,
    iconClass: 'text-blue-600',
  },
  middle: {
    placeholder: 'Chọn điểm trung gian…',
    searchPlaceholder: 'Tìm điểm trung gian…',
    icon: MapPin,
    iconClass: 'text-amber-600',
  },
  drop: {
    placeholder: 'Chọn điểm kết thúc…',
    searchPlaceholder: 'Tìm điểm kết thúc…',
    icon: Flag,
    iconClass: 'text-rose-600',
  },
}

type Props = {
  value: string | undefined
  onChange: (addressId: string | undefined) => void
  /** The brand whose addresses populate the list. */
  brandId: string | undefined
  /** Addresses that must always resolve/show (edit-mode points, newly created). */
  extraAddresses?: AdminAddressOut[]
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
  brandId,
  extraAddresses,
  loading,
  kind,
  onCreateNew,
  disabled,
  className,
}: Props) {
  const meta = KIND_META[kind]
  const Icon = meta.icon

  return (
    <div className={cn('flex items-start gap-1.5', className)}>
      {loading || !brandId ? (
        <Skeleton className="h-9 flex-1" />
      ) : (
        <InfiniteSelect<AdminAddressOut>
          scope={`brand-addresses-${brandId}`}
          fetchPage={(page, search) => fetchAdminAddressesPage(brandId, page, search)}
          value={value ?? null}
          onValueChange={(v) => onChange(v ?? undefined)}
          itemValue={(a) => a.id}
          itemLabel={(a) => a.name}
          extraItems={extraAddresses}
          placeholder={meta.placeholder}
          searchPlaceholder={meta.searchPlaceholder}
          disabled={disabled}
          className="flex-1 w-auto"
          renderValue={(item, rawValue) => (
            <span className="flex min-w-0 items-center gap-2">
              <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.iconClass)} />
              <span className="truncate">
                {item ? item.name : (rawValue ?? meta.placeholder)}
              </span>
            </span>
          )}
          renderItem={(a) => (
            <span className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-600" />
              <span className="truncate">{a.name}</span>
              {a.province ? (
                <span className="text-[11px] text-muted-foreground truncate">
                  · {a.province}
                </span>
              ) : null}
            </span>
          )}
        />
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

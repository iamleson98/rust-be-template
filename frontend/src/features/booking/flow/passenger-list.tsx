'use client'

/**
 * PassengerList — presentational pieces used by the BookingDialog's
 * passenger step (step 1).
 *
 * Extracted from the original `booking-dialog.tsx`. Two exports:
 *
 *   - `PassengerStepHeader` — the step title row with the "Sao chép từ
 *     liên hệ" + "Tự ghép ghế" action buttons.
 *   - `PassengerSummary` — the bottom summary box with passenger-count
 *     badges + the subtotal + validation warnings (unassigned seats,
 *     duplicate seats, all-assigned OK state).
 *
 * The actual passenger-card rendering (with per-passenger name/age/gender
 * inputs + seat-select dropdown) stays inside the main `BookingDialog`
 * because it's tightly coupled to RHF's `useFieldArray` state — moving
 * it out without breaking the form context would require lifting all the
 * form state to a context provider, which is a larger refactor.
 */

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertTriangle,
  Baby,
  CheckCircle2,
  Copy,
  Plus,
  Sparkles,
  User,
  UserCheck,
  Users,
} from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import type { PassengerFormValue } from './booking-form'

export function PassengerStepHeader({
  passengerCount,
  selectedSeatCount,
  onCopyContactToFirst,
  onAutoAssignSeats,
  canCopyContact,
  hasUnassigned,
}: {
  passengerCount: number
  selectedSeatCount: number
  onCopyContactToFirst: () => void
  onAutoAssignSeats: () => void
  canCopyContact: boolean
  hasUnassigned: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <Users className="h-4 w-4 text-blue-600" />
          Thông tin hành khách
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {passengerCount}/{selectedSeatCount} hành khách • {selectedSeatCount} ghế đã chọn
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onCopyContactToFirst}
          disabled={!canCopyContact}
          className="gap-1.5 h-8 text-xs"
        >
          <Copy className="h-3.5 w-3.5" />
          Sao chép từ liên hệ
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onAutoAssignSeats}
          disabled={!hasUnassigned}
          className="gap-1.5 h-8 text-xs"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Tự ghép ghế
        </Button>
      </div>
    </div>
  )
}

export function PassengerSummary({
  passengers,
  selectedSeatCount,
  subtotal,
  currency,
  unassignedCount,
  hasDuplicateSeats,
}: {
  passengers: PassengerFormValue[]
  selectedSeatCount: number
  subtotal: number
  currency: Currency
  unassignedCount: number
  hasDuplicateSeats: boolean
}) {
  // Auto-derive the per-type passenger counts (adults / children / infants).
  const adult = passengers.filter((p) => p.age >= 12).length
  const child = passengers.filter((p) => p.age >= 2 && p.age < 12).length
  const infant = passengers.filter((p) => p.age < 2).length

  return (
    <div className="rounded-lg border bg-white p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        <CheckCircle2 className="h-3 w-3 text-blue-600" />
        Tóm tắt
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge className="bg-blue-100 text-blue-700 border-0 gap-1">
          <User className="h-3 w-3" />
          {adult} người lớn
        </Badge>
        <Badge className="bg-amber-100 text-amber-700 border-0 gap-1">
          <UserCheck className="h-3 w-3" />
          {child} trẻ em
        </Badge>
        {infant > 0 && (
          <Badge className="bg-pink-100 text-pink-700 border-0 gap-1">
            <Baby className="h-3 w-3" />
            {infant} em bé
          </Badge>
        )}
        <Separator orientation="vertical" className="h-4" />
        <span className="text-muted-foreground">Tổng chi phí ghế:</span>
        <span className="font-bold text-blue-700">{formatCurrency(subtotal, currency)}</span>
      </div>
      {unassignedCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Còn {unassignedCount} hành khách chưa ghép ghế. Nhấn &quot;Tự ghép ghế&quot; để tự động gắn ghế trống.
          </span>
        </div>
      )}
      {hasDuplicateSeats && (
        <div className="flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Có ghế bị trùng — mỗi hành khách phải ngồi một ghế khác nhau.</span>
        </div>
      )}
      {unassignedCount === 0 && !hasDuplicateSeats && passengers.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Tất cả hành khách đã được ghép ghế.</span>
        </div>
      )}
      {/* selectedSeatCount is exposed via the title/summary above; kept in
          the prop list so callers don't have to filter the passengers array
          to compute it. */}
      <span className="sr-only">{selectedSeatCount} ghế đã chọn</span>
    </div>
  )
}

export function AddPassengerButton({
  remaining,
  onClick,
}: {
  remaining: number
  onClick: () => void
}) {
  if (remaining <= 0) return null
  return (
    <Button variant="outline" onClick={onClick} className="w-full gap-1.5 border-dashed">
      <Plus className="h-4 w-4" />
      Thêm hành khách (còn {remaining} ghế)
    </Button>
  )
}

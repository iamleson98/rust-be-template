'use client'

/**
 * PassengerFormCard — one row of the BookingDialog's passenger step: the
 * passenger pill + type badge, the name / age / gender inputs and the seat
 * assignment dropdown (with per-seat price + already-assigned hints).
 *
 * Extracted from the original `booking-dialog.tsx` — rendered inside a
 * `passengerFields.map(...)` by the passenger step; the RHF `control` is
 * passed down so the form state keeps living in the parent dialog.
 */

import type { Control, FieldArrayWithId } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FormField,
  FormControl,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { SEAT_CLASS_LABELS } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { User, Trash2, Armchair, GripVertical } from 'lucide-react'
import {
  type BookingValues,
  type PassengerFormValue,
  type SelectedSeat,
  getPassengerType,
  PASSENGER_TYPE_META,
} from './booking-form'

export function PassengerFormCard({
  p,
  i,
  passengers,
  passengerFields,
  selectedSeatCodes,
  control,
  currency,
  removePassenger,
}: {
  p: FieldArrayWithId<BookingValues, 'passengers'>
  i: number
  passengers: PassengerFormValue[]
  passengerFields: FieldArrayWithId<BookingValues, 'passengers'>[]
  selectedSeatCodes: SelectedSeat[]
  control: Control<BookingValues>
  currency: Currency
  removePassenger: (index: number) => void
}) {
  const passenger = passengers[i] ?? (p as PassengerFormValue)
  const typeMeta = PASSENGER_TYPE_META[getPassengerType(passenger.age)]
  const assignedSeat = selectedSeatCodes.find((s) => s.id === passenger.seatId)
  return (
    <div
      className={`rounded-xl border-2 bg-linear-to-br ${typeMeta.gradient} ${typeMeta.border} p-3 space-y-2.5`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab shrink-0" aria-hidden />
          <div className={`h-7 w-7 rounded-full ${typeMeta.pill} inline-flex items-center justify-center text-xs font-bold shrink-0`}>
            {i + 1}
          </div>
          <span className="text-xs font-medium text-slate-700 shrink-0 hidden sm:inline">
            Hành khách {i + 1}
          </span>
          <Badge className={`${typeMeta.pill} border-0 text-[10px] gap-1 shrink-0`}>
            {typeMeta.icon}
            {typeMeta.label}
            {getPassengerType(passenger.age) === 'infant' && <span className="opacity-70">(miễn phí)</span>}
          </Badge>
        </div>
        {passengerFields.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 shrink-0"
            onClick={() => removePassenger(i)}
            aria-label="Xoá hành khách"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Inputs: name + age + gender */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px_120px] gap-2">
        <FormField
          control={control}
          name={`passengers.${i}.name`}
          render={({ field }) => (
            <FormItem className="relative space-y-0">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
              <FormControl>
                <Input
                  {...field}
                  placeholder="Họ và tên (như CCCD)"
                  className="pl-8 bg-white"
                />
              </FormControl>
              <FormMessage className="mt-1" />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`passengers.${i}.age`}
          render={({ field }) => (
            <FormItem className="space-y-0">
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={field.value ?? 0}
                  onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  placeholder="Tuổi"
                  className="bg-white"
                />
              </FormControl>
              <FormMessage className="mt-1" />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`passengers.${i}.gender`}
          render={({ field }) => (
            <FormItem className="space-y-0">
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Giới tính" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="male">Nam</SelectItem>
                  <SelectItem value="female">Nữ</SelectItem>
                  <SelectItem value="other">Khác</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage className="mt-1" />
            </FormItem>
          )}
        />
      </div>

      {/* Seat assignment dropdown */}
      <div className="flex items-center gap-2">
        <Armchair className="h-4 w-4 text-muted-foreground shrink-0" />
        <FormField
          control={control}
          name={`passengers.${i}.seatId`}
          render={({ field }) => (
            <FormItem className="flex-1 space-y-0">
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Chọn ghế cho hành khách này" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {selectedSeatCodes.map((s) => {
                    const assignedTo = passengers.find((pp, j) => pp.seatId === s.id && j !== i)
                    const assignedToIdx = assignedTo ? passengers.indexOf(assignedTo) + 1 : null
                    return (
                      <SelectItem
                        key={s.id}
                        value={s.id}
                        disabled={!!assignedTo}
                        textValue={`${s.code} • ${SEAT_CLASS_LABELS[s.class] ?? s.class} • ${formatCurrency(s.price, currency)}${assignedTo ? ` • đã ghép HP${assignedToIdx}` : ''}`}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className="font-mono font-bold text-xs">{s.code}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {SEAT_CLASS_LABELS[s.class] ?? s.class}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {formatCurrency(s.price, currency)}
                          </span>
                          {assignedTo && (
                            <span className="text-[10px] text-rose-500 ml-1 shrink-0">
                              • HP{assignedToIdx}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <FormMessage className="mt-1" />
            </FormItem>
          )}
        />
        {assignedSeat && (
          <Badge variant="outline" className="font-mono text-[10px] shrink-0 gap-1">
            {formatCurrency(assignedSeat.price, currency)}
          </Badge>
        )}
      </div>
    </div>
  )
}

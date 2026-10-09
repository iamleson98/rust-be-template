'use client'

import type { Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ComboboxField } from '@/components/ui/combobox'
import { FormField, FormControl, FormItem, FormMessage } from '@/components/ui/form'
import { SEAT_CLASS_LABELS } from '@/lib/labels'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { User, Trash2, Armchair } from 'lucide-react'
import {
  type BookingValues,
  type PassengerFormValue,
  type SelectedSeat,
  getPassengerType,
  PASSENGER_TYPE_META,
} from './booking-form'

/** One passenger: name, age, gender and the seat they take (seats taken by others are disabled). */
export function PassengerFormCard({
  index: i,
  passenger,
  passengers,
  seats,
  control,
  onRemove,
}: {
  index: number
  passenger: PassengerFormValue
  passengers: PassengerFormValue[]
  seats: SelectedSeat[]
  control: Control<BookingValues>
  /** Absent for the last remaining passenger. */
  onRemove?: () => void
}) {
  const t = useT()
  const money = useMoney()
  const typeMeta = PASSENGER_TYPE_META[getPassengerType(passenger.age)]
  const assignedSeat = seats.find((s) => s.id === passenger.seatId)
  return (
    <div
      className={`rounded-xl border-2 bg-linear-to-br ${typeMeta.gradient} ${typeMeta.border} p-3 space-y-2.5`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-7 w-7 rounded-full ${typeMeta.pill} inline-flex items-center justify-center text-xs font-bold shrink-0`}
          >
            {i + 1}
          </div>
          <span className="text-xs font-medium text-slate-700 shrink-0 hidden sm:inline">
            {t('booking.passenger', { n: i + 1 })}
          </span>
          <Badge className={`${typeMeta.pill} border-0 text-[10px] gap-1 shrink-0`}>
            {typeMeta.icon}
            {t(typeMeta.label)}
            {getPassengerType(passenger.age) === 'infant' && (
              <span className="opacity-70">{t('bookingFlow.infantFree')}</span>
            )}
          </Badge>
        </div>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 shrink-0"
            onClick={onRemove}
            aria-label={t('bookingFlow.removePassenger')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px_120px] gap-2 items-start">
        <FormField
          control={control}
          name={`passengers.${i}.name`}
          render={({ field }) => (
            <FormItem className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t('booking.passengerName')}
              </span>
              <div className="relative">
                <User className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t('bookingFlow.passengerNamePh')}
                    className="pl-8 bg-white"
                    aria-label={t('booking.passengerName')}
                  />
                </FormControl>
              </div>
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`passengers.${i}.age`}
          render={({ field }) => (
            <FormItem className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t('booking.passengerAge')}
              </span>
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
                  placeholder={t('booking.passengerAge')}
                  className="bg-white"
                  aria-label={t('booking.passengerAge')}
                />
              </FormControl>
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`passengers.${i}.gender`}
          render={({ field }) => (
            <FormItem className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                {t('bookingFlow.genderLabel')}
              </span>
              <FormControl>
                <ComboboxField
                  value={field.value}
                  onValueChange={field.onChange}
                  items={[
                    { value: 'male', label: t('bookingFlow.genderMale') },
                    { value: 'female', label: t('bookingFlow.genderFemale') },
                    { value: 'other', label: t('bookingFlow.genderOther') },
                  ]}
                  className="bg-white"
                  placeholder={t('bookingFlow.genderLabel')}
                  searchPlaceholder={t('combobox.search')}
                  aria-label={t('bookingFlow.genderLabel')}
                />
              </FormControl>
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />
      </div>

      <div className="flex items-center gap-2">
        <Armchair className="h-4 w-4 text-muted-foreground shrink-0" />
        <FormField
          control={control}
          name={`passengers.${i}.seatId`}
          render={({ field }) => (
            <FormItem className="flex-1 space-y-0">
              <FormControl>
                <ComboboxField
                  value={field.value}
                  onValueChange={field.onChange}
                  items={seats.map((s) => {
                    const assignedTo = passengers.find((pp, j) => pp.seatId === s.id && j !== i)
                    const assignedToIdx = assignedTo ? passengers.indexOf(assignedTo) + 1 : null
                    return {
                      value: s.id,
                      label: `${s.code} • ${t(SEAT_CLASS_LABELS[s.class] ?? s.class)} • ${money(s.price)}${
                        assignedTo
                          ? ` • ${t('bookingFlow.seatTakenBy', { index: assignedToIdx ?? 0 })}`
                          : ''
                      }`,
                      disabled: !!assignedTo,
                    }
                  })}
                  className="bg-white"
                  placeholder={t('bookingFlow.chooseSeatPh')}
                  searchPlaceholder={t('bookingFlow.searchSeatPh')}
                  aria-label={t('bookingFlow.passengerSeatAria')}
                />
              </FormControl>
              <FormMessage className="text-[11px]" />
            </FormItem>
          )}
        />
        {assignedSeat && (
          <Badge variant="outline" className="font-mono text-[10px] shrink-0 gap-1">
            {money(assignedSeat.price)}
          </Badge>
        )}
      </div>
    </div>
  )
}

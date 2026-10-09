import { MapPin } from 'lucide-react'
import type { BookingOut } from '@/api'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { SEAT_CLASS_LABELS } from '@/lib/labels'

type Stop = BookingOut['pickup']

/** Where the passengers get on and off. */
export function TicketStops({ pickup, dropoff }: { pickup: Stop; dropoff: Stop }) {
  const t = useT()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <StopTile label={t('bookingHistory.pickupPoint')} stop={pickup} tone="text-blue-600" />
      <StopTile label={t('bookingHistory.dropoffPoint')} stop={dropoff} tone="text-rose-600" />
    </div>
  )
}

function StopTile({ label, stop, tone }: { label: string; stop: Stop; tone: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <MapPin className={`h-3.5 w-3.5 ${tone}`} />
        {label}
      </div>
      <div className="text-sm font-semibold">{stop?.name ?? '—'}</div>
      {stop?.address && <div className="mt-0.5 text-xs text-muted-foreground">{stop.address}</div>}
    </div>
  )
}

/** One row per passenger: the seat number, class, who sits there and what they paid. */
export function TicketPassengers({ seats }: { seats: BookingOut['seats'] }) {
  const t = useT()
  const money = useMoney()
  return (
    <ul className="space-y-1.5">
      {seats.map((s, i) => (
        <li
          key={s.seatId ?? i}
          className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="inline-flex h-9 min-w-12 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 px-1.5 leading-none text-primary"
              title={t('bookingHistory.seatNumber')}
            >
              <span className="text-[9px] font-semibold uppercase">{t('bookingHistory.seat')}</span>
              <span className="font-mono text-sm font-bold">{s.seatCode ?? '—'}</span>
            </span>
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {s.passengerName || t('booking.passengers')}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {s.passengerType === 'child'
                  ? t('booking.passengerType.child')
                  : t('booking.passengerType.adult')}
                {s.passengerAge != null &&
                  s.passengerAge > 0 &&
                  t('bookingHistory.ageSuffix', { age: s.passengerAge })}
                {s.seatClass && ` • ${t(SEAT_CLASS_LABELS[s.seatClass] ?? s.seatClass)}`}
              </div>
            </div>
          </div>
          {s.price != null && <span className="shrink-0 font-bold">{money(s.price)}</span>}
        </li>
      ))}
    </ul>
  )
}

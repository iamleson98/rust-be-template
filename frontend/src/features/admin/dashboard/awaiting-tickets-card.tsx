'use client'

import { useState } from 'react'
import { CheckCircle2, PhoneCall, PhoneIncoming, RefreshCw } from 'lucide-react'
import type { BookingOut } from '@/api'
import { CountPill, Panel } from '@/components/console/panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdminBookings } from '@/features/admin/tickets/api'
import { BookingDetailDialog } from '@/features/admin/tickets/booking-detail-dialog'
import { useTicketStatus } from '@/features/admin/tickets/use-ticket-status'
import { formatDateVN, formatTimeVN, formatVND, relativeTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const FILTER = { status: 'awaiting', sort: 'created_asc', limit: 20, offset: 0 } as const

/**
 * Tickets customers just placed (pay on board), oldest first: staff phone the
 * customer, then confirm or cancel. Refreshes on its own so new ones show up.
 */
export function AwaitingTicketsCard() {
  const t = useT()
  const query = useAdminBookings(FILTER, { live: true })
  const status = useTicketStatus()
  const [openId, setOpenId] = useState<string | null>(null)
  const tickets = query.data?.items ?? []

  return (
    <Panel
      className={tickets.length > 0 ? 'ring-amber-300 dark:ring-amber-500/40' : undefined}
      icon={<PhoneIncoming className="text-amber-600" />}
      title={
        <span className="inline-flex items-center gap-2">
          {t('adminDash.awaitingTitle')}
          <CountPill n={query.data?.total ?? 0} tone="amber" />
        </span>
      }
      action={
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-slate-500"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
        >
          <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
        </Button>
      }
    >
      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : tickets.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('adminDash.awaitingEmpty')}
        </p>
      ) : (
        <ul className="divide-y">
          {tickets.map((ticket) => (
            <AwaitingRow
              key={ticket.id}
              ticket={ticket}
              busy={status.pending}
              onOpen={() => setOpenId(ticket.id)}
              onConfirm={() => status.set(ticket, 'confirmed', t('adminTickets.confirmedByCall'))}
            />
          ))}
        </ul>
      )}
      <BookingDetailDialog bookingId={openId} onClose={() => setOpenId(null)} />
    </Panel>
  )
}

function AwaitingRow({
  ticket,
  busy,
  onOpen,
  onConfirm,
}: {
  ticket: BookingOut
  busy: boolean
  onOpen: () => void
  onConfirm: () => void
}) {
  const t = useT()
  const trip = ticket.trip
  const details = trip
    ? [
        `${trip.fromName} → ${trip.toName}`,
        `${formatDateVN(trip.departureAt ?? trip.departureDate)} ${
          trip.departureAt ? formatTimeVN(trip.departureAt) : trip.departureTime
        }`,
        t('adminDash.seatsList', { seats: ticket.seats.map((s) => s.seatCode ?? '—').join(', ') }),
      ]
    : []
  return (
    <li className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline gap-2">
          <code className="font-mono text-sm font-bold text-primary">{ticket.code}</code>
          <span className="ml-auto shrink-0 text-xs text-slate-400 sm:ml-0">
            {relativeTime(ticket.createdAt)}
          </span>
        </div>
        <div className="mt-1 truncate text-sm">
          <span className="font-semibold text-slate-900">{ticket.contactName ?? '—'}</span>{' '}
          <span className="text-slate-500 tabular-nums">{ticket.contactPhone}</span>
        </div>
        {trip && (
          <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
            {details.join(' · ')} ·{' '}
            <span className="font-semibold text-slate-900">{formatVND(ticket.total)}</span>
          </div>
        )}
      </button>
      <div className={cn('grid shrink-0 gap-2 sm:flex', ticket.contactPhone && 'grid-cols-2')}>
        {ticket.contactPhone && (
          <Button asChild variant="outline" className="h-9 gap-1.5 rounded-lg">
            <a href={`tel:${ticket.contactPhone}`}>
              <PhoneCall className="size-4" />
              {t('adminTickets.callCustomer')}
            </a>
          </Button>
        )}
        <Button className="h-9 gap-1.5 rounded-lg" disabled={busy} onClick={onConfirm}>
          <CheckCircle2 className="size-4" />
          {t('adminTickets.confirmAfterCall')}
        </Button>
      </div>
    </li>
  )
}

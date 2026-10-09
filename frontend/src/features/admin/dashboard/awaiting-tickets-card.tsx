'use client'

import { useState } from 'react'
import { ArrowRight, CheckCircle2, PhoneCall, PhoneIncoming, RefreshCw } from 'lucide-react'
import type { BookingOut } from '@/api'
import { CountPill, Panel } from '@/components/console/panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdminBookings } from '@/features/admin/tickets/api'
import { BookingDetailDialog } from '@/features/admin/tickets/booking-detail-dialog'
import { useTicketStatus } from '@/features/admin/tickets/use-ticket-status'
import { formatDateVN, formatTimeVN, formatVND, relativeTime } from '@/lib/format'
import { useT } from '@/lib/i18n'

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
      className={tickets.length > 0 ? 'border-amber-300 dark:border-amber-500/40' : undefined}
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
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`size-3.5 ${query.isFetching ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
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
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="font-mono font-bold text-blue-700">{ticket.code}</code>
          <span className="font-semibold">{ticket.contactName ?? '—'}</span>
          <span className="font-mono text-muted-foreground">{ticket.contactPhone}</span>
        </div>
        {trip && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              {trip.fromName} <ArrowRight className="h-3 w-3" /> {trip.toName}
            </span>
            <span>
              {formatDateVN(trip.departureAt ?? trip.departureDate)}{' '}
              {trip.departureAt ? formatTimeVN(trip.departureAt) : trip.departureTime}
            </span>
            <span>
              {t('adminDash.seatsList', {
                seats: ticket.seats.map((s) => s.seatCode ?? '—').join(', '),
              })}
            </span>
            <span className="font-semibold text-foreground">{formatVND(ticket.total)}</span>
            <span>· {relativeTime(ticket.createdAt)}</span>
          </div>
        )}
      </button>
      <div className="flex shrink-0 gap-1.5">
        {ticket.contactPhone && (
          <Button asChild size="sm" variant="outline" className="h-8 gap-1">
            <a href={`tel:${ticket.contactPhone}`}>
              <PhoneCall className="h-3.5 w-3.5" />
              {t('adminTickets.callCustomer')}
            </a>
          </Button>
        )}
        <Button size="sm" className="h-8 gap-1" disabled={busy} onClick={onConfirm}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t('adminTickets.confirmAfterCall')}
        </Button>
      </div>
    </li>
  )
}

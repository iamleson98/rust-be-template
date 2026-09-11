'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Ticket as TicketIcon,
  Bus,
  MapPin,
  Armchair,
  User as UserIcon,
} from 'lucide-react'
import type { AdminChatMessage as ChatMessage } from '@/features/admin/dashboard/types'
import { BookingStatusBadge } from '@/features/admin/dashboard/booking-status-badge'
import type { CreatedTicketPayload } from '@/features/admin/tickets/chat-ticket-picker'

export function parseTicketPayload(m: ChatMessage): CreatedTicketPayload | null {
  // Prefer the `attachments` field (canonical).
  if (m.attachments) {
    try {
      const parsed = JSON.parse(m.attachments)
      if (parsed && parsed.bookingCode) return parsed as CreatedTicketPayload
    } catch {
      /* fall through */
    }
  }
  // Fallback: `kind === 'ticket'` + content is JSON.
  if (m.kind === 'ticket' && m.content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(m.content)
      if (parsed && parsed.bookingCode) return parsed as CreatedTicketPayload
    } catch {
      /* fall through */
    }
  }
  return null
}

/** Render a beautiful booking-card message inside the chat scroll area. */
export function TicketCardMessage({
  payload,
  isEmployee,
  onView,
}: {
  payload: CreatedTicketPayload
  isEmployee: boolean
  onView?: (bookingCode: string) => void
}) {
  const total = payload.totalAmount ?? 0
  const seats = payload.seats ?? []
  const trip = payload.trip ?? ({} as CreatedTicketPayload['trip'])
  return (
    <div className={`flex ${isEmployee ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[88%] sm:max-w-[75%] rounded-2xl overflow-hidden border bg-white">
        {/* Header strip with brand accent */}
        <div
          className="px-3 py-2 text-white flex items-center justify-between gap-2"
          style={{
            background: trip?.brandAccent
              ? `linear-gradient(135deg, ${trip.brandAccent}, ${trip.brandAccent}cc)`
              : 'linear-gradient(135deg, #2563eb, #0ea5e9)',
          }}
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <TicketIcon className="h-3.5 w-3.5" />
            Vé điện tử
          </div>
          {payload.status && <BookingStatusBadge status={payload.status} />}
        </div>

        {/* Body */}
        <div className="p-3 space-y-2">
          {/* Booking code */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Mã vé</div>
              <div className="font-mono font-bold text-blue-700 text-sm">
                {payload.bookingCode || '—'}
              </div>
            </div>
            {payload.bookingCode && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1"
                onClick={() => onView?.(payload.bookingCode)}
              >
                Xem chi tiết
              </Button>
            )}
          </div>

          {/* Route */}
          {(trip?.fromName || trip?.toName || trip?.brandName) && (
            <div className="rounded-md bg-slate-50 p-2 text-xs">
              {trip?.brandName && (
                <div className="flex items-center gap-1.5 font-semibold">
                  <Bus className="h-3.5 w-3.5 text-muted-foreground" />
                  {trip.brandName}
                </div>
              )}
              {(trip?.fromName || trip?.toName) && (
                <div className="mt-1 flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-blue-600" />
                  <span className="font-medium">
                    {trip?.fromName ?? '—'} → {trip?.toName ?? '—'}
                  </span>
                </div>
              )}
              {trip?.departureDate && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Khởi hành: {trip.departureDate}
                  {trip?.departureAt
                    ? ` · ${String(trip.departureAt).slice(11, 16)}`
                    : ''}
                </div>
              )}
            </div>
          )}

          {/* Seats */}
          {seats.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {seats.map((s, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-[10px] font-mono bg-white gap-1"
                >
                  <Armchair className="h-2.5 w-2.5" />
                  {s.code}
                </Badge>
              ))}
            </div>
          )}

          {/* Contact */}
          {(payload.contactName || payload.contactPhone) && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
              <UserIcon className="h-3 w-3" />
              {payload.contactName ?? ''} {payload.contactPhone ? `· ${payload.contactPhone}` : ''}
            </div>
          )}

          {/* Total */}
          {total > 0 && (
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-xs text-muted-foreground">Tổng tiền</span>
              <span className="font-bold text-blue-700">
                {new Intl.NumberFormat('vi-VN').format(total)}₫
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

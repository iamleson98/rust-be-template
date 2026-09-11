'use client'

import { memo } from 'react'
import type { AdminChatMessage as ChatMessage } from '@/features/admin/dashboard/types'
import { formatMessageTime } from './chat-helpers'
import { parseTicketPayload, TicketCardMessage } from './ticket-card-message'

/**
 * One chat message row — memoized so that typing in the reply input
 * (or any unrelated panel re-render) doesn't re-render the whole
 * message history.
 *
 * ## Virtual scrolling
 *
 * Each row sets `content-visibility: auto` +
 * `contain-intrinsic-size: auto 72px` — the browser skips layout +
 * paint for off-screen rows entirely while keeping them in the DOM.
 * This is native rendering-level virtual scrolling: it works with
 * dynamic message heights (long messages, ticket cards), preserves
 * scroll anchoring when prepending older pages, and needs zero JS
 * measurement — the right trade-off for a chat log inside ScrollArea
 * (a JS virtualizer with dynamic heights + bidirectional anchoring
 * would be far riskier for the same win).
 */
export const MessageRow = memo(function MessageRow({
  message,
  dayLabel,
  isLast,
  onViewTicket,
}: {
  message: ChatMessage
  /** Day-separator label to render above this row (null = none). */
  dayLabel: string | null
  isLast: boolean
  onViewTicket?: (bookingCode: string) => void
}) {
  const isEmployee = message.senderType === 'employee'
  const ticketPayload = parseTicketPayload(message)
  const time = formatMessageTime(message.createdAt)
  // Timestamp color adapts to the bubble style (legible on each).
  const timeClass = isEmployee
    ? 'text-blue-100/80 text-right'
    : message.senderType === 'system'
      ? 'text-amber-600/80 text-center'
      : message.senderType === 'assistant'
        ? 'text-violet-400'
        : 'text-slate-400'

  return (
    <>
      {dayLabel && (
        <div className="flex items-center justify-center py-1.5">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {dayLabel}
          </span>
        </div>
      )}
      <div
        style={{
          // Browser-native virtual scrolling (see component doc).
          // The intrinsic-size hint (72px) keeps the scrollbar
          // estimated for far-off-screen rows.
          contentVisibility: 'auto',
          containIntrinsicSize: 'auto 72px',
        }}
        className={`flex animate-in fade-in slide-in-from-bottom-1 duration-200 ${isEmployee ? 'justify-end' : 'justify-start'}`}
      >
        {ticketPayload ? (
          <div className="max-w-[88%] sm:max-w-[75%] space-y-0.5">
            <TicketCardMessage
              payload={ticketPayload}
              isEmployee={isEmployee}
              onView={onViewTicket}
            />
            {time && (
              <div className={`text-[10px] text-slate-400 ${isEmployee ? 'text-right' : 'text-left'}`}>{time}</div>
            )}
          </div>
        ) : (
          <div
            className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm wrap-break-word ${isEmployee
              ? 'bg-blue-600 text-white rounded-br-sm'
              : message.senderType === 'system'
                ? 'bg-amber-50 text-amber-800 text-center text-xs border border-amber-100 mx-auto rounded-lg'
                : message.senderType === 'assistant'
                  ? 'bg-violet-50 text-violet-900 border border-violet-100 rounded-bl-sm'
                  : 'bg-white border rounded-bl-sm '
              }`}
          >
            {message.content}
            {time && <div className={`mt-0.5 text-[10px] ${timeClass}`}>{time}</div>}
          </div>
        )}
      </div>
      {/* Accessibility: the last message's timestamp doubles as the
          live region's data anchor (screen readers announce changes). */}
      {isLast && <span className="sr-only" aria-live="polite">{time}</span>}
    </>
  )
})

import { memo } from 'react'
import type { ChatMessageOut } from '@/api'
import { messageTime } from '@/features/chat/format'
import { parseTicketPayload, TicketCardMessage } from './ticket-card-message'

const TIME_CLASS: Record<string, string> = {
  employee: 'text-blue-100/80 text-right',
  system: 'text-amber-600/80 text-center',
  assistant: 'text-violet-400',
}

const BUBBLE_CLASS: Record<string, string> = {
  employee: 'bg-blue-600 text-white rounded-br-sm',
  system: 'bg-amber-50 text-amber-800 text-center text-xs border border-amber-100 mx-auto rounded-lg',
  assistant: 'bg-violet-50 text-violet-900 border border-violet-100 rounded-bl-sm',
}

type Props = {
  message: ChatMessageOut
  /** Heading for the day this message starts, if any. */
  dayLabel: string | null
  isLast: boolean
  onViewTicket?: (bookingCode: string) => void
}

/**
 * One message. Memoised so typing in the composer does not re-render the history, and
 * `content-visibility: auto` lets the browser skip layout and paint for rows far off
 * screen (it copes with variable heights and keeps the scroll anchor, unlike a JS virtualiser).
 */
export const MessageRow = memo(function MessageRow({ message, dayLabel, isLast, onViewTicket }: Props) {
  const isEmployee = message.senderType === 'employee'
  const ticket = parseTicketPayload(message)
  const time = messageTime(message.createdAt)

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
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 72px' }}
        className={`flex animate-in fade-in slide-in-from-bottom-1 duration-200 ${isEmployee ? 'justify-end' : 'justify-start'}`}
      >
        {ticket ? (
          <div className="max-w-[88%] sm:max-w-[75%] space-y-0.5">
            <TicketCardMessage payload={ticket} isEmployee={isEmployee} onView={onViewTicket} />
            {time && (
              <div className={`text-[10px] text-slate-400 ${isEmployee ? 'text-right' : 'text-left'}`}>
                {time}
              </div>
            )}
          </div>
        ) : (
          <div
            className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm wrap-break-word ${
              BUBBLE_CLASS[message.senderType] ?? 'bg-white border rounded-bl-sm '
            }`}
          >
            {message.content}
            {time && (
              <div className={`mt-0.5 text-[10px] ${TIME_CLASS[message.senderType] ?? 'text-slate-400'}`}>
                {time}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Screen readers announce the newest message's timestamp as it changes. */}
      {isLast && (
        <span className="sr-only" aria-live="polite">
          {time}
        </span>
      )}
    </>
  )
})

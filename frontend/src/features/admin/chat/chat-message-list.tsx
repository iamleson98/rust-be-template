'use client'

import type { RefObject } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AdminChannel as Channel, AdminChatMessage as ChatMessage } from '@/features/admin/dashboard/types'
import { daySeparatorLabel, PANES_HEIGHT } from './chat-helpers'
import { MessageRow } from './message-row'

/**
 * Chat messages scroll area.
 * At xl it fills the space between the chat header + the
 * input (the card has a definite height from the grid row,
 * so `flex-1` can never grow it beyond the row — that was
 * the "chat box much larger than the channel list" bug:
 * `flex-1` inside an auto-height card made the card as
 * tall as the whole history). At base (stacked cards) it
 * falls back to the fixed `h-[32rem]`.
 * The `ref` is used by the panel's auto-scroll effect to
 * scroll to the bottom on new messages + typing events.
 */
export function ChatMessageList({
  chatScrollRef,
  chatMessages,
  messagesLoading,
  isFetchingMoreMessages,
  hasMoreMessages,
  onFetchMoreMessages,
  activeChannel,
  typingUser,
  onViewTicket,
}: {
  chatScrollRef: RefObject<HTMLDivElement | null>
  chatMessages: ChatMessage[]
  /** True while the FIRST page of messages for the open channel is
   *  in flight (TanStack `isLoading` — no data yet). */
  messagesLoading?: boolean
  /** Whether we're currently fetching the next page of older messages. */
  isFetchingMoreMessages?: boolean
  /** Whether there are more older messages to load (infinite scroll). */
  hasMoreMessages?: boolean
  /** Call this when the user scrolls to the top of the chat. */
  onFetchMoreMessages?: () => void
  activeChannel: Channel | null
  /** Typing indicator from the user — null when not typing. */
  typingUser?: { name: string } | null
  onViewTicket?: (bookingCode: string) => void
}) {
  return (
    <ScrollArea ref={chatScrollRef} className={`${PANES_HEIGHT} xl:h-auto xl:flex-1 xl:min-h-0 p-4`}>
      <div className="space-y-2.5">
        {/* ── "Load more" spinner (top of chat) ─────────────────
            Shown when the infinite-scroll hook is fetching the
            next page of older messages. Also serves as a
            visual anchor so the user knows more are coming.
            The scroll-position-preservation logic in the panel keeps
            the user's view stable when the new messages are
            prepended. */}
        {isFetchingMoreMessages && (
          <div className="flex items-center justify-center py-3">
            <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
              Đang tải tin nhắn cũ hơn...
            </div>
          </div>
        )}
        {!isFetchingMoreMessages && hasMoreMessages && onFetchMoreMessages && (
          <div className="flex items-center justify-center py-2">
            <button
              onClick={onFetchMoreMessages}
              className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
            >
              Xem tin nhắn cũ hơn
            </button>
          </div>
        )}
        {/* ── Message rows ─────────────────────────────────────
            Memoized `MessageRow` (virtualized via
            content-visibility, timestamped, day-separated).
            Typing in the reply input no longer re-renders
            the whole history — only the rows whose props
            actually change re-render. */}
        {chatMessages.map((m, i) => (
          <MessageRow
            key={m.id}
            message={m}
            dayLabel={daySeparatorLabel(chatMessages[i - 1]?.createdAt, m.createdAt)}
            isLast={i === chatMessages.length - 1}
            onViewTicket={onViewTicket}
          />
        ))}

        {/* ── First-load spinner / empty state ───────────────
            `messagesLoading` = the first page is in flight
            (TanStack `isLoading` — no data yet). The empty
            state shows when a channel is open, nothing is
            loading, and the history is genuinely empty. */}
        {messagesLoading && (
          <div className="flex items-center justify-center py-10">
            <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
              Đang tải tin nhắn...
            </div>
          </div>
        )}
        {!messagesLoading && activeChannel && chatMessages.length === 0 && (
          <div className="py-10 text-center text-xs text-muted-foreground">
            Chưa có tin nhắn — hãy gửi câu trả lời đầu tiên.
          </div>
        )}
      </div>

      {typingUser && (
        <div className="flex justify-start pb-2 px-1 mt-2">
          <div className="bg-white border rounded-2xl rounded-bl-sm px-3 py-2.5">
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}
    </ScrollArea>
  )
}

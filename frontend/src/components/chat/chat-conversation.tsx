'use client'

/**
 * ChatConversation — the conversation view of the customer-facing chat
 * widget.
 *
 * Extracted from the original `chat-widget.tsx`. Renders:
 *   - A "secured conversation" header pill
 *   - The waiting-for-agent banner (when no employee is online)
 *   - The agent-joined banner (when an employee has joined the channel)
 *   - The message list (bubbles aligned by sender, with read receipts)
 *   - The typing indicator
 *   - A "Load more" spinner at the top (infinite scroll)
 *
 * The view does NOT own the input bar — that's `<ChatInput />` so the
 * parent can decide when to show the quick-action chips (only on the
 * first message). The parent passes `scrollRef` so it can auto-scroll
 * on new messages.
 *
 * ## Infinite scroll
 *
 * When the user scrolls to the top of the messages area, the
 * `onFetchMoreMessages` callback is fired to load older messages.
 * Scroll position is preserved (the user sees the same message they
 * were viewing) via a `useLayoutEffect` that measures the scroll
 * height before + after the DOM update.
 *
 * ## Auto-scroll to bottom
 *
 * When a new message arrives OR the typing indicator appears, the
 * view auto-scrolls to the bottom — but only if the user was already
 * at (or near) the bottom. If the user has scrolled up to read older
 * messages, we DON'T yank them down.
 */

import type React from 'react'
import { useRef, useEffect, useLayoutEffect } from 'react'
import { Loader2, Check, CheckCheck, Sparkles, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Message } from './_shared'

/** Distance from the bottom (in px) within which we consider the user "at the bottom". */
const BOTTOM_THRESHOLD = 80

export function ChatConversation({
  scrollRef,
  loadingMessages,
  messages,
  typing,
  waitingForAgent,
  agentJoinedName,
  employeesOnline,
  hasMoreMessages,
  isFetchingMoreMessages,
  onFetchMoreMessages,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  loadingMessages: boolean
  messages: Message[]
  typing: { name: string } | null
  waitingForAgent: boolean
  agentJoinedName: string | null
  employeesOnline: number
  /** Whether there are more older messages to load (infinite scroll). */
  hasMoreMessages?: boolean
  /** Whether we're currently fetching the next page of older messages. */
  isFetchingMoreMessages?: boolean
  /** Call this when the user scrolls to the top of the messages area. */
  onFetchMoreMessages?: () => void
}) {
  // ── Scroll behavior: infinite scroll + auto-scroll + position preservation ─
  //
  // The parent passes `scrollRef` (attached to the messages container)
  // so it can call `scrollTop = scrollHeight` on new messages. We add
  // the infinite-scroll detection + scroll-position-preservation
  // logic here via internal refs.
  //
  // `isAtBottomRef` tracks whether the user is at the bottom — set on
  // every scroll event. Used by the auto-scroll effect to decide
  // whether to yank the user down to a new message.
  const isAtBottomRef = useRef(true)

  // Track previous messages length + scroll height to detect prepend
  // vs append + preserve scroll position on prepend.
  const prevMessagesLenRef = useRef(0)
  const prevScrollHeightRef = useRef(0)

  // ── Scroll listener: track bottom position + trigger infinite scroll ─
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      isAtBottomRef.current = distanceFromBottom <= BOTTOM_THRESHOLD

      // ── Infinite scroll trigger ─────────────────────────────────
      // When the user scrolls to the top (within 80px), fetch more
      // older messages. The `hasMoreMessages` + `isFetchingMoreMessages`
      // guards prevent duplicate fetches.
      if (
        el.scrollTop <= BOTTOM_THRESHOLD &&
        hasMoreMessages &&
        !isFetchingMoreMessages &&
        onFetchMoreMessages
      ) {
        onFetchMoreMessages()
      }
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [scrollRef, hasMoreMessages, isFetchingMoreMessages, onFetchMoreMessages])

  // ── Auto-scroll + scroll-position preservation ───────────────────
  //
  // Runs after every render where `messages.length` or `typing`
  // changed. Handles three cases:
  //   1. Append (new message at the bottom) — auto-scroll only if at bottom.
  //   2. Initial load — scroll to the bottom.
  //   3. Prepend (older messages added at the top) — preserve scroll position
  //      by adding the new content's height to scrollTop.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const prevLen = prevMessagesLenRef.current
    const newLen = messages.length
    const delta = newLen - prevLen

    if (delta === 0) {
      // No messages change — but the typing indicator may have
      // appeared/disappeared. Auto-scroll to bottom if at bottom.
      if (isAtBottomRef.current && typing) {
        el.scrollTop = el.scrollHeight
      }
      return
    }

    if (delta > 0 && prevLen > 0) {
      // ── Append (new message at the bottom) ─────────────────────
      // Only auto-scroll if the user was at the bottom.
      if (isAtBottomRef.current) {
        el.scrollTop = el.scrollHeight
      }
    } else if (delta > 0 && prevLen === 0) {
      // ── Initial load ───────────────────────────────────────────
      el.scrollTop = el.scrollHeight
      isAtBottomRef.current = true
    } else if (delta < 0) {
      // ── Prepend (older messages added at the top) ───────────────
      // The DOM grew at the top by `|delta|` messages. Preserve the
      // user's scroll position by adding the new content's height
      // to scrollTop.
      const newScrollHeight = el.scrollHeight
      const addedHeight = newScrollHeight - prevScrollHeightRef.current
      el.scrollTop = el.scrollTop + addedHeight
    }

    prevMessagesLenRef.current = newLen
    prevScrollHeightRef.current = el.scrollHeight
  }, [messages, typing, scrollRef])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 bg-linear-to-b from-slate-50 to-white max-h-120"
      >
        {loadingMessages ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="text-center py-2">
              <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-[10px] text-emerald-700 ring-1 ring-emerald-200">
                <Sparkles className="inline h-2.5 w-2.5 mr-1" />
                Nhân viên luôn sẵn sàng • Phản hồi tức thì
              </span>
            </div>

            {/* ── "Load more" spinner (top of chat) ──────────────────────
                Shown when the infinite-scroll hook is fetching the next
                page of older messages. Also serves as a visual anchor
                so the user knows more are coming. */}
            {isFetchingMoreMessages && (
              <div className="flex items-center justify-center py-3">
                <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] text-muted-foreground">
                  <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                  Đang tải tin nhắn cũ hơn...
                </div>
              </div>
            )}
            {!isFetchingMoreMessages && hasMoreMessages && onFetchMoreMessages && (
              <div className="flex items-center justify-center py-2">
                <button
                  onClick={onFetchMoreMessages}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
                >
                  <ChevronUp className="h-3 w-3" />
                  Xem tin nhắn cũ hơn
                </button>
              </div>
            )}

            {waitingForAgent && (
              <div className="flex justify-center py-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Đang chuyển tới nhân viên hỗ trợ...</span>
                </div>
              </div>
            )}

            {/* {!waitingForAgent && agentJoinedName && employeesOnline > 0 && (
              <div className="flex justify-center py-2">
                <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs text-blue-800">
                  <Users className="h-3 w-3" />
                  <span>
                    Nhân viên <strong>{agentJoinedName}</strong> đã tham gia
                  </span>
                </div>
              </div>
            )} */}

            {messages.map((m, i) => {
              const isMe = m.senderType === 'user'
              const isSystem = m.senderType === 'system'
              const isAssistant = m.senderType === 'assistant'
              const showName =
                !isMe && !isSystem && (i === 0 || messages[i - 1].senderType !== m.senderType)
              return (
                <div key={m.id} className={cn('flex animate-in fade-in slide-in-from-bottom-1 duration-200', isMe ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[78%]', isSystem && 'mx-auto')}>
                    {showName && (
                      <div className="text-[10px] text-muted-foreground mb-0.5 px-1 flex items-center gap-1">
                        {isAssistant && <Sparkles className="h-2.5 w-2.5 text-violet-500" />}
                        {m.senderName}
                      </div>
                    )}
                    <div
                      className={cn(
                        'rounded-2xl px-3 py-2 text-sm wrap-break-word shadow-sm',
                        isSystem
                          ? 'bg-amber-50 text-amber-800 text-center text-xs border border-amber-100'
                          : isMe
                            ? 'bg-rose-600 text-white rounded-br-sm'
                            : isAssistant
                              ? 'bg-violet-50 border border-violet-200 text-slate-800 rounded-bl-sm'
                              : 'bg-white border rounded-bl-sm',
                      )}
                    >
                      {m.content}
                    </div>
                    {isMe && (
                      <div className="text-[9px] text-muted-foreground mt-0.5 px-1 text-right flex items-center justify-end gap-0.5">
                        {m.id.startsWith('tmp-') ? (
                          <Check className="h-2.5 w-2.5" />
                        ) : (
                          <CheckCheck className="h-2.5 w-2.5 text-rose-500" />
                        )}
                        {new Date(m.createdAt).toLocaleTimeString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {typing && (
              <div className="flex justify-start">
                <div className="bg-white border rounded-2xl rounded-bl-sm px-3 py-2.5 shadow-sm">
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

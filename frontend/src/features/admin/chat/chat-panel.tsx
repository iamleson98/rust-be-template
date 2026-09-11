'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Headset, Send } from 'lucide-react'
import type { AdminChannel as Channel, AdminChatMessage as ChatMessage } from '@/features/admin/dashboard/types'
import {
  ChatTicketPicker,
  type CreatedTicketPayload,
} from '@/features/admin/tickets/chat-ticket-picker'
import { PANES_HEIGHT } from './chat-helpers'
import { ChatStatsCards } from './chat-stats-cards'
import { ChatChannelListCard } from './chat-channel-list-card'
import { ChatWorkspaceHeader } from './chat-workspace-header'
import { ChatMessageList } from './chat-message-list'

export function ChatPanel({
  channels,
  activeChannel,
  chatMessages,
  replyText,
  sending,
  onOpenChannel,
  onSendReply,
  onBlockChannel,
  onSetReplyText,
  onSendTicketCard,
  onViewTicket,
  typingUser,
  userOnline,
  unreadPulseChannels,
  hasMoreMessages,
  isFetchingMoreMessages,
  onFetchMoreMessages,
  chatStats,
  staffPresence,
  mineFilter,
  onToggleMineFilter,
  onClaim,
  onRelease,
  onCloseChannel,
  assignmentBusy,
  allChannelsCount,
  canRelease,
  channelsLoading,
  messagesLoading,
  hasMoreChannels,
  isFetchingMoreChannels,
  onFetchMoreChannels,
}: {
  channels: Channel[]
  activeChannel: Channel | null
  chatMessages: ChatMessage[]
  replyText: string
  sending: boolean
  onOpenChannel: (c: Channel) => void
  onSendReply: () => void
  onBlockChannel: (channelId: string) => void
  onSetReplyText: (v: string) => void
  onSendTicketCard?: (payload: CreatedTicketPayload) => void
  onViewTicket?: (bookingCode: string) => void
  /** Typing indicator from the user — null when not typing. */
  typingUser?: { name: string } | null
  /** Whether the user in the active channel is online. */
  userOnline?: boolean
  /**
   * Set of channel ids that have received a new customer message while
   * the admin was NOT viewing them. The channel row shows a pulsing
   * blue dot until the admin opens that channel.
   */
  unreadPulseChannels?: Set<string>
  /** Whether there are more older messages to load (infinite scroll). */
  hasMoreMessages?: boolean
  /** True while the FIRST page of messages for the open channel is
   *  in flight (TanStack `isLoading` — no data yet). */
  messagesLoading?: boolean
  /** Whether we're currently fetching the next page of older messages. */
  isFetchingMoreMessages?: boolean
  /** Call this when the user scrolls to the top of the chat. */
  onFetchMoreMessages?: () => void
  /** Whether there are more channels to load (channel-list infinite
   *  scroll — the initial page shows the most recently active
   *  channels; scrolling DOWN appends older ones). */
  hasMoreChannels?: boolean
  /** Whether we're currently fetching the next page of channels. */
  isFetchingMoreChannels?: boolean
  /** Call this when the user scrolls to the bottom of the channel list. */
  onFetchMoreChannels?: () => void
  /** Aggregate chat stats from GET /api/admin/chat/stats — drives the
   *  top-row cards (open / assigned / closed counts + avg response
   *  time). When undefined, the cards fall back to client-side
   *  filtering of `channels` (capped at the list's page size). */
  chatStats?: {
    openCount: number
    assignedCount: number
    closedCount: number
    totalChannels: number
    avgResponseTimeSecs: number
  }
  /** Live staff presence (WS `staff_presence` broadcasts). */
  staffPresence?: {
    staff: {
      userId: string
      name: string
      role: string
      online: boolean
      available: boolean
      busy: boolean
      inCall: boolean
      activeChats: number
      lastSeenAt?: string | null
    }[]
    offline?: {
      userId: string
      name: string
      role: string
      lastSeenAt: string
      lastOnlineAt?: string | null
    }[]
    onlineCount: number
    availableCount: number
    botActive: boolean
  } | null
  /** "My channels" filter toggle (employee workspace). */
  mineFilter?: boolean
  onToggleMineFilter?: (v: boolean) => void
  /** Assignment actions on the active channel. */
  onClaim?: () => void
  onRelease?: () => void
  onCloseChannel?: () => void
  assignmentBusy?: boolean
  /** Unfiltered channel count (shown when the mine filter hides rows). */
  allChannelsCount?: number
  /**
   * Per the product spec, employees CANNOT leave an assigned channel —
   * only admins may reassign/release. The backend rejects employee
   * releases with 403; this flag hides the button entirely for
   * employees so the UI never offers an action that would fail.
   */
  canRelease?: boolean
  /** While the channels query loads: the queue + the stat cards show
   * structure-matched skeletons instead of empty/zero values. */
  channelsLoading?: boolean
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  // ── Channel-list infinite scroll (scroll DOWN = load more) ────
  //
  // The channel list's initial page shows the most recently active
  // channels; when the staff scrolls near the bottom, fetch the next
  // page of older channels + append. Same viewport-querySelector
  // technique as the chat pane's scroll handling (the ScrollArea
  // primitive doesn't expose its viewport ref directly).
  const channelScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = channelScrollRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      if (
        distanceFromBottom <= 120 &&
        hasMoreChannels &&
        !isFetchingMoreChannels &&
        onFetchMoreChannels
      ) {
        onFetchMoreChannels()
      }
    }
    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [hasMoreChannels, isFetchingMoreChannels, onFetchMoreChannels])

  // ── Chat scroll behavior (auto-scroll + infinite scroll trigger) ─
  //
  // The ScrollArea primitive doesn't expose the viewport ref directly,
  // so we use a root ref + querySelector to find the viewport. This
  // ref is also used by the infinite-scroll sentinel below to detect
  // when the user has scrolled to the top.
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the bottom when a new message arrives OR the
  // typing indicator appears — but only if the user is already at
  // (or near) the bottom. If they've scrolled up to read older
  // messages, we DON'T yank them down.
  const isAtBottomRef = useRef(true)
  useEffect(() => {
    const root = chatScrollRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return

    // Track whether the user is at the bottom on every scroll.
    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      isAtBottomRef.current = distanceFromBottom <= 80
    }
    viewport.addEventListener('scroll', handleScroll, { passive: true })

    // ── Infinite scroll trigger ─────────────────────────────────
    // When the user scrolls to the top (scrollTop <= 80px), fetch
    // the next page of older messages. We use a separate scroll
    // listener (not IntersectionObserver) because the ScrollArea's
    // viewport is the scroll container, not the document.
    const handleInfiniteScroll = () => {
      if (viewport.scrollTop <= 80 && hasMoreMessages && !isFetchingMoreMessages && onFetchMoreMessages) {
        onFetchMoreMessages()
      }
    }
    viewport.addEventListener('scroll', handleInfiniteScroll, { passive: true })

    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      viewport.removeEventListener('scroll', handleInfiniteScroll)
    }
  }, [hasMoreMessages, isFetchingMoreMessages, onFetchMoreMessages])

  // ── Auto-scroll + scroll-anchor preservation ───────────────────
  //
  // Runs (pre-paint, in a layout effect) whenever the messages array
  // or the typing indicator changes. Distinguishes the three chat
  // scroll cases by the BOUNDARY MESSAGE IDS, not by length deltas —
  // both prepends (older page at the head) and appends (new message
  // at the tail) GROW the array, so `delta > 0` can't tell them apart:
  //
  //   1. Initial load (or channel switch) → jump to the newest message.
  //   2. PREPEND — first id changed, last id UNCHANGED: an older page
  //      was prepended at the head. The DOM grew ABOVE the viewport;
  //      keep the user's anchor (the message they were reading) by
  //      shifting scrollTop forward by the height the DOM grew.
  //      Without this the view visibly jumps (the classic infinite-
  //      scroll-up bug).
  //   3. APPEND — last id changed: a new message was saved to the DB
  //      and landed at the tail (sent or received). Auto-scroll to it
  //      ONLY if the user was already at/near the bottom — never yank
  //      someone down while they're reading history.
  //
  // All scroll writes happen before the browser paints (layout
  // effect), so no flicker is visible in any case.
  const prevScrollHeightRef = useRef(0)
  const prevFirstIdRef = useRef<string | null>(null)
  const prevLastIdRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    const root = chatScrollRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return

    const firstId = chatMessages[0]?.id ?? null
    const lastId = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1].id : null
    const prevFirst = prevFirstIdRef.current
    const prevLast = prevLastIdRef.current

    if (prevFirst == null || prevLast == null || firstId == null) {
      // ── Initial load / channel switch / cleared list ───────────
      viewport.scrollTop = viewport.scrollHeight
      isAtBottomRef.current = true
    } else if (firstId !== prevFirst && lastId === prevLast) {
      // ── Prepend (older messages at the head) ──────────────────
      // The DOM grew at the TOP by `addedHeight` px. The browser keeps
      // scrollTop numerically stable across content prepends, which
      // visually shifts the view FORWARD — compensate by moving
      // scrollTop down by the same amount so the user's anchor message
      // stays under their eyes.
      const addedHeight = viewport.scrollHeight - prevScrollHeightRef.current
      viewport.scrollTop = viewport.scrollTop + Math.max(addedHeight, 0)
    } else if (lastId !== prevLast) {
      // ── Append (new message at the tail) ───────────────────────
      // Only auto-scroll if the user was at (or near) the bottom. If
      // they had scrolled up to read older messages, leave them.
      if (isAtBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight
      }
    } else if (isAtBottomRef.current) {
      // No boundary change (identical refetch / typing indicator
      // toggled) — stay glued to the bottom if we were there.
      viewport.scrollTop = viewport.scrollHeight
    }

    prevFirstIdRef.current = firstId
    prevLastIdRef.current = lastId
    prevScrollHeightRef.current = viewport.scrollHeight
  }, [chatMessages, typingUser])

  // Compute card values from `chatStats` (server-side aggregate, accurate
  // even with > 200 channels) — fall back to client-side filtering of
  // `channels` when stats aren't loaded yet (capped at the list's page
  // size, but better than showing 0).
  const openCount = chatStats?.openCount ?? channels.filter((c) => c.status === 'open').length
  const assignedCount = chatStats?.assignedCount ?? channels.filter((c) => c.status === 'assigned').length
  const avgResponseSecs = chatStats?.avgResponseTimeSecs ?? 0

  return (
    <div className="space-y-4 p-3">
      <ChatStatsCards
        channelsLoading={channelsLoading}
        openCount={openCount}
        assignedCount={assignedCount}
        avgResponseSecs={avgResponseSecs}
      />

      {/* Chat queue + workspace split view.
          BOTH cards get the same definite height at xl — the chat box
          (+ its header + input) is capped to the same total height as
          the channel-list card, never growing with the message
          history. Each pane scrolls internally when content overflows.
          (Height must live on the CARDS, not on the grid container:
          an `auto` grid row still sizes to the items' content, so a
          container-only height would not stop the overflow.) */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Channel list */}
        <ChatChannelListCard
          channels={channels}
          activeChannel={activeChannel}
          channelsLoading={channelsLoading}
          hasMoreChannels={hasMoreChannels}
          isFetchingMoreChannels={isFetchingMoreChannels}
          onFetchMoreChannels={onFetchMoreChannels}
          onOpenChannel={onOpenChannel}
          unreadPulseChannels={unreadPulseChannels}
          allChannelsCount={allChannelsCount}
          mineFilter={mineFilter}
          onToggleMineFilter={onToggleMineFilter}
          staffPresence={staffPresence}
          channelScrollRef={channelScrollRef}
        />

        {/* Chat workspace */}
        <Card className="xl:col-span-3 flex flex-col xl:h-[40rem]">
          {activeChannel ? (
            <>
              <ChatWorkspaceHeader
                activeChannel={activeChannel}
                userOnline={userOnline}
                typingUser={typingUser}
                setPickerOpen={setPickerOpen}
                onClaim={onClaim}
                onRelease={onRelease}
                onCloseChannel={onCloseChannel}
                assignmentBusy={assignmentBusy}
                canRelease={canRelease}
                onBlockChannel={onBlockChannel}
              />
              <ChatMessageList
                chatScrollRef={chatScrollRef}
                chatMessages={chatMessages}
                messagesLoading={messagesLoading}
                isFetchingMoreMessages={isFetchingMoreMessages}
                hasMoreMessages={hasMoreMessages}
                onFetchMoreMessages={onFetchMoreMessages}
                activeChannel={activeChannel}
                typingUser={typingUser}
                onViewTicket={onViewTicket}
              />

              {/* Quick replies + input — sticks to the bottom because
                  the scroll area is `xl:flex-1` (takes remaining space). */}
              <div className="px-4 py-2 border-t bg-slate-50/50 shrink-0">
                <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
                  {['Xin chào, tôi có thể giúp gì?', 'Vui lòng cho mã đặt vé.', 'Chuyến đi đã xác nhận.', 'Tôi cần kiểm tra lại.'].map((t, i) => (
                    <button
                      key={i}
                      onClick={() => onSetReplyText(t)}
                      className="shrink-0 rounded-full px-2.5 py-1 text-[11px] border bg-white hover:bg-blue-50 hover:border-blue-300 transition-colors"
                    >
                      {t.length > 30 ? t.slice(0, 30) + '…' : t}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={replyText}
                    onChange={(e) => onSetReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendReply() } }}
                    placeholder="Nhập phản hồi..."
                    className="flex-1"
                  />
                  <Button
                    onClick={onSendReply}
                    disabled={!replyText.trim() || sending}
                    size="icon"
                    className="bg-blue-600 hover:bg-blue-700 shrink-0"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className={`${PANES_HEIGHT} xl:h-auto xl:flex-1 flex items-center justify-center p-8`}>
              <div className="text-center">
                <div className="inline-flex h-16 w-16 rounded-full bg-slate-100 items-center justify-center mb-4">
                  <Headset className="h-8 w-8 text-slate-400" />
                </div>
                <h3 className="font-semibold text-sm">Chọn cuộc trò chuyện</h3>
                <p className="text-xs text-muted-foreground mt-1">Chọn một kênh từ danh sách để bắt đầu phản hồi</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Ticket picker dialog — opened by the "Đặt vé cho khách" button. */}
      <ChatTicketPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        channel={activeChannel}
        onCreated={(payload) => {
          onSendTicketCard?.(payload)
        }}
      />
    </div>
  )
}

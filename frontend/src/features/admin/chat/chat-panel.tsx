'use client'

import { useState, useEffect, useLayoutEffect, useRef, memo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Headset,
  MessageSquare,
  Activity,
  Clock,
  Ban,
  Send,
  Ticket as TicketIcon,
  Bus,
  MapPin,
  Armchair,
  Phone,
  Mail,
  User as UserIcon,
  Hand,
  Undo2,
  CheckCircle2,
  Bot,
  Filter,
} from 'lucide-react'
import { relativeTime } from '@/lib/types'
import { AdminStatsCardsSkeleton } from '@/features/admin/dashboard/stats-cards-skeleton'
import { ChatChannelListSkeleton } from '@/features/admin/chat/chat-channel-list-skeleton'
import type { AdminChannel as Channel, AdminChatMessage as ChatMessage } from '@/features/admin/dashboard/types'
import { PriorityBadge, StatusBadge, BookingStatusBadge } from '@/features/admin/dashboard/badges'
import {
  ChatTicketPicker,
  type CreatedTicketPayload,
} from '@/features/admin/tickets/chat-ticket-picker'

/**
 * Pick the best customer-facing label for a channel row.
 *
 * Order of preference:
 *   1. `user.fullName` — set on signup, always present for real users.
 *   2. `user.email` — fallback when fullName is empty.
 *   3. `user.phone` — fallback when both fullName + email are empty.
 *   4. `topic` — the channel topic, e.g. "Hỗ trợ".
 *   5. `"Khách"` — generic Vietnamese for "Customer" (last-resort default).
 */
function customerDisplayName(channel: Channel): string {
  const u = channel.user
  if (u?.fullName && u.fullName.trim().length > 0) return u.fullName
  if (u?.email && u.email.trim().length > 0) return u.email
  if (u?.phone && u.phone.trim().length > 0) return u.phone
  if (channel.topic && channel.topic.trim().length > 0) return channel.topic
  return 'Khách'
}

/** First letter of the customer's display name (for the avatar fallback). */
function customerInitial(channel: Channel): string {
  const name = customerDisplayName(channel)
  return (name && name[0]?.toUpperCase()) || 'K'
}

/**
 * Build a subtitle line for the channel row — shows email or phone
 * (whichever is present + different from the display name). Empty
 * string when no extra info is available.
 */
function customerSubtitle(channel: Channel): string {
  const u = channel.user
  const name = customerDisplayName(channel)
  // Prefer phone (more actionable for support), then email.
  if (u?.phone && u.phone.trim().length > 0 && u.phone !== name) return u.phone
  if (u?.email && u.email.trim().length > 0 && u.email !== name) return u.email
  return ''
}

// ────────────────────────────────────────────────────────────────
//  Message rendering: timestamps + day separators + virtualization
// ────────────────────────────────────────────────────────────────

/** `HH:mm` (vi-VN, 24h) for a message timestamp. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

/** Day key (`YYYY-M-D` in local time) for day-boundary detection. */
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * Day-separator label ("Hôm nay" / "Hôm qua" / `dd/MM/yyyy`) shown
 * between messages from different calendar days.
 */
function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((today - that) / 86_400_000)
  if (diffDays === 0) return 'Hôm nay'
  if (diffDays === 1) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Decide whether a separator is needed before this message: when the
 * previous message (chronological) is from a different calendar day
 * (or there is no previous message). Returns the label, or null.
 */
function daySeparatorLabel(prevIso: string | null | undefined, iso: string): string | null {
  if (!iso) return null
  if (!prevIso || dayKey(prevIso) !== dayKey(iso)) return formatDayLabel(iso)
  return null
}

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
const MessageRow = memo(function MessageRow({
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

  // Aligned height for the channel list + chat workspace. Both panes
  // are capped so the split view looks symmetric + each pane scrolls
  // internally when content overflows.
  //
  // IMPORTANT: use `h-[32rem]` (fixed height), NOT `max-h-[32rem]`.
  // `max-h` on the ScrollArea root doesn't propagate to the Viewport
  // (which is `size-full` = height:100%) — the viewport would grow
  // with its content + never scroll. `h-[32rem]` forces the root to
  // a fixed height → the viewport constrains to that height →
  // overflow scrolls. This was the "channel list doesn't scroll
  // when overflow" bug.
  //
  // On base screens the two cards stack (grid-cols-1) + their heights
  // are indefinite (content-driven), so BOTH panes need the definite
  // `h-[32rem]`. At `xl` BOTH cards get the same definite height
  // (`xl:h-[40rem]` on each Card) — the panes then FILL their card's
  // remaining space (`xl:h-full` / `xl:flex-1 + xl:min-h-0`), which is
  // what keeps the chat box + its header capped to the same total
  // height as the channel-list card (Slack/Intercom-style symmetric
  // split view). A `flex-1` pane inside an INDEFINITE-height card
  // would instead grow the card to the FULL message history height —
  // the "chat box much larger than the channel list" bug — so
  // `flex-1` is xl-only, never at base. (The definite height must
  // live on the CARDS: an `auto` grid row still sizes to the items'
  // content, so a height on the grid container alone doesn't cap
  // anything.)
  const PANES_HEIGHT = 'h-[32rem]'

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

  // Format the avg response time as "Mm Ss" (e.g. "1m 42s") or "N/A"
  // when no channels have a response yet (avgResponseSecs === 0).
  const formatResponseTime = (secs: number): string => {
    if (secs <= 0) return 'N/A'
    const mins = Math.floor(secs / 60)
    const s = Math.round(secs % 60)
    if (mins > 0) return `${mins}m ${s}s`
    return `${s}s`
  }

  return (
    <div className="space-y-4 p-3">
      {/* Stat cards — skeleton while the channels load (never zero values) */}
      {channelsLoading ? (
        <AdminStatsCardsSkeleton count={3} />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Headset className="h-4 w-4 text-blue-600" /> Đang chờ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold">{openCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Cuộc trò chuyện chưa phân công</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-amber-600" /> Đang xử lý</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold">{assignedCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Đã có nhân viên phụ trách</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-rose-600" /> Thời gian phản hồi TB</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold">{formatResponseTime(avgResponseSecs)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Trung bình từ tin nhắn đầu tiên đến phản hồi
            </div>
          </CardContent>
        </Card>
      </div>
      )}

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
        <Card className="xl:col-span-2 flex flex-col xl:h-[40rem]">
          <CardHeader className="pb-2 shrink-0 space-y-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              Hàng đợi cuộc trò chuyện
              <span className="text-xs font-normal text-muted-foreground ml-auto">
                {channels.length}{allChannelsCount != null && allChannelsCount !== channels.length ? `/${allChannelsCount}` : ''} kênh
              </span>
              {onToggleMineFilter && (
                <Button
                  variant={mineFilter ? 'default' : 'outline'}
                  size="sm"
                  className={`h-7 gap-1 text-xs ${mineFilter ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                  onClick={() => onToggleMineFilter(!mineFilter)}
                  title="Chỉ hiện kênh của tôi + kênh chưa phân công"
                >
                  <Filter className="h-3 w-3" />
                  Của tôi
                </Button>
              )}
            </CardTitle>
            {/* Staff presence strip — live availability (WS pushes).
                Employees + admins with online/busy/available state;
                recently-offline staff render dimmed with a durable
                "last seen" (DB backstop); the bot chip shows when nobody
                is online. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {staffPresence ? (
                <>
                  {staffPresence.staff.map((st) => (
                    <span
                      key={st.userId}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${!st.online
                          ? 'border-slate-200 bg-slate-50 text-slate-400'
                          : st.busy
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        }`}
                      title={`${st.name} — ${st.role === 'admin' ? 'Quản trị' : 'Nhân viên'} · ${st.online ? (st.busy ? 'đang gọi điện' : 'sẵn sàng') : 'ngoại tuyến'} · ${st.activeChats} kênh${st.lastSeenAt ? ` · hoạt động ${relativeTime(st.lastSeenAt)}` : ''}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${!st.online ? 'bg-slate-300' : st.busy ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                      />
                      {st.name}
                      {st.role === 'admin' && <span className="text-[8px] uppercase">admin</span>}
                    </span>
                  ))}
                  {(staffPresence.offline ?? []).map((st) => (
                    <span
                      key={`off-${st.userId}`}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 border-dashed bg-slate-50/50 px-2 py-0.5 text-[10px] font-medium text-slate-400"
                      title={`${st.name} — ${st.role === 'admin' ? 'Quản trị' : 'Nhân viên'} · ngoại tuyến · hoạt động lần cuối ${relativeTime(st.lastSeenAt)}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-300/70" />
                      {st.name}
                      <span className="text-slate-300">{relativeTime(st.lastSeenAt)}</span>
                    </span>
                  ))}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${staffPresence.botActive
                        ? 'border-violet-300 bg-violet-100 text-violet-700'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                      }`}
                    title={
                      staffPresence.botActive
                        ? 'Không có nhân viên trực tuyến — bot AI đang hỗ trợ khách'
                        : 'Có nhân viên trực tuyến — bot chỉ hỗ trợ khi không ai online'
                    }
                  >
                    <Bot className="h-3 w-3" />
                    Bot {staffPresence.botActive ? 'đang hỗ trợ' : 'chờ'}
                  </span>
                </>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  Đang kết nối trạng thái nhân viên...
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0">
            <ScrollArea ref={channelScrollRef} className={`${PANES_HEIGHT} xl:h-full`}>
              <div className="divide-y">
                {channelsLoading ? (
                  <ChatChannelListSkeleton count={6} />
                ) : channels.length === 0 && !hasMoreChannels ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Chưa có cuộc trò chuyện</div>
                ) : (
                  channels.map((c) => {
                    const hasPulse = unreadPulseChannels?.has(c.id) ?? false
                    return (
                      <button
                        key={c.id}
                        onClick={() => onOpenChannel(c)}
                        className={`w-full p-4 hover:bg-slate-50 flex items-center gap-3 text-left transition-colors ${activeChannel?.id === c.id ? 'bg-blue-50/50 border-l-2 border-l-blue-600' : ''}`}
                      >
                        <div className="relative shrink-0">
                          <Avatar className="h-10 w-10">
                            <AvatarFallback className="bg-slate-200 text-xs font-bold text-slate-600">
                              {customerInitial(c)}
                            </AvatarFallback>
                          </Avatar>
                          {/* Pulsing blue dot — Facebook Messenger style.
                              Shown when this channel has a new customer
                              message the admin hasn't seen yet. Cleared
                              when the admin opens the channel. */}
                          {hasPulse && (
                            <span
                              className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-blue-500 ring-2 ring-white animate-pulse"
                              title="Tin nhắn mới"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-sm truncate">{customerDisplayName(c)}</div>
                            {c.brand?.name && (
                              <Badge variant="outline" className="text-[10px]">{c.brand.name}</Badge>
                            )}
                            {c.assignedTo?.fullName && (
                              <Badge
                                className={`text-[9px] border-0 ${c.assignedToMe ? 'bg-blue-600 text-white' : 'bg-indigo-100 text-indigo-700'}`}
                                title={`Được phân công cho ${c.assignedTo.fullName}`}
                              >
                                {c.assignedToMe ? 'Của tôi' : c.assignedTo.fullName}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="text-xs text-muted-foreground truncate flex-1">{c.lastMessagePreview ?? c.topic}</div>
                            <PriorityBadge priority={c.priority} />
                          </div>
                          {/* Subtitle line — email or phone (whichever
                              the display name didn't already show). */}
                          {customerSubtitle(c) && (
                            <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5 flex items-center gap-1">
                              {c.user?.phone && customerSubtitle(c) === c.user.phone ? (
                                <Phone className="h-2.5 w-2.5" />
                              ) : (
                                <Mail className="h-2.5 w-2.5" />
                              )}
                              {customerSubtitle(c)}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[10px] text-muted-foreground">{c.lastMessageAt ? relativeTime(c.lastMessageAt) : ''}</div>
                          {c.unreadEmployee > 0 && (
                            <Badge className="bg-rose-500 text-white text-[10px] mt-1">{c.unreadEmployee} mới</Badge>
                          )}
                          <StatusBadge status={c.status} />
                        </div>
                      </button>
                    )
                  })
                )}
                {/* ── Channel-list infinite-scroll sentinel (bottom) ──
                    Spinner while the next page loads; a manual
                    fallback button otherwise (also covers the case
                    where the loaded pages don't yet fill the viewport
                    + no scroll event can fire). */}
                {isFetchingMoreChannels && (
                  <div className="flex items-center justify-center py-3">
                    <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-muted-foreground">
                      <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                      Đang tải thêm kênh...
                    </div>
                  </div>
                )}
                {!isFetchingMoreChannels && hasMoreChannels && onFetchMoreChannels && (
                  <div className="flex items-center justify-center py-2">
                    <button
                      onClick={onFetchMoreChannels}
                      className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
                    >
                      Tải thêm kênh
                    </button>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Chat workspace */}
        <Card className="xl:col-span-3 flex flex-col xl:h-[40rem]">
          {activeChannel ? (
            <>
              <div className="px-4 py-3 border-b bg-linear-to-r from-blue-50 to-blue-50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-bold">
                      {customerInitial(activeChannel)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate flex items-center gap-2">
                      {customerDisplayName(activeChannel)}
                      {userOnline && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Đang trực tuyến" />
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate flex items-center gap-2">
                      {typingUser ? (
                        <span className="text-blue-600 italic">{typingUser.name} đang gõ...</span>
                      ) : (
                        <>
                          {activeChannel.user?.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {activeChannel.user.phone}
                            </span>
                          )}
                          {activeChannel.user?.email && activeChannel.user.email !== customerDisplayName(activeChannel) && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {activeChannel.user.email}
                            </span>
                          )}
                          {!activeChannel.user?.phone && !activeChannel.user?.email && activeChannel.topic}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 gap-1.5 bg-blue-600 hover:bg-blue-700"
                    onClick={() => setPickerOpen(true)}
                    title="Đặt vé cho khách"
                  >
                    <TicketIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Đặt vé cho khách</span>
                  </Button>
                  {activeChannel.status !== 'closed' && (
                    <>
                      {/* Assignment actions — three-role routing.
                          No assignee (or someone else) → claim ("nhận").
                          Assignee (or admin) → release + close. */}
                      {!activeChannel.assignedToMe && onClaim && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                          onClick={onClaim}
                          disabled={assignmentBusy}
                          title="Nhận kênh này về cho mình"
                        >
                          <Hand className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Nhận kênh</span>
                        </Button>
                      )}
                      {activeChannel.assignedToMe && onRelease && canRelease && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100"
                          onClick={onRelease}
                          disabled={assignmentBusy}
                          title="Trả kênh về hàng đợi chung"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Trả kênh</span>
                        </Button>
                      )}
                      {onCloseChannel && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-slate-600 border-slate-200 hover:bg-slate-100"
                          onClick={onCloseChannel}
                          disabled={assignmentBusy}
                          title="Đóng cuộc trò chuyện"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Đóng</span>
                        </Button>
                      )}
                    </>
                  )}
                  <Badge className={`text-[10px] border-0 ${activeChannel.status === 'assigned' ? 'bg-blue-100 text-blue-700' : activeChannel.status === 'closed' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
                    {activeChannel.status === 'assigned'
                      ? `Đang xử lý${activeChannel.assignedTo?.fullName ? ` · ${activeChannel.assignedTo.fullName}` : ''}`
                      : activeChannel.status === 'closed'
                        ? 'Đã đóng'
                        : 'Chờ'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                    onClick={() => onBlockChannel(activeChannel.id)}
                    title="Chặn cuộc trò chuyện"
                  >
                    <Ban className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Chat messages scroll area.
                  At xl it fills the space between the chat header + the
                  input (the card has a definite height from the grid row,
                  so `flex-1` can never grow it beyond the row — that was
                  the "chat box much larger than the channel list" bug:
                  `flex-1` inside an auto-height card made the card as
                  tall as the whole history). At base (stacked cards) it
                  falls back to the fixed `h-[32rem]`.
                  The `ref` is used by the auto-scroll effect above to
                  scroll to the bottom on new messages + typing events. */}
              <ScrollArea ref={chatScrollRef} className={`${PANES_HEIGHT} xl:h-auto xl:flex-1 xl:min-h-0 p-4`}>
                <div className="space-y-2.5">
                  {/* ── "Load more" spinner (top of chat) ─────────────────
                      Shown when the infinite-scroll hook is fetching the
                      next page of older messages. Also serves as a
                      visual anchor so the user knows more are coming.
                      The scroll-position-preservation logic above keeps
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

function parseTicketPayload(m: ChatMessage): CreatedTicketPayload | null {
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
function TicketCardMessage({
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

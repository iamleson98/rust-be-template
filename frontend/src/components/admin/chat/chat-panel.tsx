'use client'

import { useState } from 'react'
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
  ArrowDownRight,
  Ban,
  Send,
  Ticket as TicketIcon,
  Bus,
  MapPin,
  Armchair,
  Phone,
  Mail,
  User as UserIcon,
} from 'lucide-react'
import { relativeTime } from '@/lib/types'
import type { AdminChannel as Channel, AdminChatMessage as ChatMessage } from '@/components/admin/dashboard/types'
import { PriorityBadge, StatusBadge, BookingStatusBadge } from '@/components/admin/dashboard/badges'
import {
  ChatTicketPicker,
  type CreatedTicketPayload,
} from '@/components/admin/tickets/chat-ticket-picker'

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
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  // Aligned height for the channel list + chat workspace. Both use
  // the same max-height so the split-view looks symmetric — the
  // chat area auto-scrolls when overflowing, the channel list also
  // scrolls independently. h-[32rem] = 512px (fits 8-10 channel rows
  // or ~15 chat messages before scrolling).
  const PANES_HEIGHT = 'h-[32rem]'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Headset className="h-4 w-4 text-blue-600" /> Đang chờ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold">{channels.filter((c) => c.status === 'open').length}</div>
            <div className="text-xs text-muted-foreground mt-1">Cuộc trò chuyện chưa phân công</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-amber-600" /> Đang xử lý</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold">{channels.filter((c) => c.status === 'assigned').length}</div>
            <div className="text-xs text-muted-foreground mt-1">Đã có nhân viên phụ trách</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-rose-600" /> Thời gian phản hồi TB</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold">1:42</div>
            <div className="text-xs text-blue-600 flex items-center gap-1 mt-1"><ArrowDownRight className="h-3 w-3" /> -23% so với tuần trước</div>
          </CardContent>
        </Card>
      </div>

      {/* Chat queue + workspace split view.
          Both panes share the same fixed height so they align — the
          channel list scrolls independently when it overflows, and the
          chat area scrolls independently too. This avoids the previous
          bug where long message threads were covered by the footer. */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Channel list */}
        <Card className="xl:col-span-2 flex flex-col">
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              Hàng đợi cuộc trò chuyện
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0">
            <ScrollArea className={PANES_HEIGHT}>
              <div className="divide-y">
                {channels.length === 0 ? (
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
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Chat workspace */}
        <Card className="xl:col-span-3 flex flex-col">
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
                  <Badge className={`text-[10px] ${activeChannel.status === 'assigned' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'} border-0`}>
                    {activeChannel.status === 'assigned' ? 'Đang xử lý' : 'Chờ'}
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
                  Uses the same fixed height as the channel list so
                  both panes align. The flex column layout ensures the
                  input area sticks to the bottom (the scroll area
                  takes the remaining space). */}
              <ScrollArea className={`flex-1 ${PANES_HEIGHT} overflow-y-auto p-4`}>
                <div className="space-y-2.5">
                  {chatMessages.map((m) => {
                    const isEmployee = m.senderType === 'employee'
                    const ticketPayload = parseTicketPayload(m)
                    if (ticketPayload) {
                      return (
                        <TicketCardMessage
                          key={m.id}
                          payload={ticketPayload}
                          isEmployee={isEmployee}
                          onView={onViewTicket}
                        />
                      )
                    }
                    return (
                      <div key={m.id} className={`flex ${isEmployee ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm wrap-break-word ${isEmployee
                            ? 'bg-blue-600 text-white rounded-br-sm'
                            : m.senderType === 'system'
                              ? 'bg-amber-50 text-amber-800 text-center text-xs border border-amber-100 mx-auto rounded-lg'
                              : m.senderType === 'assistant'
                                ? 'bg-violet-50 text-violet-900 border border-violet-100 rounded-bl-sm'
                                : 'bg-white border rounded-bl-sm '
                            }`}
                        >
                          {m.content}
                        </div>
                      </div>
                    )
                  })}
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
                  the scroll area is `flex-1` (takes remaining space). */}
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
            <div className={`flex-1 flex items-center justify-center p-8 ${PANES_HEIGHT}`}>
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

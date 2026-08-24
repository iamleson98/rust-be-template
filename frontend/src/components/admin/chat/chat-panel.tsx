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
  User as UserIcon,
} from 'lucide-react'
import { relativeTime } from '@/lib/types'
import type { AdminChannel as Channel, AdminChatMessage as ChatMessage } from '@/components/admin/dashboard/types'
import { PriorityBadge, StatusBadge, BookingStatusBadge } from '@/components/admin/dashboard/badges'
import {
  ChatTicketPicker,
  type CreatedTicketPayload,
} from '@/components/admin/tickets/chat-ticket-picker'

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
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
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

      {/* Chat queue + workspace split view */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Channel list */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              Hàng đợi cuộc trò chuyện
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-125">
              <div className="divide-y">
                {channels.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Chưa có cuộc trò chuyện</div>
                ) : (
                  channels.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => onOpenChannel(c)}
                      className={`w-full p-4 hover:bg-slate-50 flex items-center gap-3 text-left transition-colors ${activeChannel?.id === c.id ? 'bg-blue-50/50 border-l-2 border-l-blue-600' : ''}`}
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className="bg-slate-200 text-xs font-bold text-slate-600">
                          {c.user?.fullName?.[0] ?? 'K'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-sm truncate">{c.user?.fullName ?? 'Khách'}</div>
                          {c.brand?.name && (
                            <Badge variant="outline" className="text-[10px]">{c.brand.name}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="text-xs text-muted-foreground truncate flex-1">{c.lastMessagePreview ?? c.topic}</div>
                          <PriorityBadge priority={c.priority} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-muted-foreground">{c.lastMessageAt ? relativeTime(c.lastMessageAt) : ''}</div>
                        {c.unreadEmployee > 0 && (
                          <Badge className="bg-rose-500 text-white text-[10px] mt-1">{c.unreadEmployee} mới</Badge>
                        )}
                        <StatusBadge status={c.status} />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Chat workspace */}
        <Card className="xl:col-span-3 flex flex-col">
          {activeChannel ? (
            <>
              <div className="px-4 py-3 border-b bg-linear-to-r from-blue-50 to-blue-50 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-bold">
                      {activeChannel.user?.fullName?.[0] ?? 'K'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate flex items-center gap-2">
                      {activeChannel.user?.fullName ?? 'Khách'}
                      {userOnline && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Đang trực tuyến" />
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
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
                          {!activeChannel.user?.phone && activeChannel.topic}
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

              <ScrollArea className="flex-1 h-80 overflow-y-scroll p-4">
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

              {/* Quick replies */}
              <div className="px-4 py-2 border-t bg-slate-50/50">
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
            <div className="flex-1 flex items-center justify-center p-8">
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

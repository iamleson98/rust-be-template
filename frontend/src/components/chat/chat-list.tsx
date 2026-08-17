'use client'

/**
 * ChatList — the channel list view of the customer-facing chat widget.
 *
 * Extracted from the original `chat-widget.tsx`. Renders the user's
 * existing chat channels (each showing the last message preview, time
 * and unread badge) plus a "Bắt đầu trò chuyện mới" button at the top.
 * Clicking a channel calls `onOpenChannel(ch)` so the parent can switch
 * to the conversation view and load its messages.
 */

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageCircle, Phone, Mail, Circle } from 'lucide-react'
import { relativeTime } from '@/lib/types'
import type { CustomerChannel as Channel } from './_shared'

export function ChatList({
  channels,
  onOpenChannel,
  onStartNewChat,
}: {
  channels: Channel[]
  onOpenChannel: (ch: Channel) => void
  onStartNewChat: () => void
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-3 border-b">
        <Button
          onClick={onStartNewChat}
          className="w-full gap-2 bg-linear-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800"
        >
          <MessageCircle className="h-4 w-4" />
          Bắt đầu trò chuyện mới
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1 max-h-96 overflow-y-auto">
          {channels.length === 0 ? (
            <div className="text-center py-12 px-6">
              <div className="inline-flex h-14 w-14 rounded-full bg-rose-50 items-center justify-center mb-3">
                <MessageCircle className="h-7 w-7 text-rose-600" />
              </div>
              <h4 className="font-semibold text-sm">Chưa có cuộc trò chuyện</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Bắt đầu trò chuyện để được nhân viên hỗ trợ đặt vé, đổi giờ, hoàn hủy...
              </p>
            </div>
          ) : (
            channels.map((ch) => {
              const agent = ch.assignments?.[0]?.employee
              return (
                <button
                  key={ch.id}
                  onClick={() => onOpenChannel(ch)}
                  className="w-full text-left rounded-lg p-3 hover:bg-slate-50 transition-colors flex items-center gap-3"
                >
                  <div className="relative shrink-0">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={agent?.avatarUrl ?? ''} />
                      <AvatarFallback className="bg-rose-100 text-rose-700 text-xs font-bold">
                        {agent?.name?.[0] ?? 'CS'}
                      </AvatarFallback>
                    </Avatar>
                    <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-blue-500 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm truncate">{ch.topic}</div>
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {ch.lastMessageAt ? relativeTime(ch.lastMessageAt) : ''}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="text-xs text-muted-foreground truncate">
                        {ch.lastMessagePreview || 'Chưa có tin nhắn'}
                      </div>
                      {ch.unreadUser > 0 && (
                        <Badge className="bg-rose-500 text-white text-[10px] h-4 min-w-4 px-1 justify-center">
                          {ch.unreadUser}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3 bg-slate-50 text-xs text-muted-foreground flex items-center justify-between">
        <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> 1900 6067</span>
        <span className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> cskh@vexevn.vn</span>
      </div>
    </div>
  )
}

'use client'

import type { RefObject } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageSquare, Filter, Phone, Mail } from 'lucide-react'
import { relativeTime } from '@/lib/types'
import { ChatChannelListSkeleton } from './chat-channel-list-skeleton'
import type { AdminChannel as Channel } from '@/features/admin/dashboard/types'
import { PriorityBadge, StatusBadge } from '@/features/admin/dashboard/badges'
import { customerDisplayName, customerInitial, customerSubtitle, PANES_HEIGHT } from './chat-helpers'
import { StaffPresenceStrip, type StaffPresence } from './staff-presence-strip'

export function ChatChannelListCard({
  channels,
  activeChannel,
  channelsLoading,
  hasMoreChannels,
  isFetchingMoreChannels,
  onFetchMoreChannels,
  onOpenChannel,
  unreadPulseChannels,
  allChannelsCount,
  mineFilter,
  onToggleMineFilter,
  staffPresence,
  channelScrollRef,
}: {
  channels: Channel[]
  activeChannel: Channel | null
  /** While the channels query loads: the queue shows structure-matched
   *  skeletons instead of empty/zero values. */
  channelsLoading?: boolean
  /** Whether there are more channels to load (channel-list infinite
   *  scroll — the initial page shows the most recently active
   *  channels; scrolling DOWN appends older ones). */
  hasMoreChannels?: boolean
  /** Whether we're currently fetching the next page of channels. */
  isFetchingMoreChannels?: boolean
  /** Call this when the user scrolls to the bottom of the channel list. */
  onFetchMoreChannels?: () => void
  onOpenChannel: (c: Channel) => void
  /**
   * Set of channel ids that have received a new customer message while
   * the admin was NOT viewing them. The channel row shows a pulsing
   * blue dot until the admin opens that channel.
   */
  unreadPulseChannels?: Set<string>
  /** Unfiltered channel count (shown when the mine filter hides rows). */
  allChannelsCount?: number
  /** "My channels" filter toggle (employee workspace). */
  mineFilter?: boolean
  onToggleMineFilter?: (v: boolean) => void
  /** Live staff presence (WS `staff_presence` broadcasts). */
  staffPresence?: StaffPresence
  /** Root ref of the list's ScrollArea — the panel's infinite-scroll
   *  effect queries its viewport. */
  channelScrollRef: RefObject<HTMLDivElement | null>
}) {
  return (
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
        <StaffPresenceStrip staffPresence={staffPresence} />
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
  )
}

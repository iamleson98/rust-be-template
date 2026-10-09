import { Filter, MessageSquare } from 'lucide-react'
import { useRef } from 'react'
import type { ChatChannelOut } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useScrollEdge } from '@/hooks/use-scroll-edge'
import { useT } from '@/lib/i18n'
import type { AdminChat } from './use-admin-chat'
import { ChannelRow } from './channel-row'
import { ChatChannelListSkeleton } from './chat-channel-list-skeleton'
import { PANES_HEIGHT } from './layout'
import { StaffPresenceStrip } from './staff-presence-strip'

type Props = {
  queue: AdminChat['queue']
  activeId?: string
  onOpen: (channel: ChatChannelOut) => void
}

const LoadingMore = ({ label }: { label: string }) => (
  <div className="flex items-center justify-center py-3">
    <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
      {label}
    </div>
  </div>
)

/** Left card: staff availability, "mine" filter and the support queue (older channels load on scroll). */
export function ChannelQueue({ queue, activeId, onOpen }: Props) {
  const t = useT()
  const viewport = useRef<HTMLDivElement>(null)
  useScrollEdge(viewport, {
    edge: 'bottom',
    threshold: 120,
    enabled: queue.hasMore && !queue.loadingMore,
    onEdge: queue.loadMore,
  })

  return (
    <Card className="xl:col-span-2 flex flex-col xl:h-160">
      <CardHeader className="pb-2 shrink-0 space-y-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-blue-600" />
          {t('chat.queue')}
          <span className="text-xs font-normal text-muted-foreground ml-auto">
            {queue.channels.length}
            {queue.total !== queue.channels.length ? `/${queue.total}` : ''}{' '}
            {t('adminChat.channelNoun')}
          </span>
          <Button
            variant={queue.mineOnly ? 'default' : 'outline'}
            size="sm"
            className={`h-7 gap-1 text-xs ${queue.mineOnly ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
            onClick={() => queue.setMineOnly(!queue.mineOnly)}
            title={t('adminChat.mineFilterTitle')}
          >
            <Filter className="h-3 w-3" />
            {t('adminChat.mine')}
          </Button>
        </CardTitle>
        <StaffPresenceStrip presence={queue.staffPresence} />
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <ScrollArea viewportRef={viewport} className={`${PANES_HEIGHT} xl:h-full`}>
          <div className="divide-y">
            {queue.loading ? (
              <ChatChannelListSkeleton count={6} />
            ) : queue.channels.length === 0 && !queue.hasMore ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {t('chat.noChannels')}
              </div>
            ) : (
              queue.channels.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  selected={channel.id === activeId}
                  unseen={queue.unseen.has(channel.id)}
                  onOpen={() => onOpen(channel)}
                />
              ))
            )}
            {queue.loadingMore && <LoadingMore label={t('adminChat.loadingMoreChannels')} />}
            {!queue.loadingMore && queue.hasMore && (
              <div className="flex items-center justify-center py-2">
                <button
                  onClick={queue.loadMore}
                  className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
                >
                  {t('adminChat.loadMoreChannels')}
                </button>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

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
    <Card className="flex h-full min-h-0 flex-col gap-0 py-0">
      <CardHeader className="shrink-0 space-y-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{t('chat.queue')}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
              {queue.channels.length}
              {queue.total !== queue.channels.length ? `/${queue.total}` : ''}
            </span>
          </CardTitle>
          <Button
            variant={queue.mineOnly ? 'default' : 'outline'}
            size="sm"
            className="ml-auto h-8 shrink-0 gap-1 text-xs"
            onClick={() => queue.setMineOnly(!queue.mineOnly)}
            title={t('adminChat.mineFilterTitle')}
            aria-pressed={queue.mineOnly}
          >
            <Filter className="size-3.5" />
            {t('adminChat.mine')}
          </Button>
        </div>
        <StaffPresenceStrip presence={queue.staffPresence} />
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <ScrollArea viewportRef={viewport} className="h-full">
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

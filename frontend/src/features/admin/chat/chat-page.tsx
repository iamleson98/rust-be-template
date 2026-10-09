import { useState } from 'react'
import { ChatTicketPicker } from '@/features/admin/tickets/chat-ticket-picker'
import { cn } from '@/lib/utils'
import { isAdminUser, useSession } from '@/stores/session'
import { ChannelQueue } from './channel-queue'
import { ChatStatsCards } from './chat-stats-cards'
import { ConversationCard } from './conversation-card'
import { useAdminChat } from './use-admin-chat'

/** `/admin/chat`: the support queue next to the open conversation. */
export function AdminChatPage() {
  const chat = useAdminChat()
  const canRelease = isAdminUser(useSession((s) => s.user))
  const [pickerOpen, setPickerOpen] = useState(false)
  const { stats, queue } = chat

  // The aggregate stats cover every channel; until they load, count what is in the list.
  const countByStatus = (status: string) => queue.channels.filter((c) => c.status === status).length

  return (
    // A messaging app: fills the console pane. Below xl one pane at a time —
    // the queue, or the open conversation (with a back button); xl+ side by side.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-4">
      <ChatStatsCards
        channelsLoading={queue.loading}
        openCount={stats?.openCount ?? countByStatus('open')}
        assignedCount={stats?.assignedCount ?? countByStatus('assigned')}
        avgResponseSecs={stats?.avgResponseTimeSecs ?? 0}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-4 xl:grid-cols-5">
        <div className={cn('min-h-0 xl:col-span-2', chat.active && 'max-xl:hidden')}>
          <ChannelQueue queue={queue} activeId={chat.active?.id} onOpen={chat.open} />
        </div>
        <div className={cn('min-h-0 xl:col-span-3', !chat.active && 'max-xl:hidden')}>
          <ConversationCard
            chat={chat}
            canRelease={canRelease}
            onBook={() => setPickerOpen(true)}
          />
        </div>
      </div>

      <ChatTicketPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        channel={chat.active}
        onCreated={chat.conversation.sendTicketCard}
      />
    </div>
  )
}

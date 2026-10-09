import { useState } from 'react'
import { ChatTicketPicker } from '@/features/admin/tickets/chat-ticket-picker'
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
    <div className="page-transition">
      <div className="space-y-4 p-3 md:p-4">
        <ChatStatsCards
          channelsLoading={queue.loading}
          openCount={stats?.openCount ?? countByStatus('open')}
          assignedCount={stats?.assignedCount ?? countByStatus('assigned')}
          avgResponseSecs={stats?.avgResponseTimeSecs ?? 0}
        />

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <ChannelQueue queue={queue} activeId={chat.active?.id} onOpen={chat.open} />
          <ConversationCard
            chat={chat}
            canRelease={canRelease}
            onBook={() => setPickerOpen(true)}
          />
        </div>

        <ChatTicketPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          channel={chat.active}
          onCreated={chat.conversation.sendTicketCard}
        />
      </div>
    </div>
  )
}

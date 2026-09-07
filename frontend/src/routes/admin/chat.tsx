/** Admin route — `/admin/chat` — chat support management page. */
import { ChatPanel } from '@/components/admin/chat/chat-panel'
import { useAdminChatWorkspace } from '@/components/admin/chat/use-admin-chat-workspace'
import { useApp } from '@/lib/store'

export function AdminChatPage() {
  const ws = useAdminChatWorkspace()
  const { user } = useApp()
  // Employees can't leave an assigned channel (backend 403s) — only
  // admins see the "Trả kênh" release button.
  const canRelease = user?.type === 'admin'

  return (
    <div className="page-transition">
      <ChatPanel
        channels={ws.channels}
        channelsLoading={ws.channelsLoading}
        activeChannel={ws.activeChannel}
        chatMessages={ws.chatMessages}
        replyText={ws.replyText}
        sending={ws.sending}
        onOpenChannel={ws.setActiveChannel}
        onSendReply={ws.sendReply}
        onBlockChannel={ws.blockChannel}
        onSetReplyText={ws.setReplyText}
        onSendTicketCard={ws.sendTicketCard}
        typingUser={ws.typingUser}
        userOnline={ws.userOnline}
        unreadPulseChannels={ws.unreadPulseChannels}
        hasMoreMessages={ws.hasMoreMessages}
        isFetchingMoreMessages={ws.isFetchingMoreMessages}
        onFetchMoreMessages={ws.fetchMoreMessages as any}
        chatStats={ws.chatStats}
        staffPresence={ws.staffPresence}
        mineFilter={ws.mineFilter}
        onToggleMineFilter={ws.setMineFilter}
        onClaim={ws.claimActiveChannel}
        onRelease={ws.releaseActiveChannel}
        onCloseChannel={ws.closeActiveChannel}
        assignmentBusy={ws.assignmentBusy}
        allChannelsCount={ws.allChannelsCount}
        canRelease={canRelease}
      />
    </div>
  )
}

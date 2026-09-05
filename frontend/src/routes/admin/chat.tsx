/** Admin route — `/admin/chat` — chat support management page. */
import { AdminShell } from '@/components/layout/admin-shell'
import { ChatPanel } from '@/components/admin/chat/chat-panel'
import { useAdminChatWorkspace } from '@/components/admin/chat/use-admin-chat-workspace'

export function AdminChatPage() {
  const ws = useAdminChatWorkspace()

  return (
    <AdminShell>
      <ChatPanel
        channels={ws.channels}
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
      />
    </AdminShell>
  )
}

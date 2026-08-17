/** Admin route — `/admin/chat` — chat support management page. */
import { ChatPanel } from '@/components/admin/chat/chat-panel'
import { useAdminChatWorkspace } from '@/components/admin/chat/use-admin-chat-workspace'

export function AdminChatPage() {
  const ws = useAdminChatWorkspace()

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Chat hỗ trợ</h1>
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
        />
      </div>
    </div>
  )
}

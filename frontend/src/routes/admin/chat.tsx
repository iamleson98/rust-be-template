/** Admin route — `/admin/chat` — chat support management page. */
import { useCallback, useState } from 'react'
import { ChatPanel } from '@/components/admin/chat/chat-panel'
import type { Channel, ChatMessage } from '@/components/admin/dashboard/types'
import {
  useChatChannels,
  useChatMessages,
  usePostChatMessage,
} from '@/lib/queries'
import { toast } from 'sonner'

export function AdminChatPage() {
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [replyText, setReplyText] = useState('')

  const channelsQuery = useChatChannels(50)
  const channels: Channel[] = (channelsQuery.data?.items ?? []) as unknown as Channel[]
  const messagesQuery = useChatMessages(activeChannel?.id, 50)
  const chatMessages: ChatMessage[] = (messagesQuery.data?.items ?? []) as unknown as ChatMessage[]

  // Two distinct mutation instances, each with its own callbacks (defined at
  // HOOK CREATION). mutate() is then called with only the variables.
  // - postReplyMut: clears the input + toasts success/error
  // - postTicketCardMut: silently swallows errors (booking already succeeded)
  const postReplyMut = usePostChatMessage({
    onSuccess: () => {
      setReplyText('')
      toast.success('Đã gửi phản hồi')
    },
    onError: () => {
      toast.error('Không thể gửi tin nhắn')
    },
  })
  const postTicketCardMut = usePostChatMessage({
    onError: () => {
      // Silently fail — the booking was already created
    },
  })

  const sendReply = useCallback(() => {
    if (!replyText.trim() || !activeChannel) return
    postReplyMut.mutate({
      path: { id: activeChannel.id },
      body: { content: replyText.trim(), kind: 'text' },
    } as any)
  }, [replyText, activeChannel, postReplyMut])

  const blockChannel = useCallback((channelId: string) => {
    toast.success('Đã chặn cuộc trò chuyện')
    if (activeChannel?.id === channelId) setActiveChannel(null)
  }, [activeChannel])

  const sendTicketCard = useCallback(
    (payload: { bookingCode: string }) => {
      if (!activeChannel) return
      const attachments = JSON.stringify(payload)
      postTicketCardMut.mutate({
        path: { id: activeChannel.id },
        body: {
          content: `Đã đặt vé ${payload.bookingCode}`,
          kind: 'ticket',
          attachments,
        },
      } as any)
    },
    [activeChannel, postTicketCardMut],
  )

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Chat hỗ trợ</h1>
        <ChatPanel
          channels={channels}
          activeChannel={activeChannel}
          chatMessages={chatMessages}
          replyText={replyText}
          sending={postReplyMut.isPending}
          onOpenChannel={setActiveChannel}
          onSendReply={sendReply}
          onBlockChannel={blockChannel}
          onSetReplyText={setReplyText}
          onSendTicketCard={sendTicketCard}
        />
      </div>
    </div>
  )
}

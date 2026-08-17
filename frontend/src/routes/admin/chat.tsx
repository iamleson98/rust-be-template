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
  const postMessageMut = usePostChatMessage()

  const sendReply = useCallback(() => {
    if (!replyText.trim() || !activeChannel) return
    postMessageMut.mutate(
      { path: { id: activeChannel.id }, body: { content: replyText.trim(), kind: 'text' } } as any,
      {
        onSuccess: () => {
          setReplyText('')
          toast.success('Đã gửi phản hồi')
        },
        onError: () => {
          toast.error('Không thể gửi tin nhắn')
        },
      },
    )
  }, [replyText, activeChannel, postMessageMut])

  const blockChannel = useCallback((channelId: string) => {
    toast.success('Đã chặn cuộc trò chuyện')
    if (activeChannel?.id === channelId) setActiveChannel(null)
  }, [activeChannel])

  const sendTicketCard = useCallback(
    (payload: { bookingCode: string }) => {
      if (!activeChannel) return
      const attachments = JSON.stringify(payload)
      postMessageMut.mutate(
        { path: { id: activeChannel.id }, body: { content: `Đã đặt vé ${payload.bookingCode}`, kind: 'ticket', attachments } } as any,
        {
          onError: () => {},
        },
      )
    },
    [activeChannel, postMessageMut],
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
          sending={postMessageMut.isPending}
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

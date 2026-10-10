import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { postMessageMutation } from '@/api'
import { useT } from '@/lib/i18n'
import { useChatMessagesInfinite } from '../api'
import { useMessageScroll } from '../use-message-scroll'
import { useTypingBroadcast } from '../use-typing-broadcast'
import { ChatInput } from './chat-input'
import { MessageList } from './message-list'
import type { CustomerRoom } from './use-customer-room'

const newClientMsgId = () => `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`

type Props = {
  channelId: string
  room: CustomerRoom
  draft: string
  onDraftChange: (draft: string) => void
}

/** One support conversation: its messages, the message box, and sending. */
export function Conversation({ channelId, room, draft, onDraftChange }: Props) {
  const t = useT()
  const thread = useChatMessagesInfinite(channelId)
  const typing = useTypingBroadcast(channelId, (id, isTyping) =>
    room.send('typing', { channelId: id, isTyping }),
  )
  const [quickUsed, setQuickUsed] = useState(false)
  const scrollRef = useMessageScroll({
    messages: thread.messages,
    trailing: room.peerTyping,
    hasMore: thread.hasNextPage,
    loadingMore: thread.isFetchingNextPage,
    onLoadMore: () => void thread.fetchNextPage(),
  })
  const postMessage = useMutation({
    ...postMessageMutation(),
    onError: () => toast.error(t('chat.sendFailed')),
  })

  // The socket is the fast path; REST covers a dropped connection.
  // `clientMsgId` lets the server discard a duplicate if both get through.
  const send = (text: string) => {
    const content = text.trim()
    if (!content) return
    typing.stop()
    onDraftChange('')
    const clientMsgId = newClientMsgId()
    if (!room.send('message', { channelId, text: content, clientMsgId })) {
      postMessage.mutate({ path: { id: channelId }, body: { content, kind: 'text', clientMsgId } })
    }
  }

  return (
    <>
      <MessageList
        scrollRef={scrollRef}
        messages={thread.messages}
        loading={thread.isLoading}
        peerTyping={room.peerTyping}
        hasMore={thread.hasNextPage}
        loadingMore={thread.isFetchingNextPage}
        onLoadMore={() => void thread.fetchNextPage()}
      />
      <ChatInput
        value={draft}
        onChange={(value) => {
          onDraftChange(value)
          typing.ping()
        }}
        onSend={() => send(draft)}
        sending={postMessage.isPending}
        showQuickActions={!quickUsed && !thread.isLoading && thread.messages.length === 0}
        onQuickAction={(message) => {
          setQuickUsed(true)
          send(message)
        }}
      />
    </>
  )
}

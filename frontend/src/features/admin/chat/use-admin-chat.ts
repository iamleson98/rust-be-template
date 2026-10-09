import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  chatMarkReadMutation,
  chatStatsOptions,
  claimChannelMutation,
  closeChannelMutation,
  postMessageMutation,
  releaseChannelMutation,
  type ChatChannelOut,
} from '@/api'
import { useChatChannelsInfinite, useChatMessagesInfinite } from '@/features/chat/api'
import { useTypingBroadcast } from '@/features/chat/use-typing-broadcast'
import { getErrorMessage } from '@/lib/error-message'
import { tSync } from '@/lib/i18n'
import { useAdminChatSocket } from './use-admin-chat-socket'

const PAGE_SIZE = 30

/** Everything the staff chat workspace shows and does: queue, open conversation, live state. */
export function useAdminChat() {
  const [active, setActive] = useState<ChatChannelOut | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [replyText, setReplyText] = useState('')

  const queue = useChatChannelsInfinite(PAGE_SIZE)
  const stats = useQuery({ ...chatStatsOptions(), refetchInterval: 15_000 })
  const thread = useChatMessagesInfinite(active?.id)
  const live = useAdminChatSocket(active?.id)
  const typing = useTypingBroadcast(active?.id, live.sendTyping)

  const { mutate: markRead } = useMutation(chatMarkReadMutation())
  const claim = useMutation({
    ...claimChannelMutation(),
    onSuccess: () => toast.success(tSync('adminChat.claimed')),
    onError: (e) => toast.error(getErrorMessage(e, tSync('adminChat.claimFailed'))),
  })
  const release = useMutation({
    ...releaseChannelMutation(),
    onSuccess: () => toast.success(tSync('adminChat.released')),
    onError: (e) => toast.error(getErrorMessage(e, tSync('adminChat.releaseFailed'))),
  })
  const close = useMutation({
    ...closeChannelMutation(),
    onSuccess: () => {
      toast.success(tSync('adminChat.channelClosed'))
      setActive(null)
    },
    onError: (e) => toast.error(getErrorMessage(e, tSync('adminChat.closeFailed'))),
  })
  const reply = useMutation({
    ...postMessageMutation(),
    onSuccess: () => setReplyText(''),
    onError: () => toast.error(tSync('chat.sendFailed')),
  })
  // A ticket card follows a booking that already exists, so a failed post is not worth a toast.
  const { mutate: postTicketCard } = useMutation(postMessageMutation())

  // Staff see the channels assigned to them plus the unassigned queue; closed ones stay for context.
  const channels = mineOnly
    ? queue.channels.filter((c) => c.assignedToMe || (!c.assignedTo && c.status !== 'closed'))
    : queue.channels
  const id = active?.id

  return {
    queue: {
      channels,
      total: queue.channels.length,
      loading: queue.isLoading,
      hasMore: queue.hasNextPage,
      loadingMore: queue.isFetchingNextPage,
      loadMore: () => void queue.fetchNextPage(),
      mineOnly,
      setMineOnly,
      unseen: live.unseen,
      staffPresence: live.staffPresence,
    },
    stats: stats.data,
    active,
    open: (channel: ChatChannelOut) => {
      setActive(channel)
      markRead({ path: { id: channel.id } })
    },
    // Blocking is a stub: it only tells the staff member and leaves the conversation.
    block: () => {
      toast.success(tSync('chat.blocked'), { description: tSync('chat.blockedDesc') })
      setActive(null)
    },
    claim: () => id && claim.mutate({ path: { id } }),
    release: () => id && release.mutate({ path: { id } }),
    close: () => id && close.mutate({ path: { id } }),
    assignmentBusy: claim.isPending || release.isPending || close.isPending,
    conversation: {
      messages: thread.messages,
      loading: thread.isLoading,
      hasMore: thread.hasNextPage,
      loadingMore: thread.isFetchingNextPage,
      loadMore: () => void thread.fetchNextPage(),
      typingUser: live.typingUser,
      userOnline: live.userOnline,
      replyText,
      sending: reply.isPending,
      setReplyText: (text: string) => {
        setReplyText(text)
        typing.ping()
      },
      sendReply: () => {
        const content = replyText.trim()
        if (!content || !id) return
        typing.stop()
        reply.mutate({ path: { id }, body: { content, kind: 'text' } })
      },
      sendTicketCard: (payload: { bookingCode: string }) => {
        if (!id) return
        postTicketCard({
          path: { id },
          body: {
            content: tSync('adminChat.ticketCardNote', { code: payload.bookingCode }),
            kind: 'ticket',
            attachments: JSON.stringify(payload),
          },
        })
      },
    },
  }
}

export type AdminChat = ReturnType<typeof useAdminChat>

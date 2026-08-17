/**
 * useAdminChatWorkspace — shared state hook for the admin chat workspace.
 *
 * Used by both:
 *   - `/components/admin/dashboard/index.tsx` (the Chat tab)
 *   - `/routes/admin/chat.tsx`              (the standalone chat page)
 *
 * Encapsulates:
 *   - channels list (via `useChatChannels`)
 *   - messages for the active channel (via `useChatMessages`)
 *   - two distinct `usePostChatMessage` mutation instances:
 *     * `postReplyMut`     — clears input + toasts success/error
 *     * `postTicketCardMut` — silently swallows errors (the booking
 *       was already created by the time we send the ticket card)
 *   - active channel state, reply text state
 *   - sendReply / blockChannel / sendTicketCard handlers
 *
 * Each mutation defines its callbacks at HOOK CREATION time; `mutate()`
 * is then called with only the params.
 */

'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  useChatChannels,
  useChatMessages,
  usePostChatMessage,
} from '@/lib/queries'
import type { AdminChannel, AdminChatMessage } from '@/components/admin/dashboard/types'

export function useAdminChatWorkspace() {
  const [activeChannel, setActiveChannel] = useState<AdminChannel | null>(null)
  const [replyText, setReplyText] = useState('')

  const channelsQuery = useChatChannels(50)
  const channels: AdminChannel[] = (channelsQuery.data?.items ?? []) as unknown as AdminChannel[]
  const messagesQuery = useChatMessages(activeChannel?.id, 50)
  const chatMessages: AdminChatMessage[] = (messagesQuery.data?.items ?? []) as unknown as AdminChatMessage[]

  // Reply mutation — clears the input + toasts the result.
  const postReplyMut = usePostChatMessage({
    onSuccess: () => {
      setReplyText('')
      toast.success('Đã gửi phản hồi')
    },
    onError: () => {
      toast.error('Không thể gửi tin nhắn')
    },
  })

  // Ticket-card mutation — silent failure is OK because the booking
  // has already been created by the time we send the card.
  const postTicketCardMut = usePostChatMessage({
    onError: () => {
      // Silently fail — the booking was already created.
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
    toast.success('Đã chặn cuộc trò chuyện', {
      description: 'Khách sẽ không thể gửi tin nhắn mới',
    })
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

  return {
    // data
    channels,
    chatMessages,
    activeChannel,
    setActiveChannel,
    replyText,
    setReplyText,
    sending: postReplyMut.isPending,
    // actions
    sendReply,
    blockChannel,
    sendTicketCard,
  }
}

export type AdminChatWorkspace = ReturnType<typeof useAdminChatWorkspace>

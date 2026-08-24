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
 *   - reply mutation (via `usePostChatMessage`)
 *   - realtime WS subscription (via `useAdminChatWs`) — delivers new
 *     messages, typing indicators, and presence changes instantly.
 *   - active channel state, reply text state
 *   - sendReply / typing / presence handlers
 *
 * ## Realtime strategy
 *
 * The admin workspace subscribes to the WS hub. When a new message
 * arrives via WS, the hook invalidates the relevant TanStack Query.
 * This triggers a REST refetch — single source of truth, instant UX.
 */

'use client'

import { useCallback, useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import {
  useChatChannels,
  useChatMessages,
  usePostChatMessage,
  useMarkChatRead,
} from '@/lib/queries'
import type { AdminChannel, AdminChatMessage } from '@/components/admin/dashboard/types'
import { useAdminChatWs } from './use-admin-chat-ws'
import { useApp } from '@/lib/store'

export function useAdminChatWorkspace() {
  const { user } = useApp()
  const [activeChannel, setActiveChannel] = useState<AdminChannel | null>(null)
  const [replyText, setReplyText] = useState('')

  const channelsQuery = useChatChannels(50)
  const channels: AdminChannel[] = (channelsQuery.data?.items ?? []) as unknown as AdminChannel[]
  const messagesQuery = useChatMessages(activeChannel?.id, 50)
  const chatMessages: AdminChatMessage[] = (messagesQuery.data?.items ?? []) as unknown as AdminChatMessage[]

  // ── Realtime WS subscription ──────────────────────────────────
  const { typingUser, userOnline, sendTyping } = useAdminChatWs(
    user,
    activeChannel?.id,
  )

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

  const sendReply = useCallback(() => {
    if (!replyText.trim() || !activeChannel) return
    // Send typing=false so the user sees the admin stopped typing.
    sendTyping(activeChannel.id, false)
    postReplyMut.mutate({
      path: { id: activeChannel.id },
      body: { content: replyText.trim(), kind: 'text' },
    } as any)
  }, [replyText, activeChannel, postReplyMut, sendTyping])

  // ── Typing indicator ──────────────────────────────────────────
  // Send typing=true when the admin starts typing, typing=false after
  // 2s of inactivity.
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onReplyTextChange = useCallback((val: string) => {
    setReplyText(val)
    if (activeChannel) {
      sendTyping(activeChannel.id, true)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => {
        sendTyping(activeChannel.id, false)
      }, 2000)
    }
  }, [activeChannel, sendTyping])

  // Cleanup typing timer on unmount.
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [])

  const blockChannel = useCallback((channelId: string) => {
    toast.success('Đã chặn cuộc trò chuyện', {
      description: 'Khách sẽ không thể gửi tin nhắn mới',
    })
    if (activeChannel?.id === channelId) setActiveChannel(null)
  }, [activeChannel])

  // Mark channel as read when admin opens it — clears the unread
  // badge so the admin can see which channels have NEW messages.
  const markReadMut = useMarkChatRead()
  const openChannel = useCallback((channel: AdminChannel) => {
    setActiveChannel(channel)
    markReadMut.mutate({ path: { id: channel.id } } as any)
  }, [markReadMut])

  // Ticket-card mutation — silent failure is OK because the booking
  // has already been created by the time we send the card.
  const postTicketCardMut = usePostChatMessage({
    onError: () => {
      // Silently fail — the booking was already created.
    },
  })

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
    channelsLoading: channelsQuery.isLoading,
    channelsError: channelsQuery.error,
    chatMessages,
    messagesLoading: messagesQuery.isLoading,
    messagesError: messagesQuery.error,
    activeChannel,
    setActiveChannel: openChannel,
    replyText,
    setReplyText: onReplyTextChange,
    sending: postReplyMut.isPending,
    // realtime state
    typingUser,
    userOnline,
    // actions
    sendReply,
    blockChannel,
    sendTicketCard,
  }
}

export type AdminChatWorkspace = ReturnType<typeof useAdminChatWorkspace>

import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { chatMarkReadMutation } from '@/api'
import { invalidateResources } from '@/api/query-client'
import { playSound } from '@/lib/sound-effects'
import { startTitleNotification, stopTitleNotification } from '@/lib/title-notifier'
import { isStaffUser, useSession } from '@/stores/session'
import type { StaffPresenceSnapshot } from '@/features/chat/events'
import { useChatSocket } from '@/features/chat/use-chat-socket'

/**
 * Live side of the staff workspace: refreshes the queue as events arrive, flags
 * channels with unseen customer messages, and tracks typing, presence and staff
 * availability for the open channel.
 */
export function useAdminChatSocket(activeChannelId?: string) {
  const queryClient = useQueryClient()
  const user = useSession((s) => s.user)
  const [typingUser, setTypingUser] = useState<{ name: string } | null>(null)
  const [userOnline, setUserOnline] = useState(false)
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set())
  const [staffPresence, setStaffPresence] = useState<StaffPresenceSnapshot | null>(null)
  const { mutate: markRead } = useMutation(chatMarkReadMutation())

  const [seenChannel, setSeenChannel] = useState(activeChannelId)
  if (seenChannel !== activeChannelId) {
    setSeenChannel(activeChannelId)
    setTypingUser(null)
    setUserOnline(false)
    setUnseen((prev) => {
      if (!activeChannelId || !prev.has(activeChannelId)) return prev
      return new Set([...prev].filter((id) => id !== activeChannelId))
    })
  }

  useEffect(() => {
    if (activeChannelId) stopTitleNotification()
  }, [activeChannelId])

  const { send } = useChatSocket({
    enabled: isStaffUser(user),
    channelId: activeChannelId,
    onEvent: (event) => {
      const here = 'channelId' in event && event.channelId === activeChannelId
      switch (event.type) {
        case 'message':
          // The reader is looking at it: nothing to flag as unread.
          if (here && event.senderType !== 'employee') markRead({ path: { id: event.channelId } })
          void invalidateResources(queryClient, 'chat')
          break
        case 'channel_message':
          playSound('message')
          startTitleNotification(1)
          if (!here) setUnseen((prev) => new Set(prev).add(event.channelId))
          void invalidateResources(queryClient, 'chat')
          break
        case 'typing':
          if (here && event.userId !== user?.id) setTypingUser(event.isTyping ? { name: event.name } : null)
          break
        case 'presence':
          if (here) setUserOnline(event.online)
          void invalidateResources(queryClient, 'chat')
          break
        case 'channel_created':
        case 'channels_changed':
        case 'channel_assigned':
        case 'channel_released':
        case 'channel_closed':
          void invalidateResources(queryClient, 'chat')
          break
        case 'staff_presence':
          if (Array.isArray(event.staff)) {
            setStaffPresence({
              staff: event.staff,
              offline: event.offline ?? [],
              botActive: !!event.botActive,
            })
          }
          break
      }
    },
  })

  const sendTyping = useCallback(
    (channelId: string, isTyping: boolean) => send('typing', { channelId, isTyping }),
    [send],
  )

  return { typingUser, userOnline, unseen, staffPresence, sendTyping }
}

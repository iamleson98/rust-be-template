import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  chatMarkReadMutation,
  onlineChannelsOptions,
  onlineChannelsQueryKey,
  type OnlineChannelsResponse,
} from '@/api'
import { invalidateResources } from '@/api/query-client'
import { playSound } from '@/lib/sound-effects'
import { startTitleNotification, stopTitleNotification } from '@/lib/title-notifier'
import { isStaffUser, useSession } from '@/stores/session'
import type { StaffPresenceSnapshot } from '@/features/chat/events'
import { useChatSocket } from '@/features/chat/use-chat-socket'
import { onlineUsers, withPresenceEvent, type PresenceEvents } from './customer-presence'

/**
 * Live side of the staff workspace: refreshes the queue as events arrive, flags
 * channels with unseen customer messages, tracks typing in the open channel and
 * staff availability, and knows which customers are online.
 *
 * `loadedChannelIds` are the channels the list already holds: a customer coming
 * online with any other open channel makes the online list refetch.
 */
export function useAdminChatSocket(
  activeChannelId?: string,
  loadedChannelIds: ReadonlySet<string> = new Set(),
) {
  const queryClient = useQueryClient()
  const user = useSession((s) => s.user)
  const isStaff = isStaffUser(user)
  const [typingUser, setTypingUser] = useState<{ name: string } | null>(null)
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set())
  const [staffPresence, setStaffPresence] = useState<StaffPresenceSnapshot | null>(null)
  const [presenceEvents, setPresenceEvents] = useState<PresenceEvents>(new Map())
  const { mutate: markRead } = useMutation(chatMarkReadMutation())

  const [seenChannel, setSeenChannel] = useState(activeChannelId)
  if (seenChannel !== activeChannelId) {
    setSeenChannel(activeChannelId)
    setTypingUser(null)
    setUnseen((prev) => {
      if (!activeChannelId || !prev.has(activeChannelId)) return prev
      return new Set([...prev].filter((id) => id !== activeChannelId))
    })
  }

  useEffect(() => {
    if (activeChannelId) stopTitleNotification()
  }, [activeChannelId])

  const cachedOnline = () =>
    queryClient.getQueryData<OnlineChannelsResponse>(onlineChannelsQueryKey())

  const { connected, send } = useChatSocket({
    enabled: isStaff,
    channelId: activeChannelId,
    userId: user?.id,
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
          if (here && event.userId !== user?.id)
            setTypingUser(event.isTyping ? { name: event.name } : null)
          break
        case 'customer_presence': {
          const snapshot = cachedOnline()
          setPresenceEvents((prev) => withPresenceEvent(prev, event, snapshot?.seq))
          const known = (id: string) =>
            loadedChannelIds.has(id) || !!snapshot?.items.some((c) => c.id === id)
          // No ids means the server could not look them up: refetch to be safe.
          if (event.online && (!event.channelIds || !event.channelIds.every(known)))
            void queryClient.invalidateQueries({ queryKey: onlineChannelsQueryKey() })
          break
        }
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

  // Fetched once the socket is open (and again after every reconnect, since
  // events may have been missed meanwhile), so no change falls in between.
  const online = useQuery({
    ...onlineChannelsOptions(),
    enabled: isStaff && connected,
    staleTime: 0,
  })
  const onlineUserIds = useMemo(
    () => onlineUsers(online.data, presenceEvents),
    [online.data, presenceEvents],
  )

  const sendTyping = useCallback(
    (channelId: string, isTyping: boolean) => send('typing', { channelId, isTyping }),
    [send],
  )

  return {
    typingUser,
    unseen,
    staffPresence,
    sendTyping,
    /** Customers signed in with the site open. */
    onlineUserIds,
    /** Open channels of online customers (may include ones the list has not loaded). */
    onlineChannels: online.data?.items ?? [],
  }
}

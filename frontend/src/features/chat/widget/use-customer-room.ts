import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { authMeQueryKey } from '@/api'
import { invalidateResources } from '@/api/query-client'
import { tSync } from '@/lib/i18n'
import { notifyChatMessage } from '@/lib/notifications'
import { playSound } from '@/lib/sound-effects'
import { startTitleNotification } from '@/lib/title-notifier'
import { useChatSocket } from '../use-chat-socket'

type Options = {
  userId?: string
  channelId?: string
  /** The hub banned the customer for abuse; whatever they were typing is moot. */
  onBanned: () => void
}

/**
 * The customer's live view of the open channel: connection state, whether the
 * other side is typing, who is handling it. Incoming messages sound, notify
 * and refresh the chat queries.
 */
export function useCustomerRoom({ userId, channelId, onBanned }: Options) {
  const queryClient = useQueryClient()
  const [peerTyping, setPeerTyping] = useState(false)
  const [assignee, setAssignee] = useState<string | null>(null)
  const [botActive, setBotActive] = useState(false)

  const [seenChannel, setSeenChannel] = useState(channelId)
  if (seenChannel !== channelId) {
    setSeenChannel(channelId)
    setPeerTyping(false)
    setAssignee(null)
    setBotActive(false)
  }

  const { connected, send } = useChatSocket({
    enabled: !!userId,
    channelId,
    onGiveUp: () => void queryClient.invalidateQueries({ queryKey: authMeQueryKey() }),
    onEvent: (event) => {
      const here = 'channelId' in event && event.channelId === channelId
      switch (event.type) {
        case 'message': {
          const fromSupport = event.senderType !== 'user'
          if (fromSupport) {
            notifyChatMessage(event.senderName ?? tSync('chat.agentName'), event.text ?? '')
            startTitleNotification(1)
          }
          if (fromSupport || here) playSound('message')
          void invalidateResources(queryClient, 'chat')
          break
        }
        case 'typing':
          if (here && event.userId !== userId) setPeerTyping(event.isTyping)
          break
        case 'joined':
          if (here) setBotActive(!!event.botActive)
          break
        case 'channel_assigned':
          if (here) {
            setAssignee(event.employeeId && event.employeeName ? event.employeeName : null)
            setBotActive(false)
          }
          break
        case 'channel_released':
        case 'channel_closed':
          if (here) setAssignee(null)
          break
        case 'staff_presence':
          if (typeof event.botActive === 'boolean') setBotActive(event.botActive)
          break
        case 'error':
          if (event.message) toast.error(event.message)
          break
        case 'abuse:warned':
          if (event.reason) {
            toast.warning(tSync('chatWidget.abuseWarning', { reason: event.reason }), {
              duration: 6000,
            })
          }
          break
        case 'abuse:banned':
          toast.error(event.reason ?? tSync('chatWidget.abuseBannedDefault'), { duration: 12000 })
          onBanned()
          break
      }
    },
  })

  return { connected, peerTyping, assignee, botActive, send }
}

export type CustomerRoom = ReturnType<typeof useCustomerRoom>

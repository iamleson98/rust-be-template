import { useCallback, useEffect, useEffectEvent, useRef, useSyncExternalStore } from 'react'
import type { WsClient } from '@/api/ws-client'
import type { ChatEvent } from './events'
import { chatSocketOpen, holdChatSocket, onChatSocketChange } from './shared-socket'

type Options = {
  /** The socket is held only while this is true. */
  enabled: boolean
  /** Channel whose room to stay in; joined again after every reconnect. */
  channelId?: string | null
  /**
   * Who the socket signs in as. Changing it re-opens the socket, since the
   * server reads the session once, on connect.
   */
  userId?: string | null
  onEvent?: (event: ChatEvent) => void
  /** Reconnecting failed before the socket ever opened (the session probably expired). */
  onGiveUp?: () => void
}

/**
 * The tab's shared chat socket while `enabled`. Leaves the room it joined
 * when it lets go, so support sees the customer close the panel. `send` is
 * stable and returns false when the socket is not open.
 */
export function useChatSocket({ enabled, channelId, userId, onEvent, onGiveUp }: Options) {
  const open = useSyncExternalStore(onChatSocketChange, chatSocketOpen, () => false)
  const client = useRef<WsClient | null>(null)
  const handleEvent = useEffectEvent((event: ChatEvent) => onEvent?.(event))
  const handleGiveUp = useEffectEvent(() => onGiveUp?.())
  const currentChannel = useEffectEvent(() => channelId)

  useEffect(() => {
    if (!enabled) return
    const { client: ws, release } = holdChatSocket()
    client.current = ws
    const opened = () => {
      const id = currentChannel()
      if (id) ws.send('join', { channelId: id })
    }
    const gaveUp = (data: Record<string, unknown>) => {
      if (!data.everOpened) handleGiveUp()
    }
    const message = (frame: Record<string, unknown>) => handleEvent(frame as ChatEvent)
    ws.on('_open', opened).on('_giveup', gaveUp).on('_message', message)
    return () => {
      if (currentChannel()) ws.send('leave')
      ws.off('_open', opened).off('_giveup', gaveUp).off('_message', message)
      release()
      client.current = null
    }
  }, [enabled, userId])

  // Also joins on mount when another holder already has the socket open.
  useEffect(() => {
    if (channelId) client.current?.send('join', { channelId })
  }, [channelId])

  const send = useCallback(
    (type: string, data?: Record<string, unknown>) => client.current?.send(type, data) ?? false,
    [],
  )
  return { connected: enabled && open, send }
}

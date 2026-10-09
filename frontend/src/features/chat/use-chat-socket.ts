import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { WsClient } from '@/api/ws-client'
import type { ChatEvent } from './events'

type Options = {
  /** The socket is open only while this is true. */
  enabled: boolean
  /** Channel whose room to stay in; joined again after every reconnect. */
  channelId?: string | null
  onEvent: (event: ChatEvent) => void
  /** Reconnecting failed before the socket ever opened (the session probably expired). */
  onGiveUp?: () => void
}

/** The chat WebSocket while `enabled`. `send` is stable and returns false when the socket is not open. */
export function useChatSocket({ enabled, channelId, onEvent, onGiveUp }: Options) {
  const [connected, setConnected] = useState(false)
  const client = useRef<WsClient | null>(null)
  const handleEvent = useEffectEvent(onEvent)
  const handleGiveUp = useEffectEvent(() => onGiveUp?.())
  const currentChannel = useEffectEvent(() => channelId)

  useEffect(() => {
    if (!enabled) return
    const ws = new WsClient()
    client.current = ws
    ws.on('_open', () => {
      setConnected(true)
      const id = currentChannel()
      if (id) ws.send('join', { channelId: id })
    })
    ws.on('_close', () => setConnected(false))
    ws.on('_giveup', (data) => {
      if (!data.everOpened) handleGiveUp()
    })
    ws.on('_message', (frame) => handleEvent(frame as ChatEvent))
    return () => {
      ws.close()
      client.current = null
      setConnected(false)
    }
  }, [enabled])

  useEffect(() => {
    if (channelId) client.current?.send('join', { channelId })
  }, [channelId])

  const send = useCallback(
    (type: string, data?: Record<string, unknown>) => client.current?.send(type, data) ?? false,
    [],
  )
  return { connected, send }
}

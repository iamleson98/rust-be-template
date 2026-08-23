/**
 * useAdminChatWs — WebSocket subscription hook for the admin chat
 * workspace.
 *
 * Connects the admin to the chat WS hub (same `/ws` endpoint the
 * customer-facing chat widget uses) so the admin sees:
 *   - New user messages in realtime (no polling)
 *   - Typing indicators from users
 *   - Online/offline presence changes
 *
 * ## Room joining
 *
 * The WS hub broadcasts `message` / `typing` / `presence` events only
 * to sockets that have JOINED a channel's room (via `send('join', {channelId})`).
 * The admin must join the active channel's room to receive its events.
 *
 * When the admin selects a channel, this hook sends a `join` event.
 * When the admin switches to a different channel, the old room is
 * automatically left (the WS hub handles this — `set_channel` replaces
 * the previous channel).
 *
 * ## Query invalidation
 *
 * On receiving a WS `message` event, the hook invalidates the
 * relevant TanStack Query (channels list + active-channel messages).
 * This triggers a REST refetch — single source of truth (the REST
 * endpoint), instant UX (the WS pushes the invalidation).
 *
 * The hook is a no-op when `user` is null or when the user is not an
 * employee (customers use their own chat widget).
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WsClient } from '@/lib/ws-client'
import type { SessionUser } from '@/lib/api/types.gen'

type WsChatMessageEvent = {
  id: string
  channelId: string
  senderType: 'user' | 'employee' | 'system' | 'assistant'
  senderId?: string
  senderName?: string
  text?: string
  content?: string
  createdAt?: string
}

type WsTypingEvent = {
  channelId: string
  name: string
  isTyping: boolean
}

type WsPresenceEvent = {
  channelId: string
  userId: string
  online: boolean
}

export function useAdminChatWs(
  user: SessionUser | null,
  activeChannelId: string | null | undefined,
) {
  const qc = useQueryClient()
  const wsRef = useRef<WsClient | null>(null)
  const [typingUser, setTypingUser] = useState<{ name: string } | null>(null)
  const [userOnline, setUserOnline] = useState(false)

  // Create the WS connection once when the admin logs in.
  useEffect(() => {
    if (!user) return
    if (user.type !== 'employee') return

    let disposed = false
    const ws = new WsClient()
    wsRef.current = ws

    ws.on('message', (msg: Record<string, unknown>) => {
      if (disposed) return
      const m = msg as unknown as WsChatMessageEvent
      if (!m.channelId) return

      // Invalidate channels list (unread badges update).
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })

      // Invalidate messages for the active channel.
      if (activeChannelId && m.channelId === activeChannelId) {
        qc.invalidateQueries({ queryKey: [{ _id: 'listMessages' }] })
      }
    })

    ws.on('typing', (data: Record<string, unknown>) => {
      if (disposed) return
      const d = data as unknown as WsTypingEvent
      if (activeChannelId && d.channelId === activeChannelId) {
        setTypingUser(d.isTyping ? { name: d.name } : null)
      }
    })

    ws.on('presence', (data: Record<string, unknown>) => {
      if (disposed) return
      const d = data as unknown as WsPresenceEvent
      if (activeChannelId && d.channelId === activeChannelId) {
        setUserOnline(d.online)
      }
      // Refresh channels list when presence changes (new customer online).
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })
    })

    return () => {
      disposed = true
      ws.close()
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Join the active channel's room when it changes.
  useEffect(() => {
    if (!wsRef.current?.connected || !activeChannelId) return
    wsRef.current.send('join', { channelId: activeChannelId })
    // Reset typing/online state when switching channels.
    setTypingUser(null)
    setUserOnline(false)
  }, [activeChannelId])

  // Send typing indicator when admin types.
  const sendTyping = (channelId: string, isTyping: boolean) => {
    if (!wsRef.current?.connected) return
    wsRef.current.send('typing', { channelId, isTyping })
  }

  return {
    typingUser,
    userOnline,
    sendTyping,
  }
}

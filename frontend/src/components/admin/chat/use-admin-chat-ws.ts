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
 *
 * ## Query invalidation
 *
 * On receiving a WS `message` event, the hook invalidates the
 * relevant TanStack Query (channels list + active-channel messages).
 * This triggers a REST refetch — single source of truth, instant UX.
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { WsClient } from '@/lib/ws-client'
import { useMarkChatRead } from '@/lib/queries'
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
  const markReadMut = useMarkChatRead()

  // CRITICAL: Use a ref for activeChannelId so the WS event handlers
  // (which are registered once when the WS connects) always see the
  // LATEST value. Without a ref, the closures capture the initial
  // activeChannelId (undefined) and never update — so the admin never
  // receives messages/typing/presence for the selected channel.
  const activeChannelIdRef = useRef(activeChannelId)
  activeChannelIdRef.current = activeChannelId

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

      // Always invalidate channels list (unread badges update).
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })

      // Invalidate messages for the active channel (using ref).
      const activeId = activeChannelIdRef.current
      if (activeId && m.channelId === activeId) {
        qc.invalidateQueries({ queryKey: [{ _id: 'listMessages' }] })
        // Auto-mark as read — the admin is viewing this channel,
        // so the unread badge should NOT increment.
        if (m.senderType !== 'employee') {
          markReadMut.mutate({ path: { id: activeId } } as any)
        }
      }
    })

    // ── Attention signal: a customer sent a message in some channel ──
    //
    // `channel_message` is broadcast to ALL online employees (not
    // just the room). It fires whether or not the admin has the
    // channel open. We use it to:
    //   - Invalidate the channels list (so the unread badge +
    //     last_message_preview update for the channel row).
    //   - Show a toast notification when the admin has NO active
    //     channel open OR is viewing a different channel — this is
    //     the "new message arrived, click to open" attention grab.
    //
    // When the admin already has this channel open, the `message`
    // event above already handled the per-message UI update; this
    // invalidation is a harmless duplicate (TanStack dedupes).
    ws.on('channel_message', (data: Record<string, unknown>) => {
      if (disposed) return
      const d = data as unknown as {
        channelId: string
        senderName?: string
        preview?: string
      }
      if (!d.channelId) return

      // Always refetch the channels list — the row's last_message_preview
      // + unread counter need to update.
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })

      // Only show the toast attention signal when the admin is NOT
      // already viewing this channel. If they're viewing it, the
      // `message` handler already handled the UI + auto-mark-read.
      const activeId = activeChannelIdRef.current
      if (!activeId || activeId !== d.channelId) {
        const name = d.senderName ?? 'Khách hàng'
        const preview = d.preview ?? ''
        // Truncate the preview to keep the toast compact.
        const snippet = preview.length > 60 ? preview.slice(0, 60) + '…' : preview
        toast.info(`Tin nhắn mới từ ${name}`, {
          description: snippet,
          duration: 5000,
        })
      }
    })

    ws.on('typing', (data: Record<string, unknown>) => {
      if (disposed) return
      const d = data as unknown as WsTypingEvent & { userId?: string }
      // Filter out typing events from OUR OWN user id — same reason
      // as the customer-side hook (multi-tab scenario).
      if (user && d.userId && d.userId === user.id) return
      const activeId = activeChannelIdRef.current
      if (activeId && d.channelId === activeId) {
        setTypingUser(d.isTyping ? { name: d.name } : null)
      }
    })

    ws.on('presence', (data: Record<string, unknown>) => {
      if (disposed) return
      const d = data as unknown as WsPresenceEvent
      const activeId = activeChannelIdRef.current
      if (activeId && d.channelId === activeId) {
        setUserOnline(d.online)
      }
      // Refresh channels list when presence changes.
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })
    })

    // Listen for `channel_created` events — broadcast to ALL sockets
    // when a new channel is created via REST. This lets the admin's
    // channel list auto-refetch without polling.
    ws.on('channel_created', () => {
      if (disposed) return
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
    if (!activeChannelId) return
    const ws = wsRef.current
    if (!ws) return

    const doJoin = () => {
      ws.send('join', { channelId: activeChannelId })
    }

    if (ws.connected) {
      doJoin()
    } else {
      // WS not yet connected — wait for _open then join.
      const handler = () => {
        doJoin()
        ws.off('_open', handler)
      }
      ws.on('_open', handler)
    }

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

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
 *
 * ## New-message attention signal (FB Messenger style)
 *
 * When a customer sends a message in a channel the admin is NOT
 * currently viewing, the hook:
 *   1. Plays a short message sound (via `playSound('message')`).
 *   2. Adds the channel id to the `unreadPulseChannels` set — the
 *      channel row in the list shows a pulsing blue dot until the
 *      admin opens that channel.
 *   3. Invalidates `listChannels` so the unread counter + last
 *      message preview update on the channel row.
 *
 * No toast notification — per user feedback, the indicator + sound
 * is enough; toasts are noisy when multiple messages arrive in quick
 * succession.
 */
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WsClient } from '@/lib/ws-client'
import { useMarkChatRead } from '@/lib/queries'
import { playSound } from '@/lib/sound-effects'
import { startTitleNotification, stopTitleNotification } from '@/lib/title-notifier'
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
  /**
   * Set of channel ids that have received a new customer message while
   * the admin was NOT viewing them. Used by the channel list to render
   * a pulsing blue dot on the row (Facebook Messenger style). Cleared
   * for a channel when the admin opens that channel.
   */
  const [unreadPulseChannels, setUnreadPulseChannels] = useState<Set<string>>(new Set())
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
    //   - Play a short message sound (Facebook Messenger style).
    //   - Add the channel id to `unreadPulseChannels` when the admin
    //     is NOT viewing it — the row shows a pulsing blue dot until
    //     the admin opens the channel.
    //
    // When the admin already has this channel open, the `message`
    // event above already handled the per-message UI update; we still
    // play the sound (so the admin hears the new message even if
    // they're scrolled away) but skip the pulse.
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

      // Play the message sound (FB Messenger style).
      playSound('message')

      // Flash the page title (messenger-style) so the admin notices
      // the new message even when the tab is in the background. The
      // flash auto-stops when the user focuses the tab.
      startTitleNotification(1)

      // Pulse indicator only when the admin is NOT already viewing
      // this channel. If they're viewing it, the `message` handler
      // already handled the UI + auto-mark-read.
      const activeId = activeChannelIdRef.current
      if (!activeId || activeId !== d.channelId) {
        setUnreadPulseChannels((prev) => {
          if (prev.has(d.channelId)) return prev
          const next = new Set(prev)
          next.add(d.channelId)
          return next
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

    // Stop the title-flash notification — the admin is now viewing
    // a channel, so the attention signal is no longer needed.
    stopTitleNotification()

    // Clear the pulse indicator for the now-active channel — the
    // admin is viewing it, so the "new message" pulse is no longer
    // needed.
    setUnreadPulseChannels((prev) => {
      if (!prev.has(activeChannelId)) return prev
      const next = new Set(prev)
      next.delete(activeChannelId)
      return next
    })
  }, [activeChannelId])

  // Send typing indicator when admin types.
  const sendTyping = (channelId: string, isTyping: boolean) => {
    if (!wsRef.current?.connected) return
    wsRef.current.send('typing', { channelId, isTyping })
  }

  // Allow the channel list to clear the pulse manually (e.g. on hover
  // or explicit dismiss). Currently only cleared on open via the effect
  // above, but exposed for future use.
  const clearUnreadPulse = useCallback((channelId: string) => {
    setUnreadPulseChannels((prev) => {
      if (!prev.has(channelId)) return prev
      const next = new Set(prev)
      next.delete(channelId)
      return next
    })
  }, [])

  return {
    typingUser,
    userOnline,
    sendTyping,
    unreadPulseChannels,
    clearUnreadPulse,
  }
}

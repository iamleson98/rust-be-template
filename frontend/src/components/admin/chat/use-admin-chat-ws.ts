/**
 * useAdminChatWs — WebSocket subscription hook for the admin chat
 * workspace.
 *
 * Connects the admin to the chat WS hub (same `/ws` endpoint the
 * customer-facing chat widget uses) so the admin sees new user
 * messages + new channels in realtime — no polling.
 *
 * On receiving a WS `message` event for the active channel, the hook
 * invalidates the TanStack Query for that channel's messages, which
 * triggers a refetch from the REST API. This gives us:
 *   - Instant "something arrived" signal (WS is fast).
 *   - Authoritative data from the REST endpoint (avoids double-
 *     source-of-truth issues that arise when you try to merge WS
 *     deltas into the query cache directly).
 *
 * On receiving a `message` event for ANY channel (active or not),
 * the hook invalidates the channels list query so the unread badge
 * updates.
 *
 * The hook is a no-op when `user` is null or when the user is not an
 * employee (customers use their own chat widget).
 */
'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WsClient } from '@/lib/ws-client'
import type { SessionUser } from '@/lib/api/types.gen'

import {
  listChannelsQueryKey,
  listMessagesQueryKey,
} from '@/lib/api/@tanstack/react-query.gen'

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

export function useAdminChatWs(
  user: SessionUser | null,
  activeChannelId: string | null | undefined,
) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!user) return
    // Only employees (admins/support) use this hook — customers use
    // their own chat widget which already has WS integration.
    if (user.type !== 'employee') return

    let disposed = false
    const ws = new WsClient()

    ws.on('_open', () => {
      if (!disposed) {
        // Connection established — no explicit "join" needed here
        // because the admin wants to receive broadcasts from ALL
        // channels, not just one. The WS hub broadcasts messages
        // to every socket in the room, and the admin's socket is
        // implicitly in the "global" room when not joined to a
        // specific channel.
        //
        // However, we DO want to join the active channel's room
        // so we receive its messages. Let's do that when the
        // activeChannelId changes (see separate effect below).
      }
    })

    ws.on('_close', () => {
      // The WsClient auto-reconnects — nothing to do here.
    })

    ws.on('message', (msg: Record<string, unknown>) => {
      if (disposed) return
      const m = msg as unknown as WsChatMessageEvent
      if (!m.channelId) return

      // Invalidate the channels list so the unread badge updates
      // for the channel that received the new message. Use partial
      // key match { _id: 'listChannels' } to match all channel queries.
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })

      // If the message is for the active channel, invalidate the
      // messages query so the new message appears in the workspace.
      // Use partial key match to catch all listMessages queries.
      if (activeChannelId && m.channelId === activeChannelId) {
        qc.invalidateQueries({
          queryKey: [{ _id: 'listMessages' }],
        })
      }
    })

    // Also listen for `joined` / `presence` events — when a new
    // customer opens a chat, the channels list should refresh so
    // the admin sees the new channel immediately.
    ws.on('presence', () => {
      if (disposed) return
      qc.invalidateQueries({ queryKey: [{ _id: 'listChannels' }] })
    })

    return () => {
      disposed = true
      ws.close()
    }
  }, [user, qc, activeChannelId])
}

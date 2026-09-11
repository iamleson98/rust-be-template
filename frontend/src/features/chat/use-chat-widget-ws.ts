'use client'

/**
 * useChatWidgetWs — customer-side WebSocket wiring for the chat widget.
 *
 * Extracted from the original `chat-widget.tsx`. Owns the single
 * `useEffect` that:
 *   - Creates the `WsClient` (cookie-based auth, auto-connects).
 *   - Subscribes to every hub event the customer surface reacts to:
 *     `message` (query invalidation + sound + notification + title
 *     flash), `typing`, `joined`, `channel_assigned` /
 *     `channel_released` / `channel_closed` (three-role routing),
 *     `staff_presence`, `presence`, `error` and the abuse-guard
 *     `abuse:warned` / `abuse:banned` events.
 *   - Cleans up on unmount (close socket, clear the typing-throttle
 *     timer).
 *
 * All React state touched by the WS handlers lives in the orchestrator
 * (`ChatWidget`) — this hook receives the refs + setters it needs and
 * returns nothing. The query client is taken from context (same
 * instance the orchestrator holds).
 */

import { useEffect, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { WsClient } from '@/lib/ws-client'
import { playSound } from '@/lib/sound-effects'
import { notifyChatMessage } from '@/lib/notifications'
import { startTitleNotification } from '@/lib/title-notifier'
import type { SessionUser } from '@/lib/api/types.gen'
import { type CustomerChannel as Channel, normalizeWsMessage } from './_shared'

export function useChatWidgetWs({
  chatOpen,
  chatUser,
  socketRef,
  activeChannelRef,
  typingTimerRef,
  isCurrentlyTypingRef,
  setConnected,
  setTyping,
  setWaitingForAgent,
  setAgentJoinedName,
  setEmployeesOnline,
  setBotActive,
  setAssignee,
  setInput,
}: {
  chatOpen: boolean
  chatUser: SessionUser | null
  socketRef: RefObject<WsClient | null>
  activeChannelRef: RefObject<Channel | null>
  typingTimerRef: RefObject<ReturnType<typeof setTimeout> | null>
  isCurrentlyTypingRef: RefObject<boolean>
  setConnected: (connected: boolean) => void
  setTyping: (typing: { name: string } | null) => void
  setWaitingForAgent: (waiting: boolean) => void
  setAgentJoinedName: (name: string | null) => void
  setEmployeesOnline: (count: number) => void
  setBotActive: (active: boolean) => void
  setAssignee: (assignee: { id: string; name: string; role: string } | null) => void
  setInput: (input: string) => void
}) {
  const qc = useQueryClient()

  // ─── Connect native WebSocket (cookie-based auth) ─────
  useEffect(() => {
    if (!chatOpen || !chatUser) return
    let disposed = false

    // Create the WsClient — it auto-connects in the constructor.
    // In React StrictMode (dev), effects are double-invoked:
    //   mount → unmount → mount.
    // The unmount calls ws.close() which may close a still-CONNECTING
    // socket. WsClient.close() handles this gracefully (see ws-client.ts).
    const ws = new WsClient()
    socketRef.current = ws

    ws.on('_open', () => {
      if (!disposed) setConnected(true)
    })
    ws.on('_close', () => {
      if (!disposed) setConnected(false)
    })

    ws.on('_giveup', (data: Record<string, unknown>) => {
      if (disposed) return
      if (!data.everOpened) {
        setConnected(false)
        // Force a refetch of /api/auth/me — if it errors, the
        // session has expired and the user must re-login.
        qc.invalidateQueries({ queryKey: ['me'] })
      }
    })

    ws.on('message', (msg: Record<string, unknown>) => {
      const m = normalizeWsMessage(msg)
      if (activeChannelRef.current && m.channelId === activeChannelRef.current.id) {
        if (m.senderType === 'employee') {
          setWaitingForAgent(false)
          setAgentJoinedName(m.senderName ?? null)
        }
        // Browser push notification when page is in background.
        if (m.senderType !== 'user') {
          notifyChatMessage(m.senderName ?? 'Nhân viên hỗ trợ', m.content || '')
          // Flash the page title (messenger-style) so the user notices
          // the new message even when the tab is in the background.
          startTitleNotification(1)
        }
        // Sound effect on new message.
        playSound('message')
      } else {
        // Message from a different channel — show a notification.
        if (m.senderType !== 'user') {
          notifyChatMessage(m.senderName ?? 'Nhân viên hỗ trợ', m.content || '')
          startTitleNotification(1)
          playSound('message')
        }
      }
      // Invalidate the messages query using the CORRECT query key.
      // The old code used ['listMessages'] (a string) but the actual
      // key is a complex object from listMessagesQueryKey(). Using
      // the partial key `{ _id: 'listMessages' }` matches all
      // listMessages queries regardless of the path/query params.
      qc.invalidateQueries({
        queryKey: [{ _id: 'listMessages' }],
      })
      qc.invalidateQueries({
        queryKey: [{ _id: 'listChannels' }],
      })
    })

    ws.on('typing', (data: Record<string, unknown>) => {
      const d = data as unknown as {
        channelId: string
        name: string
        isTyping: boolean
        userId?: string
      }
      // Filter out typing events from OUR OWN user id — the backend
      // already excludes our socket via `broadcast_to_room_except`,
      // but if the user has multiple tabs open (each with its own
      // socket in the room), tab A's typing would otherwise bounce
      // back to tab B. Filtering by userId catches that case.
      if (chatUser && d.userId && d.userId === chatUser.id) return
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        setTyping(d.isTyping ? { name: d.name } : null)
      }
    })

    ws.on('joined', (data: Record<string, unknown>) => {
      const d = data as unknown as {
        channelId: string
        onlineEmployees?: number
        availableEmployees?: number
        botActive?: boolean
      }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        setEmployeesOnline(d.onlineEmployees ?? 0)
        setBotActive(!!d.botActive)
        setWaitingForAgent(false)
      }
    })

    // ── Assignment events (three-role routing) ──────────────────
    //
    // `channel_assigned` fires when the router picks a staff member
    // for this channel (first message) or someone claims it. Show
    // who's handling the conversation in the header.
    ws.on('channel_assigned', (data: Record<string, unknown>) => {
      const d = data as unknown as {
        channelId: string
        employeeId?: string
        employeeName?: string
        role?: string
      }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        if (d.employeeId && d.employeeName) {
          setAssignee({ id: d.employeeId, name: d.employeeName, role: d.role ?? 'employee' })
        } else {
          setAssignee(null)
        }
        // A human taking over means the bot isn't the responder.
        setBotActive(false)
      }
    })

    ws.on('channel_released', (data: Record<string, unknown>) => {
      const d = data as unknown as { channelId: string }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        setAssignee(null)
      }
    })

    ws.on('channel_closed', (data: Record<string, unknown>) => {
      const d = data as unknown as { channelId: string }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        setAssignee(null)
      }
    })

    // Customer-side presence snapshot: the hub only sends
    // staff_presence to staff sockets, but the per-channel
    // `joined`/assignment events above cover the customer's needs
    // (who handles my chat). Keep bot status in sync via
    // presence events from the room.
    ws.on('staff_presence', (data: Record<string, unknown>) => {
      const d = data as unknown as { botActive?: boolean }
      if (typeof d?.botActive === 'boolean') setBotActive(d.botActive)
    })

    ws.on('presence', (data: Record<string, unknown>) => {
      const d = data as unknown as { channelId: string; online: boolean }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id && d.online) {
        setWaitingForAgent(false)
      }
    })

    ws.on('error', (data: Record<string, unknown>) => {
      const d = data as unknown as { code?: string; message?: string }
      if (d?.message) toast.error(d.message)
    })

    // ── Abuse-guard events ──────────────────────────────────────
    ws.on('abuse:warned', (data: Record<string, unknown>) => {
      const d = data as unknown as { reason?: string }
      if (d?.reason) {
        toast.warning(`Cảnh báo: ${d.reason}`, { duration: 6000 })
      }
    })

    ws.on('abuse:banned', (data: Record<string, unknown>) => {
      const d = data as unknown as { reason?: string }
      const reason = d?.reason ?? 'Tài khoản tạm khóa do vi phạm quy định chat.'
      toast.error(reason, { duration: 12000 })
      setInput('')
    })

    return () => {
      disposed = true
      ws.close()
      socketRef.current = null
      setConnected(false)
      // Clear the typing throttle timer so it doesn't fire against a
      // closed socket (would log a warning + do nothing useful).
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current)
        typingTimerRef.current = null
      }
      isCurrentlyTypingRef.current = false
    }
    // qc is intentionally excluded from deps — it's a stable reference
    // (useQueryClient returns the same instance for the app's lifetime).
    // Including it would cause the effect to re-run unnecessarily (e.g.
    // when React StrictMode double-invokes effects in dev).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen, chatUser])
}

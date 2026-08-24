'use client'

/**
 * ChatWidget — the customer-facing floating support chat panel.
 *
 * Top-level orchestrator. Owns:
 *   - The chat session user + auth bootstrap (`useAuthMe`)
 *   - The WebSocket connection (via `WsClient`)
 *   - The channels list + active channel + messages state — all backed
 *     by TanStack Query (`useChatChannels`, `useChatMessages`).
 *   - Guest registration + message send/typing handlers (mutations
 *     via TanStack Query: `useRegister`, `useCreateChatChannel`,
 *     `usePostChatMessage`, `useMarkChatRead`).
 *
 * Rendering is delegated to dedicated sub-components under `chat/`:
 *   - ChatHeader            — top bar (connection status, minimize/close)
 *   - ChatList              — channel list view
 *   - ChatConversation       — conversation view (messages, banners)
 *   - ChatInput             — input bar + quick-action chips
 *   - ChatAuthView / ChatLoginRequiredView — auth gate views
 *
 * The widget returns `null` for employees (they use the admin workspace).
 *
 * ## Data flow
 *
 * ```text
 *   useAuthMe() ──────────────────────► chatUser (verified session)
 *   useChatChannels() ────────────────► channels list (REST, cached)
 *   useChatMessages(activeChannel) ───► messages (REST, cached)
 *   WsClient.on('message') ──────────► invalidate queries → REST refetch
 *   usePostChatMessage.mutate() ─────► POST + invalidate → REST refetch
 *   useCreateChatChannel.mutate() ───► POST + invalidate → REST refetch
 *   useMarkChatRead.mutate() ────────► POST + invalidate → REST refetch
 *   useRegister.mutate() ────────────► POST → set chatUser
 * ```
 *
 * TanStack Query handles loading/error/refetch states. The widget
 * just renders the appropriate UI based on the query states.
 */

import { useEffect, useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WsClient } from '@/lib/ws-client'
import { useApp } from '@/lib/store'
import { toast } from 'sonner'
import { Headset } from 'lucide-react'
import { playSound } from '@/lib/sound-effects'
import { notifyChatMessage } from '@/lib/notifications'
import { startTitleNotification, stopTitleNotification } from '@/lib/title-notifier'
import type { SessionUser } from '@/lib/api/types.gen'
import {
  useAuthMe,
  useRegister,
  useChatChannels,
  useChatMessages,
  useCreateChatChannel,
  usePostChatMessage,
  useMarkChatRead,
} from '@/lib/queries'
import {
  listMessagesQueryKey,
} from '@/lib/api/@tanstack/react-query.gen'
import {
  type CustomerChannel as Channel,
  type Message,
  type View,
  normalizeWsMessage,
} from './_shared'
import { ChatHeader } from './chat-header'
import { ChatList } from './chat-list'
import { ChatConversation } from './chat-conversation'
import { ChatInput } from './chat-input'
import { ChatAuthView, ChatLoginRequiredView } from './chat-auth'

export function ChatWidget() {
  const { chatOpen, setChatOpen, user: storeUser, setUser: setStoreUser } = useApp()
  const qc = useQueryClient()

  // The chat session user. Initialised from storeUser so the first
  // open is instant — `useAuthMe` verifies it asynchronously.
  const [chatUser, setChatUser] = useState<SessionUser | null>(
    (storeUser as SessionUser | null) ?? null,
  )

  // Pre-chat registration form
  const [regName, setRegName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regError, setRegError] = useState<string | null>(null)

  const [connected, setConnected] = useState(false)
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState<{ name: string } | null>(null)
  const [view, setView] = useState<View>('list')
  const [showQuickActions, setShowQuickActions] = useState(false)

  // Agent presence / waiting-for-agent UI
  const [waitingForAgent, setWaitingForAgent] = useState(false)
  const [employeesOnline, setEmployeesOnline] = useState(0)
  const [agentJoinedName, setAgentJoinedName] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WsClient | null>(null)
  const activeChannelRef = useRef<Channel | null>(null)
  // Panel container for focus trap + ESC handling.
  const panelRef = useRef<HTMLDivElement>(null)
  // Remember the element that had focus before opening, so we can restore it
  // on close (WCAG 2.4.3 — focus order).
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // ── Typing broadcast throttle ──────────────────────────────────
  //
  // Only broadcast `typing=true` on the FIRST keystroke after becoming
  // idle (not on every keystroke — that was wasteful for bandwidth).
  // After `TYPING_IDLE_MS` of inactivity, broadcast `typing=false`
  // so the admin's UI stops showing the typing indicator. Same
  // pattern as the admin side (see `use-admin-chat-workspace.ts`).
  const TYPING_IDLE_MS = 2000
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isCurrentlyTypingRef = useRef(false)

  useEffect(() => {
    activeChannelRef.current = activeChannel
  }, [activeChannel])

  // ── Auth bootstrap: verify the session via /api/auth/me ──────────
  // useAuthMe handles loading/error/data states. We derive chatUser
  // + view from its result.
  const authMe = useAuthMe()
  useEffect(() => {
    if (!chatOpen) return
    // Hide the chat button entirely for employees (they have the admin workspace)
    if (chatUser?.type === 'employee') return

    if (authMe.isLoading) return
    if (authMe.error) {
      setChatUser(null)
      setView('login-required')
      return
    }
    if (authMe.data?.user) {
      const u = authMe.data.user as unknown as SessionUser
      setChatUser(u)
      if (!storeUser) setStoreUser(u as any)
      setView('list')
    }
  }, [chatOpen, authMe.isLoading, authMe.error, authMe.data, chatUser, storeUser, setStoreUser])

  // Hide the chat button entirely for employees (they have the admin workspace)
  const isEmployee = storeUser?.type === 'employee' || chatUser?.type === 'employee'

  // ─── ESC to close + focus trap (WCAG 2.1.2 + 2.4.3) ───
  useEffect(() => {
    if (!chatOpen) return
    triggerRef.current = document.activeElement as HTMLButtonElement | null

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setChatOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      const visible = Array.from(focusable).filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      if (visible.length === 0) return
      const first = visible[0]
      const last = visible[visible.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    const t = setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    }, 50)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      clearTimeout(t)
      triggerRef.current?.focus()
    }
  }, [chatOpen, setChatOpen])

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
      const d = data as unknown as { channelId: string; onlineEmployees?: number }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        setEmployeesOnline(d.onlineEmployees ?? 0)
        setWaitingForAgent(false)
      }
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

  // ── Channels list via TanStack Query ──────────────────────────────
  const channelsQuery = useChatChannels(50)
  const channels: Channel[] = (channelsQuery.data?.items ?? []) as unknown as Channel[]

  // ── Messages for the active channel via TanStack Query ───────────
  const messagesQuery = useChatMessages(activeChannel?.id, 50)
  const messages: Message[] = (messagesQuery.data?.items ?? []) as unknown as Message[]
  const loadingMessages = messagesQuery.isLoading

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, typing, waitingForAgent])

  // ── Mutations ─────────────────────────────────────────────────────
  const registerMut = useRegister({
    onSuccess: (data: any) => {
      const u = data?.user as SessionUser | undefined
      if (!u) return
      setChatUser(u)
      if (!storeUser) setStoreUser(u as any)
      setView('list')
      toast.success(`Chào ${u.name}, bạn đã có thể bắt đầu trò chuyện!`)
    },
    onError: (err: any) => {
      const code = err?.code
      if (code === 'PHONE_EXISTS') {
        setRegError('Số điện thoại đã đăng ký. Vui lòng đăng nhập.')
      } else if (code === 'EMAIL_EXISTS') {
        setRegError('Email đã đăng ký. Vui lòng đăng nhập.')
      } else {
        setRegError(err?.message || 'Không thể tạo tài khoản. Vui lòng thử lại.')
      }
    },
  })

  const createChannelMut = useCreateChatChannel({
    onError: (err: any) => {
      toast.error(err?.message ?? 'Không thể tạo kênh chat')
    },
  })

  const postMessageMut = usePostChatMessage({
    onError: () => {
      toast.error('Không thể gửi tin nhắn')
    },
  })

  const markReadMut = useMarkChatRead()

  // ─── Pre-chat registration form submit ─────────────────────────────
  const submitGuestRegistration = () => {
    setRegError(null)
    const name = regName.trim()
    const phone = regPhone.trim()
    const email = regEmail.trim().toLowerCase()
    if (name.length < 2) {
      setRegError('Vui lòng nhập họ tên (ít nhất 2 ký tự).')
      return
    }
    if (!phone && !email) {
      setRegError('Vui lòng cung cấp số điện thoại hoặc email.')
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRegError('Email không hợp lệ.')
      return
    }
    registerMut.mutate({
      body: {
        fullName: name,
        email: email || undefined,
        phone: phone || undefined,
        password:
          Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      },
    } as any)
  }

  const openChannel = async (ch: Channel) => {
    setActiveChannel(ch)
    setView('conversation')
    setShowQuickActions(true)
    setWaitingForAgent(false)
    setAgentJoinedName(null)
    setEmployeesOnline(0)
    // Stop the title-flash notification — the user is now viewing the
    // chat, so the attention signal is no longer needed.
    stopTitleNotification()
    if (socketRef.current) {
      if (socketRef.current.connected) {
        socketRef.current.send('join', { channelId: ch.id })
      } else {
        // WS still connecting — join once it's open.
        const joinHandler = () => {
          socketRef.current?.send('join', { channelId: ch.id })
          socketRef.current?.off('_open', joinHandler)
        }
        socketRef.current.on('_open', joinHandler)
      }
    }
    markReadMut.mutate({ path: { id: ch.id } } as any)
    // Optimistically clear the unread badge in the cache — the
    // mutation's onSuccess will refetch from the server to confirm.
    // Use the correct query key format (partial match on _id).
    qc.setQueryData<any>(
      [{ _id: 'listChannels' }],
      (old: any) => {
        if (!old?.items) return old
        return {
          ...old,
          items: old.items.map((c: any) =>
            c.id === ch.id ? { ...c, unreadUser: 0 } : c
          ),
        }
      },
    )
  }

  const startNewChat = async () => {
    if (!chatUser) return
    // Prefer opening an existing open channel — backend enforces 1
    // open channel per user, but checking here first avoids a round-trip.
    const existingOpen = channels.find((c) => c.status === 'open')
    if (existingOpen) {
      openChannel(existingOpen)
      return
    }
    // No existing open channel — create one via TanStack mutation.
    // The mutation's onSuccess invalidates the channels list so the
    // new channel appears immediately.
    createChannelMut.mutate(
      { body: { topic: 'Hỗ trợ đặt vé', brandId: null } } as any,
      {
        onSuccess: (data: any) => {
          if (data?.channel) {
            openChannel(data.channel)
          }
        },
      },
    )
  }

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || !activeChannel) return
    setInput('')
    // Clear typing indicator after sending.
    setTyping(null)
    // Reset the typing throttle state + cancel any pending idle
    // timer so we don't send a stale `typing=false` after the
    // message has been sent.
    isCurrentlyTypingRef.current = false
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }
    // Send typing=false so the admin sees the user stopped typing.
    if (socketRef.current?.connected) {
      socketRef.current.send('typing', { channelId: activeChannel.id, isTyping: false })
    }
    const clientMsgId = 'c' + Date.now() + Math.random().toString(36).slice(2, 6)

    // ── Optimistic message ──────────────────────────────────────
    // Add the message to the TanStack Query cache IMMEDIATELY so the
    // user sees it in his chat box without waiting for the WS round-trip
    // or REST refetch. The WS broadcast or REST response will replace
    // this optimistic entry (matched by clientMsgId).
    const optimisticMsg: Message = {
      id: 'tmp-' + clientMsgId,
      clientMsgId,
      channelId: activeChannel.id,
      senderType: 'user',
      senderId: chatUser?.id ?? '',
      senderName: chatUser?.name ?? 'Bạn',
      content,
      kind: 'text',
      createdAt: new Date().toISOString(),
    }

    // Insert into the query cache optimistically. Use the correct
    // query key format (the generated key is an object array, not a
    // string array). We match by partial key { _id: 'listMessages' }.
    const msgQueryKey = listMessagesQueryKey({
      path: { id: activeChannel.id },
      query: { limit: 50 },
    })
    qc.setQueryData<any>(msgQueryKey, (old: any) => {
      if (!old?.items) return old
      if (old.items.some((m: any) => m.clientMsgId === clientMsgId)) return old
      return { ...old, items: [...old.items, optimisticMsg] }
    })

    // ── Try WS first (fast path) ────────────────────────────────
    if (socketRef.current?.connected) {
      socketRef.current.send('message', {
        channelId: activeChannel.id,
        text: content,
        clientMsgId,
      })
      // The WS broadcast will come back and invalidate the query —
      // replacing the optimistic message with the real one.
      return
    }

    // ── REST fallback (WS not connected) ────────────────────────
    // TanStack mutation handles the POST + invalidation.
    postMessageMut.mutate({
      path: { id: activeChannel.id },
      body: {
        content,
        kind: 'text',
        clientMsgId,
      },
    } as any)
  }

  const onInputTyping = (val: string) => {
    setInput(val)

    const channel = activeChannelRef.current
    if (!channel || !socketRef.current?.connected) return

    // Only send `typing=true` on the FIRST keystroke after becoming
    // idle. Subsequent keystrokes just reset the idle timer (we're
    // still typing — the admin already knows).
    if (!isCurrentlyTypingRef.current) {
      isCurrentlyTypingRef.current = true
      socketRef.current.send('typing', { channelId: channel.id, isTyping: true })
    }

    // Reset the idle timer — when it fires (2s of inactivity),
    // broadcast `typing=false` + reset the flag so the next keystroke
    // triggers a fresh `typing=true`.
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      isCurrentlyTypingRef.current = false
      const ch = activeChannelRef.current
      if (ch && socketRef.current?.connected) {
        socketRef.current.send('typing', { channelId: ch.id, isTyping: false })
      }
    }, TYPING_IDLE_MS)
  }

  // ─── Render: hidden for employees ──────────────────────────────────
  if (isEmployee && !chatOpen) return null
  if (isEmployee) return null

  // ─── Render: closed (floating button) ──────────────────────────────
  if (!chatOpen) {
    return (
      <button
        onClick={() => {
          setChatOpen(true)
          // Stop the title-flash notification — the user is now
          // opening the chat widget, so the attention signal is no
          // longer needed.
          stopTitleNotification()
        }}
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-linear-to-br from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white flex items-center justify-center transition-transform group"
        aria-label="Mở chat hỗ trợ"
      >
        <Headset className="h-6 w-6" />
        <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse" />
        <span className="absolute right-16 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          Hỗ trợ trực tuyến
        </span>
      </button>
    )
  }

  // ─── Render: open chat panel ───────────────────────────────────────
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Hỗ trợ VeXeVN"
      className="fixed bottom-0 right-0 sm:bottom-5 sm:right-5 z-50 w-full sm:w-100 h-screen sm:h-150 sm:max-h-[85vh] bg-white sm:rounded-2xl ring-1 ring-black/10 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-300"
    >
      <ChatHeader
        view={view}
        activeChannel={activeChannel}
        connected={connected}
        employeesOnline={employeesOnline}
        onMinimize={() => setChatOpen(false)}
        onClose={() => setChatOpen(false)}
        onBackToList={() => {
          setView('list')
          setActiveChannel(null)
        }}
      />

      {view === 'auth' || authMe.isLoading ? (
        <ChatAuthView
          authChecking={authMe.isLoading}
          regName={regName}
          regPhone={regPhone}
          regEmail={regEmail}
          regError={regError}
          regSubmitting={registerMut.isPending}
          onSetName={setRegName}
          onSetPhone={setRegPhone}
          onSetEmail={setRegEmail}
          onSubmit={submitGuestRegistration}
        />
      ) : view === 'login-required' ? (
        <ChatLoginRequiredView
          onLogin={() => {
            useApp.getState().setAuthOpen(true)
            setChatOpen(false)
          }}
        />
      ) : view === 'list' ? (
        <ChatList
          channels={channels}
          onOpenChannel={openChannel}
          onStartNewChat={startNewChat}
        />
      ) : (
        <>
          <ChatConversation
            scrollRef={scrollRef}
            loadingMessages={loadingMessages}
            messages={messages}
            typing={typing}
            waitingForAgent={waitingForAgent}
            agentJoinedName={agentJoinedName}
            employeesOnline={employeesOnline}
          />
          <ChatInput
            input={input}
            onInputChange={onInputTyping}
            onSend={sendMessage}
            sending={postMessageMut.isPending}
            showQuickActions={showQuickActions && messages.length === 0 && !loadingMessages}
            onQuickAction={(msg) => {
              setInput(msg)
              sendMessage(msg)
              setShowQuickActions(false)
            }}
          />
        </>
      )}
    </div>
  )
}

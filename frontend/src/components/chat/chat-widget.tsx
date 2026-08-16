'use client'

/**
 * ChatWidget — the customer-facing floating support chat panel.
 *
 * Top-level orchestrator. Owns:
 *   - The chat session user + auth bootstrap (`/api/auth/me`)
 *   - The WebSocket connection (via `WsClient`)
 *   - The channels list + active channel + messages state
 *   - Guest registration + message send/typing handlers
 *
 * Rendering is delegated to dedicated sub-components under `chat/`:
 *   - ChatHeader            — top bar (connection status, minimize/close)
 *   - ChatList              — channel list view
 *   - ChatConversation       — conversation view (messages, banners)
 *   - ChatInput             — input bar + quick-action chips
 *   - ChatAuthView / ChatLoginRequiredView — auth gate views
 *
 * The widget returns `null` for employees (they use the admin workspace).
 */

import { useEffect, useState, useRef } from 'react'
import { WsClient } from '@/lib/ws-client'
import { useApp } from '@/lib/store'
import { toast } from 'sonner'
import { Headset } from 'lucide-react'
import type { SessionUser } from '@/lib/api/types.gen'
import {
  type Channel,
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

  // The chat session user (may differ briefly from storeUser after guest
  // registration — we keep a local copy to avoid race conditions).
  const [chatUser, setChatUser] = useState<SessionUser | null>(null)
  const [authChecking, setAuthChecking] = useState(false)

  // Pre-chat registration form
  const [regName, setRegName] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regSubmitting, setRegSubmitting] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)

  const [connected, setConnected] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState<{ name: string } | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [view, setView] = useState<View>('list')
  const [sending, setSending] = useState(false)
  const [showQuickActions, setShowQuickActions] = useState(false)

  // Agent presence / waiting-for-agent UI
  const [waitingForAgent, setWaitingForAgent] = useState(false)
  const [employeesOnline, setEmployeesOnline] = useState(0)
  const [agentJoinedName, setAgentJoinedName] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WsClient | null>(null)
  const lastMsgIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const activeChannelRef = useRef<Channel | null>(null)
  // Panel container for focus trap + ESC handling.
  const panelRef = useRef<HTMLDivElement>(null)
  // Remember the element that had focus before opening, so we can restore it
  // on close (WCAG 2.4.3 — focus order).
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    activeChannelRef.current = activeChannel
  }, [activeChannel])

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

  // Hide the chat button entirely for employees (they have the admin workspace)
  const isEmployee = storeUser?.type === 'employee' || chatUser?.type === 'employee'

  // ─── On chat open: verify auth via `/api/auth/me` ───
  useEffect(() => {
    if (!chatOpen) return
    if (isEmployee) return // employees don't use this widget
    if (chatUser) return // already loaded

    let cancelled = false
    setAuthChecking(true)
    setRegError(null)
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 401) {
          setChatUser(null)
          setView('login-required')
          setAuthChecking(false)
          return
        }
        if (!r.ok) {
          setRegError('Không thể kết nối đến dịch vụ chat. Vui lòng thử lại.')
          setAuthChecking(false)
          return
        }
        const data = await r.json()
        setChatUser(data.user as SessionUser)
        if (data.user && !storeUser) setStoreUser(data.user)
        setView('list')
        setAuthChecking(false)
      })
      .catch(() => {
        if (cancelled) return
        setRegError('Lỗi mạng khi kiểm tra phiên đăng nhập.')
        setAuthChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatOpen, isEmployee, chatUser, storeUser, setStoreUser])

  // ─── Connect native WebSocket (cookie-based auth) ─────
  useEffect(() => {
    if (!chatOpen || !chatUser) return
    let disposed = false

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
        fetch('/api/auth/me', { credentials: 'include' })
          .then((r) => {
            if (r.status === 401) {
              setView('login-required')
              ws.close()
              socketRef.current = null
            }
          })
          .catch(() => {})
      }
    })

    ws.on('message', (msg: Record<string, unknown>) => {
      const m = normalizeWsMessage(msg)
      if (activeChannelRef.current && m.channelId === activeChannelRef.current.id) {
        setMessages((prev) => {
          if (prev.some((x) => x.id === m.id && !x.id.startsWith('tmp-'))) return prev
          if (m.clientMsgId) {
            const idx = prev.findIndex(
              (x) => x.clientMsgId === m.clientMsgId && x.id.startsWith('tmp-'),
            )
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = m
              return next
            }
          }
          return [...prev, m]
        })
        if (m.senderType === 'employee') {
          setWaitingForAgent(false)
          setAgentJoinedName(m.senderName ?? null)
        }
      }
    })

    ws.on('typing', (data: Record<string, unknown>) => {
      const d = data as unknown as { channelId: string; name: string; isTyping: boolean }
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

    return () => {
      disposed = true
      ws.close()
      socketRef.current = null
      setConnected(false)
    }
  }, [chatOpen, chatUser])

  // ─── Load channel list via REST ────────────────────────────────────
  useEffect(() => {
    if (!chatOpen || !chatUser) return
    let cancelled = false
    fetch('/api/chat/channels?limit=50', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setChannels(data.items ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [chatOpen, chatUser])

  // ─── REST polling fallback for active channel (when WS not connected) ─
  useEffect(() => {
    if (!activeChannel || connected) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = undefined
      }
      return
    }
    const poll = async () => {
      if (!activeChannel) return
      try {
        const res = await fetch(
          `/api/chat/channels/${activeChannel.id}/messages?limit=50`,
          { credentials: 'include' },
        )
        if (!res.ok) return
        const data = await res.json()
        const items: Message[] = (data.items ?? []).map((r: Record<string, unknown>) =>
          normalizeWsMessage(r),
        )
        const lastId = items.length > 0 ? items[items.length - 1].id : null
        if (lastId && lastId !== lastMsgIdRef.current) {
          setMessages(items)
          lastMsgIdRef.current = lastId
          setLoadingMessages(false)
        }
      } catch {
        /* noop */
      }
    }
    poll()
    pollRef.current = setInterval(poll, 2500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [activeChannel, connected])

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, typing, waitingForAgent])

  // ─── Pre-chat registration form submit ─────────────────────────────
  const submitGuestRegistration = async () => {
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

    setRegSubmitting(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fullName: name,
          email: email || undefined,
          phone: phone || undefined,
          // The backend requires a password (min 6 chars). We generate a
          // random one and the user can change it later — this is a
          // chat-only registration, not a full account setup.
          password: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const code = data?.error?.code
        if (code === 'PHONE_EXISTS') {
          setRegError('Số điện thoại đã đăng ký. Vui lòng đăng nhập.')
        } else if (code === 'EMAIL_EXISTS') {
          setRegError('Email đã đăng ký. Vui lòng đăng nhập.')
        } else {
          setRegError(data?.error?.message || 'Không thể tạo tài khoản. Vui lòng thử lại.')
        }
        return
      }
      setChatUser(data.user as SessionUser)
      if (!storeUser) setStoreUser(data.user)
      setView('list')
      toast.success(`Chào ${data.user.name}, bạn đã có thể bắt đầu trò chuyện!`)
    } catch {
      setRegError('Lỗi mạng. Vui lòng thử lại.')
    } finally {
      setRegSubmitting(false)
    }
  }

  const openChannel = async (ch: Channel) => {
    setActiveChannel(ch)
    setView('conversation')
    setMessages([])
    setLoadingMessages(true)
    lastMsgIdRef.current = null
    setShowQuickActions(true)
    setWaitingForAgent(false)
    setAgentJoinedName(null)
    setEmployeesOnline(0)
    if (socketRef.current?.connected) {
      socketRef.current.send('join', { channelId: ch.id })
    }
    fetch(`/api/chat/channels/${ch.id}/read`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {})
    setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, unreadUser: 0 } : c)))
  }

  const startNewChat = async () => {
    if (!chatUser) return
    try {
      const res = await fetch('/api/chat/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          topic: 'Hỗ trợ đặt vé',
          brandId: null,
        }),
      })
      const data = await res.json()
      if (data.channel) {
        fetch('/api/chat/channels?limit=50', { credentials: 'include' })
          .then((r) => r.json())
          .then((d) => setChannels(d.items ?? []))
          .catch(() => {})
        openChannel(data.channel)
      } else if (data?.error?.message) {
        toast.error(data.error.message)
      }
    } catch (e) {
      console.error(e)
      toast.error('Không thể tạo kênh chat')
    }
  }

  const emitMessage = (content: string, clientMsgId: string) => {
    if (!activeChannel || !socketRef.current?.connected) return false
    socketRef.current.send('message', {
      channelId: activeChannel.id,
      text: content,
      clientMsgId,
    })
    return true
  }

  const postMessageRest = async (content: string, optimistic: Message) => {
    if (!activeChannel) return
    try {
      const res = await fetch(`/api/chat/channels/${activeChannel.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content,
          kind: 'text',
          clientMsgId: optimistic.clientMsgId,
        }),
      })
      const data = await res.json()
      if (data.message) {
        setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? data.message : m)))
        lastMsgIdRef.current = data.message.id
      }
    } catch (e) {
      console.error(e)
    }
  }

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || !activeChannel) return
    setInput('')
    setSending(true)
    const clientMsgId = 'c' + Date.now() + Math.random().toString(36).slice(2, 6)
    const optimistic: Message = {
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
    setMessages((prev) => [...prev, optimistic])

    if (emitMessage(content, clientMsgId)) {
      setSending(false)
      return
    }
    await postMessageRest(content, optimistic)
    setSending(false)
  }

  const onInputTyping = (val: string) => {
    setInput(val)
    if (socketRef.current?.connected && activeChannel) {
      socketRef.current.send('typing', { channelId: activeChannel.id, isTyping: true })
    }
  }

  // ─── Render: hidden for employees ──────────────────────────────────
  if (isEmployee && !chatOpen) return null
  if (isEmployee) return null

  // ─── Render: closed (floating button) ──────────────────────────────
  if (!chatOpen) {
    return (
      <button
        onClick={() => setChatOpen(true)}
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-linear-to-br from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white flex items-center justify-center transition-transform group shadow-lg shadow-rose-500/30"
        aria-label="Mở chat hỗ trợ"
      >
        <Headset className="h-6 w-6" />
        <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
          1
        </span>
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

      {view === 'auth' || authChecking ? (
        <ChatAuthView
          authChecking={authChecking}
          regName={regName}
          regPhone={regPhone}
          regEmail={regEmail}
          regError={regError}
          regSubmitting={regSubmitting}
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
            sending={sending}
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

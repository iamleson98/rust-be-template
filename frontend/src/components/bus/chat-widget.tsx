'use client'

import { useEffect, useState, useRef } from 'react'
import { WsClient } from '@/lib/ws-client'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { relativeTime } from '@/lib/types'
import { toast } from 'sonner'
import {
  Headset,
  X,
  Send,
  MessageCircle,
  Minus,
  ArrowLeft,
  Check,
  CheckCheck,
  Phone,
  Mail,
  Loader2,
  Wifi,
  WifiOff,
  Circle,
  Ticket,
  RefreshCw,
  Search,
  AlertTriangle,
  UserPlus,
  ShieldCheck,
  Users,
} from 'lucide-react'

type SessionUser = {
  id: string
  type: 'user' | 'employee'
  role: string
  name: string
  email?: string | null
  phone?: string | null
  avatarUrl?: string | null
  brandId?: string | null
  brandName?: string | null
  employeeRole?: string | null
}

type Channel = {
  id: string
  topic: string
  status: string
  brand?: { name: string | null; accentColor: string | null } | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadUser: number
  assignments?: { employee: { id: string; name: string; avatarUrl: string | null } }[]
}

type Message = {
  id: string
  channelId: string
  senderType: string
  senderId: string
  senderName: string | null
  content: string
  kind: string
  createdAt: string
  /** Optional client-side correlation id used to dedup optimistic messages. */
  clientMsgId?: string
}

type View = 'list' | 'conversation' | 'auth' | 'login-required'

export function ChatWidget() {
  const { chatOpen, setChatOpen, user: storeUser, setUser: setStoreUser } = useApp()

  // The chat session user (may differ briefly from storeUser after guest
  // registration — we keep a local copy to avoid race conditions).
  const [chatUser, setChatUser] = useState<SessionUser | null>(null)
  const [chatToken, setChatToken] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

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
  const [agentNames, setAgentNames] = useState<string[]>([])
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

  useEffect(() => { activeChannelRef.current = activeChannel }, [activeChannel])

  // ─── ESC to close + focus trap (WCAG 2.1.2 + 2.4.3) ───
  // When the chat panel is open, pressing ESC closes it and Tab cycles
  // focus within the panel (can't escape to the background). On close,
  // focus is returned to the trigger button.
  useEffect(() => {
    if (!chatOpen) return
    // Capture the trigger so we can restore focus on close.
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
      // Build the focusable-element list (visible, not disabled).
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
        // Shift+Tab on the first element → wrap to the last.
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab on the last element → wrap to the first.
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    // Move focus into the panel on open.
    const t = setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      first?.focus()
    }, 50)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      clearTimeout(t)
      // Restore focus to the trigger button on close.
      triggerRef.current?.focus()
    }
  }, [chatOpen, setChatOpen])

  // Hide the chat button entirely for employees (they have the admin workspace)
  const isEmployee = storeUser?.type === 'employee' || chatUser?.type === 'employee'

  // ─── On chat open: fetch a short-lived access token for the WS auth ───
  // If the visitor is authenticated (cookie present), this returns the token
  // + user. If not, we show the pre-chat registration form.
  useEffect(() => {
    if (!chatOpen) return
    if (isEmployee) return // employees don't use this widget
    if (chatToken && chatUser) return // already have a token

    let cancelled = false
    setAuthChecking(true)
    setAuthError(null)
    fetch('/api/chat/chat-token', { credentials: 'same-origin' })
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 401) {
          // Not authenticated — show pre-chat form
          setChatUser(null)
          setChatToken(null)
          setView('auth')
          setAuthChecking(false)
          return
        }
        if (!r.ok) {
          setAuthError('Không thể kết nối đến dịch vụ chat. Vui lòng thử lại.')
          setAuthChecking(false)
          return
        }
        const data = await r.json()
        setChatUser(data.user as SessionUser)
        setChatToken(data.accessToken as string)
        // Sync with the global store so the header reflects the new login
        if (data.user && !storeUser) setStoreUser(data.user)
        setView('list')
        setAuthChecking(false)
      })
      .catch(() => {
        if (cancelled) return
        setAuthError('Lỗi mạng khi kiểm tra phiên đăng nhập.')
        setAuthChecking(false)
      })
    return () => { cancelled = true }
  }, [chatOpen, isEmployee, chatToken, chatUser, storeUser, setStoreUser])

  // ─── Connect native WebSocket with the access token in the URL ─────
  // Replaces socket.io-client with the built-in WebSocket API, talking to
  // the Rust (axum + tokio-tungstenite) backend at /ws on :8080.
  useEffect(() => {
    if (!chatOpen || !chatToken || !chatUser) return
    let disposed = false

    const ws = new WsClient(chatToken)
    socketRef.current = ws

    ws.on('_open', () => { if (!disposed) setConnected(true) })
    ws.on('_close', () => { if (!disposed) setConnected(false) })

    // ─── Reconnect exhausted — if we never opened, likely an auth issue ──
    ws.on('_giveup', (data: Record<string, unknown>) => {
      if (disposed) return
      if (!data.everOpened) {
        // The socket never opened — the JWT may be invalid/expired.
        // Re-fetch the chat token; if that 401s, show the login view.
        setConnected(false)
        fetch('/api/chat/chat-token', { credentials: 'same-origin' })
          .then((r) => {
            if (r.status === 401) {
              setView('login-required')
              ws.close()
              socketRef.current = null
            } else if (r.ok) {
              return r.json().then((d) => {
                if (d.accessToken && !disposed) ws.reconnectNow(d.accessToken as string)
              })
            }
          })
          .catch(() => { })
      }
    })

    ws.on('message', (msg: Record<string, unknown>) => {
      const m = msg as unknown as Message
      if (activeChannelRef.current && m.channelId === activeChannelRef.current.id) {
        setMessages((prev) => {
          // Dedup by server id (already have it)
          if (prev.some((x) => x.id === m.id && !x.id.startsWith('tmp-'))) return prev
          // Replace optimistic message by clientMsgId (sender echo)
          if (m.clientMsgId) {
            const idx = prev.findIndex((x) => x.clientMsgId === m.clientMsgId && x.id.startsWith('tmp-'))
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = m
              return next
            }
          }
          return [...prev, m]
        })
        // An employee reply clears the "waiting for agent" state
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

    ws.on('history', (data: Record<string, unknown>) => {
      const d = data as unknown as { channelId: string; messages: Message[] }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        setMessages(d.messages)
        setLoadingMessages(false)
        if (d.messages.length > 0) lastMsgIdRef.current = d.messages[d.messages.length - 1].id
      }
    })

    ws.on('employee_presence', (data: Record<string, unknown>) => {
      const d = data as unknown as { channelId: string; employeesOnline: number; names: string[] }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        setEmployeesOnline(d.employeesOnline)
        setAgentNames(d.names)
        if (d.employeesOnline > 0) {
          setWaitingForAgent(false)
          if (d.names.length > 0) setAgentJoinedName(d.names[0] ?? null)
        }
      }
    })

    ws.on('waiting_for_agent', (data: Record<string, unknown>) => {
      const d = data as unknown as { channelId: string; message: string }
      if (activeChannelRef.current && d.channelId === activeChannelRef.current.id) {
        setWaitingForAgent(true)
      }
    })

    ws.on('error', (data: Record<string, unknown>) => {
      const d = data as unknown as { code?: string; message?: string }
      if (d?.code === 'rate_limited') {
        toast.warning(d.message || 'Đang gửi quá nhanh')
      } else if (d?.message) {
        toast.error(d.message)
      }
    })

    return () => {
      disposed = true
      ws.close()
      socketRef.current = null
      setConnected(false)
    }
  }, [chatOpen, chatToken, chatUser])

  // ─── Load channel list via REST ────────────────────────────────────
  useEffect(() => {
    if (!chatOpen || !chatUser) return
    let cancelled = false
    fetch('/api/chat/channels', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setChannels(data.items ?? []) })
      .catch(() => { })
    return () => { cancelled = true }
  }, [chatOpen, chatUser])

  // ─── REST polling fallback for active channel (when WS not connected) ─
  useEffect(() => {
    if (!activeChannel || connected) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined }
      return
    }
    const poll = async () => {
      if (!activeChannel) return
      try {
        const res = await fetch(`/api/chat/channels/${activeChannel.id}/messages?limit=50`, { credentials: 'same-origin' })
        if (!res.ok) return
        const data = await res.json()
        const items: Message[] = data.items ?? []
        const lastId = items.length > 0 ? items[items.length - 1].id : null
        if (lastId && lastId !== lastMsgIdRef.current) {
          setMessages(items)
          lastMsgIdRef.current = lastId
          setLoadingMessages(false)
        }
      } catch { /* noop */ }
    }
    poll()
    pollRef.current = setInterval(poll, 2500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
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
      const res = await fetch('/api/chat/register-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, phone: phone || undefined, email: email || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        const code = data?.error?.code
        if (code === 'PHONE_EXISTS') {
          setRegError('Số điện thoại đã đăng ký. Vui lòng đăng nhập bằng OTP.')
        } else if (code === 'EMAIL_EXISTS') {
          setRegError('Email đã đăng ký. Vui lòng đăng nhập.')
        } else if (code === 'RATE_LIMITED') {
          setRegError('Quá nhiều yêu cầu, vui lòng thử lại sau.')
        } else {
          setRegError(data?.error?.message || 'Không thể tạo tài khoản. Vui lòng thử lại.')
        }
        return
      }
      // Success — cookies are set, sync user + token
      setChatUser(data.user as SessionUser)
      // Re-fetch the chat token now that we're authenticated
      const tk = await fetch('/api/chat/chat-token', { credentials: 'same-origin' })
      if (tk.ok) {
        const td = await tk.json()
        setChatToken(td.accessToken as string)
      }
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
    setAgentNames([])
    if (socketRef.current?.connected) {
      socketRef.current.send('join', { channelId: ch.id })
    }
    fetch(`/api/chat/channels/${ch.id}/read`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => { })
    setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, unreadUser: 0 } : c)))
  }

  const startNewChat = async () => {
    if (!chatUser) return
    try {
      const res = await fetch('/api/chat/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          topic: 'Hỗ trợ đặt vé',
          brandId: null,
        }),
      })
      const data = await res.json()
      if (data.channel) {
        // Reload channel list
        fetch('/api/chat/channels', { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((d) => setChannels(d.items ?? []))
          .catch(() => { })
        openChannel(data.channel)
      } else if (data?.error?.message) {
        toast.error(data.error.message)
      }
    } catch (e) {
      console.error(e)
      toast.error('Không thể tạo kênh chat')
    }
  }

  const quickActions = [
    { label: 'Đặt vé xe', message: 'Xin chào, tôi muốn đặt vé xe', icon: Ticket },
    { label: 'Đổi/hoàn vé', message: 'Tôi cần đổi hoặc hoàn vé', icon: RefreshCw },
    { label: 'Kiểm tra chuyến', message: 'Tôi muốn kiểm tra tình trạng chuyến', icon: Search },
    { label: 'Khiếu nại', message: 'Tôi cần khiếu nại về dịch vụ', icon: AlertTriangle },
  ]

  const emitMessage = (content: string, clientMsgId: string) => {
    if (!activeChannel || !socketRef.current?.connected) return false
    socketRef.current.send('message', {
      channelId: activeChannel.id,
      content,
      kind: 'text',
      clientMsgId,
    })
    return true
  }

  const postMessageRest = async (content: string, optimistic: Message) => {
    try {
      const res = await fetch(`/api/chat/channels/${activeChannel!.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ content, kind: 'text' }),
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
      {/* Header */}
      <div className="bg-linear-to-r from-rose-600 to-rose-700 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          {view === 'conversation' && (
            <button onClick={() => { setView('list'); setActiveChannel(null) }} className="hover:bg-white/10 rounded p-1 -ml-1" aria-label="Quay lại">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Headset className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm truncate">
              {view === 'conversation' && activeChannel ? activeChannel.topic : 'Hỗ trợ VeXeVN'}
            </div>
            <div className="text-[11px] text-rose-100 flex items-center gap-1">
              {connected ? (
                <>
                  <Wifi className="h-3 w-3" /> Đang trực tuyến
                  {employeesOnline > 0 && <span className="ml-1">• {employeesOnline} NV sẵn sàng</span>}
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" /> Đang kết nối...
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setChatOpen(false)} className="hover:bg-white/10 rounded p-1.5" aria-label="Thu nhỏ">
            <Minus className="h-4 w-4" />
          </button>
          <button onClick={() => setChatOpen(false)} className="hover:bg-white/10 rounded p-1.5" aria-label="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body — auth gate */}
      {view === 'auth' || authChecking ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          <div className="p-5 space-y-4">
            <div className="text-center">
              <div className="inline-flex h-14 w-14 rounded-full bg-rose-50 items-center justify-center mb-3">
                <UserPlus className="h-7 w-7 text-rose-600" />
              </div>
              <h3 className="font-bold text-base">Bắt đầu trò chuyện</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Vui lòng cung cấp họ tên và số điện thoại (hoặc email) để chúng tôi có thể hỗ trợ bạn.
                Tài khoản sẽ được tự động tạo miễn phí.
              </p>
            </div>

            {authChecking ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-name" className="text-xs font-medium">Họ và tên <span className="text-rose-500">*</span></Label>
                  <Input
                    id="reg-name"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    maxLength={80}
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-phone" className="text-xs font-medium">Số điện thoại</Label>
                  <Input
                    id="reg-phone"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="09xx xxx xxx"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <div className="flex-1 h-px bg-border" />
                  HOẶC
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email" className="text-xs font-medium">Email</Label>
                  <Input
                    id="reg-email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="email@example.com"
                    inputMode="email"
                    autoComplete="email"
                  />
                </div>

                {regError && (
                  <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{regError}</span>
                  </div>
                )}

                <Button
                  onClick={submitGuestRegistration}
                  disabled={regSubmitting}
                  className="w-full gap-2 bg-linear-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800"
                >
                  {regSubmitting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Đang tạo tài khoản...</>
                  ) : (
                    <><ShieldCheck className="h-4 w-4" /> Bắt đầu chat</>
                  )}
                </Button>

                <p className="text-[10px] text-muted-foreground text-center pt-1">
                  Bằng việc tiếp tục, bạn đồng ý với điều khoản sử dụng. Thông tin của bạn được bảo mật.
                </p>

                <div className="text-center pt-2">
                  <button
                    onClick={() => { useApp.getState().setAuthOpen(true); setChatOpen(false) }}
                    className="text-xs text-rose-600 hover:text-rose-700 hover:underline font-medium"
                  >
                    Đã có tài khoản? Đăng nhập
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-auto border-t p-3 bg-slate-50 text-xs text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> 1900 6067</span>
            <span className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> cskh@vexevn.vn</span>
          </div>
        </div>
      ) : view === 'login-required' ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="inline-flex h-14 w-14 rounded-full bg-amber-50 items-center justify-center mb-3">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
          </div>
          <h3 className="font-bold text-base">Phiên đăng nhập hết hạn</h3>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            Vui lòng đăng nhập lại để tiếp tục trò chuyện với nhân viên hỗ trợ.
          </p>
          <Button
            onClick={() => { useApp.getState().setAuthOpen(true); setChatOpen(false) }}
            className="gap-2 bg-rose-600 hover:bg-rose-700"
          >
            <ShieldCheck className="h-4 w-4" /> Đăng nhập
          </Button>
        </div>
      ) : view === 'list' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 border-b">
            <Button onClick={startNewChat} className="w-full gap-2 bg-linear-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800">
              <MessageCircle className="h-4 w-4" />
              Bắt đầu trò chuyện mới
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1 max-h-96 overflow-y-auto">
              {channels.length === 0 ? (
                <div className="text-center py-12 px-6">
                  <div className="inline-flex h-14 w-14 rounded-full bg-rose-50 items-center justify-center mb-3">
                    <MessageCircle className="h-7 w-7 text-rose-600" />
                  </div>
                  <h4 className="font-semibold text-sm">Chưa có cuộc trò chuyện</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Bắt đầu trò chuyện để được nhân viên hỗ trợ đặt vé, đổi giờ, hoàn hủy...
                  </p>
                </div>
              ) : (
                channels.map((ch) => {
                  const agent = ch.assignments?.[0]?.employee
                  return (
                    <button
                      key={ch.id}
                      onClick={() => openChannel(ch)}
                      className="w-full text-left rounded-lg p-3 hover:bg-slate-50 transition-colors flex items-center gap-3"
                    >
                      <div className="relative shrink-0">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={agent?.avatarUrl ?? ''} />
                          <AvatarFallback className="bg-rose-100 text-rose-700 text-xs font-bold">
                            {agent?.name?.[0] ?? 'CS'}
                          </AvatarFallback>
                        </Avatar>
                        <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-blue-500 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-sm truncate">{ch.topic}</div>
                          <div className="text-[10px] text-muted-foreground shrink-0">
                            {ch.lastMessageAt ? relativeTime(ch.lastMessageAt) : ''}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <div className="text-xs text-muted-foreground truncate">
                            {ch.lastMessagePreview || 'Chưa có tin nhắn'}
                          </div>
                          {ch.unreadUser > 0 && (
                            <Badge className="bg-rose-500 text-white text-[10px] h-4 min-w-4 px-1 justify-center">
                              {ch.unreadUser}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-3 bg-slate-50 text-xs text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> 1900 6067</span>
            <span className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> cskh@vexevn.vn</span>
          </div>
        </div>
      ) : (
        // Conversation view
        <div className="flex-1 flex flex-col min-h-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-linear-to-b from-slate-50 to-white max-h-120">
            {loadingMessages ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="text-center py-2">
                  <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-[10px] text-muted-foreground">
                    Tin nhắn được bảo mật • Phản hồi trung bình 1 phút
                  </span>
                </div>

                {/* Waiting-for-agent banner */}
                {waitingForAgent && (
                  <div className="flex justify-center py-2">
                    <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Không có nhân viên trực tuyến, đang thông báo đội ngũ hỗ trợ...</span>
                    </div>
                  </div>
                )}

                {/* Agent joined banner */}
                {!waitingForAgent && agentJoinedName && employeesOnline > 0 && (
                  <div className="flex justify-center py-2">
                    <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs text-blue-800">
                      <Users className="h-3 w-3" />
                      <span>Nhân viên <strong>{agentJoinedName}</strong> đã tham gia</span>
                    </div>
                  </div>
                )}

                {messages.map((m, i) => {
                  const isMe = m.senderType === 'user'
                  const isSystem = m.senderType === 'system'
                  const showName = !isMe && !isSystem && (i === 0 || messages[i - 1].senderType !== m.senderType)
                  return (
                    <div key={m.id} className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[78%]', isSystem && 'mx-auto')}>
                        {showName && (
                          <div className="text-[10px] text-muted-foreground mb-0.5 px-1">{m.senderName}</div>
                        )}
                        <div
                          className={cn(
                            'rounded-2xl px-3 py-2 text-sm wrap-break-word',
                            isSystem
                              ? 'bg-amber-50 text-amber-800 text-center text-xs border border-amber-100'
                              : isMe
                                ? 'bg-rose-600 text-white rounded-br-sm'
                                : 'bg-white border rounded-bl-sm',
                          )}
                        >
                          {m.content}
                        </div>
                        {isMe && (
                          <div className="text-[9px] text-muted-foreground mt-0.5 px-1 text-right flex items-center justify-end gap-0.5">
                            {m.id.startsWith('tmp-') ? (
                              <Check className="h-2.5 w-2.5" />
                            ) : (
                              <CheckCheck className="h-2.5 w-2.5 text-rose-500" />
                            )}
                            {new Date(m.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {typing && (
                  <div className="flex justify-start">
                    <div className="bg-white border rounded-2xl rounded-bl-sm px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Quick action buttons */}
          {showQuickActions && messages.length === 0 && !loadingMessages && (
            <div className="border-t px-3 py-2 bg-linear-to-b from-rose-50/50 to-white">
              <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">Chọn nhanh:</div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
                {quickActions.map((qa) => (
                  <button
                    key={qa.label}
                    onClick={() => { setInput(qa.message); sendMessage(qa.message); setShowQuickActions(false) }}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-colors shrink-0"
                  >
                    <qa.icon className="h-3.5 w-3.5" />
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input bar — mobile-first: 44px touch target for the send button,
              safe-area padding for iPhone home indicator, input has 16px font
              to prevent iOS zoom-on-focus. */}
          <div
            className="border-t p-2.5 flex items-center gap-2 bg-white"
            style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))' }}
          >
            <Input
              value={input}
              onChange={(e) => onInputTyping(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Nhập tin nhắn..."
              // text-base = 16px → iOS Safari won't zoom on focus (it zooms
              // when the input font-size is <16px).
              className="flex-1 h-11 text-base"
              maxLength={8000}
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="send"
            />
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || sending}
              size="icon"
              // h-11 w-11 = 44px — Apple HIG minimum touch target.
              className="bg-rose-600 hover:bg-rose-700 shrink-0 h-11 w-11"
              aria-label="Gửi tin nhắn"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

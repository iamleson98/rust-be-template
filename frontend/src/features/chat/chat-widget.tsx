'use client'

/**
 * ChatWidget — the customer-facing floating support chat panel.
 *
 * Top-level orchestrator. Owns:
 *   - The chat session user + auth bootstrap (`useAuthMe`)
 *   - The WebSocket connection (via `WsClient`)
 *   - The channels list + active channel + messages state — all backed
 *     by TanStack Query (`useChatChannels`, `useChatMessages`).
 *   - Message send/typing handlers (mutations
 *     via TanStack Query: `useCreateChatChannel`,
 *     `usePostChatMessage`, `useMarkChatRead`).
 *
 * Rendering is delegated to dedicated sub-components under `chat/`:
 *   - ChatHeader            — top bar (connection status, minimize/close)
 *   - ChatList              — channel list view
 *   - ChatConversation       — conversation view (messages, banners)
 *   - ChatInput             — input bar + quick-action chips
 *
 * The WS wiring + panel a11y live in sibling hooks:
 *   - useChatWidgetWs       — WS connection + all hub event handlers
 *   - useChatFocusTrap      — ESC close + focus trap (WCAG 2.1.2/2.4.3)
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
 * ```
 *
 * TanStack Query handles loading/error/refetch states. The widget
 * just renders the appropriate UI based on the query states.
 */

import { useEffect, useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WsClient } from '@/lib/ws-client'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { stopTitleNotification } from '@/lib/title-notifier'
import type { SessionUser } from '@/lib/api/types.gen'
import {
  useAuthMe,
  useChatChannels,
  useChatMessagesInfinite,
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
} from './_shared'
import { ChatHeader } from './chat-header'
import { ChatList } from './chat-list'
import { ChatConversation } from './chat-conversation'
import { ChatInput } from './chat-input'
import { useChatFocusTrap } from './use-chat-focus-trap'
import { useChatWidgetWs } from './use-chat-widget-ws'
import { isStaffUser } from '@/lib/store'

export function ChatWidget() {
  const { chatOpen, setChatOpen, callOpen, setCallOpen, user: storeUser, setUser: setStoreUser } = useApp()
  const navigate = useNavigate()
  const qc = useQueryClient()

  // The chat session user. Initialised from storeUser so the first
  // open is instant — `useAuthMe` verifies it asynchronously.
  const [chatUser, setChatUser] = useState<SessionUser | null>(
    (storeUser as SessionUser | null) ?? null,
  )

  const [connected, setConnected] = useState(false)
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState<{ name: string } | null>(null)
  const [view, setView] = useState<View>('list')
  const [initializingChannel, setInitializingChannel] = useState(true)
  const [showQuickActions, setShowQuickActions] = useState(false)

  // Agent presence / waiting-for-agent UI
  const [waitingForAgent, setWaitingForAgent] = useState(false)
  const [employeesOnline, setEmployeesOnline] = useState(0)
  const [agentJoinedName, setAgentJoinedName] = useState<string | null>(null)
  // Three-role routing: live assignee (from `channel_assigned` events
  // + channel list refetch) + bot status (no staff online).
  const [assignee, setAssignee] = useState<{ id: string; name: string; role: string } | null>(null)
  const [botActive, setBotActive] = useState(false)

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
    if (isStaffUser(chatUser)) return

    if (authMe.isLoading) return
    if (authMe.error) {
      setChatUser(null)
      setCallOpen(false)
      setChatOpen(false)
      navigate({ to: '/login' })
      return
    }
    if (authMe.data?.user) {
      const u = authMe.data.user as unknown as SessionUser
      setChatUser(u)
      if (!storeUser) setStoreUser(u as any)
    }
  }, [chatOpen, authMe.isLoading, authMe.error, authMe.data, chatUser, storeUser, setStoreUser, setChatOpen, navigate])

  // Hide the chat button entirely for employees (they have the admin workspace)
  const isEmployee = isStaffUser(storeUser) || isStaffUser(chatUser)

  // ─── ESC to close + focus trap (WCAG 2.1.2 + 2.4.3) ───
  useChatFocusTrap({ chatOpen, panelRef, triggerRef, setCallOpen, setChatOpen })

  // ─── Connect native WebSocket (cookie-based auth) ─────
  //
  // All hub-event subscriptions (message/typing/assignment/presence/
  // abuse-guard) live in the sibling `use-chat-widget-ws.ts` hook —
  // it receives the state setters it drives and the refs it shares
  // with the send/typing handlers below.
  useChatWidgetWs({
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
  })

  // ── Channels list via TanStack Query ──────────────────────────────
  const channelsQuery = useChatChannels(50)
  const channels: Channel[] = (channelsQuery.data?.items ?? []) as unknown as Channel[]

  // ── Messages for the active channel via TanStack Query (infinite scroll) ───
  //
  // `useChatMessagesInfinite` fetches the latest 30 messages first
  // (newest first in the API → reversed for display). When the user
  // scrolls to the top, the chat-conversation component triggers
  // `fetchNextPage()` to load older messages. Scroll position is
  // preserved by the scroll-anchor logic in chat-conversation.tsx.
  const {
    messages: infiniteMessages,
    hasNextPage: hasMoreMessages,
    fetchNextPage: fetchMoreMessages,
    isFetchingNextPage: isFetchingMoreMessages,
  } = useChatMessagesInfinite(activeChannel?.id, 30)
  const messages: Message[] = infiniteMessages as unknown as Message[]
  const loadingMessages = !infiniteMessages && activeChannel != null

  // ── Auto-scroll + scroll-position preservation ────────────────────
  //
  // The auto-scroll + scroll-position-preservation logic lives in
  // `chat-conversation.tsx` now (it has access to `scrollRef` via
  // props + uses `useLayoutEffect` for stable position on prepend).
  // The previous `useEffect` here was a simpler version that always
  // scrolled to the bottom — it would yank the user down when they
  // were reading older messages. Removed in favor of the smarter
  // version in ChatConversation.

  // ── Mutations ─────────────────────────────────────────────────────
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

  const openChannel = async (ch: Channel) => {
    setActiveChannel(ch)
    setView('conversation')
    setShowQuickActions(true)
    setWaitingForAgent(false)
    setAgentJoinedName(null)
    setEmployeesOnline(0)
    setAssignee(null)
    setBotActive(false)
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

  // Resume the most recently active conversation on every fresh widget
  // mount. The channel endpoint is ordered by lastMessageAt descending,
  // so the first item is the conversation the customer last used.
  useEffect(() => {
    if (!chatUser || authMe.isLoading || channelsQuery.isLoading || !initializingChannel) return

    const latestChannel = channels[0]
    if (latestChannel) void openChannel(latestChannel)
    setInitializingChannel(false)
  }, [chatUser, authMe.isLoading, channelsQuery.isLoading, channelsQuery.data, initializingChannel])

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

  // ─── Render: open chat panel ───────────────────────────────────────
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Hỗ trợ DatXeVui"
      className="fixed bottom-0 right-0 sm:bottom-5 sm:right-5 z-50 w-full sm:w-100 h-screen sm:h-150 sm:max-h-[85vh] bg-white sm:rounded-2xl ring-1 ring-black/10 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-300"
    >
      <ChatHeader
        view={view}
        activeChannel={activeChannel}
        connected={connected}
        employeesOnline={employeesOnline}
        assigneeName={assignee?.name ?? null}
        botActive={botActive}
        showBack={callOpen}
        onCall={chatUser && !callOpen ? () => setCallOpen(true) : undefined}
        onMinimize={() => {
          setCallOpen(false)
          setChatOpen(false)
        }}
        onClose={() => {
          setCallOpen(false)
          setChatOpen(false)
        }}
        onBackToList={() => {
          setCallOpen(false)
        }}
      />

      {callOpen && chatUser ? (
        <div id="customer-call-surface" className="flex min-h-0 flex-1 flex-col" />
      ) : authMe.isLoading || initializingChannel ? (
        <div className="flex flex-1 items-center justify-center" aria-label="Đang kiểm tra đăng nhập">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : view === 'list' ? (
        <ChatList
          channels={channels}
          onOpenChannel={openChannel}
          onStartNewChat={startNewChat}
        />
      ) : (
        <>
          <ChatConversation
            key={activeChannel?.id ?? 'no-channel'}
            scrollRef={scrollRef}
            loadingMessages={loadingMessages}
            messages={messages}
            typing={typing}
            waitingForAgent={waitingForAgent}
            agentJoinedName={agentJoinedName}
            employeesOnline={employeesOnline}
            hasMoreMessages={hasMoreMessages}
            isFetchingMoreMessages={isFetchingMoreMessages}
            onFetchMoreMessages={() => fetchMoreMessages()}
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

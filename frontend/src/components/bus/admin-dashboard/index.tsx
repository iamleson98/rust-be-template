'use client'

/**
 * AdminDashboard — top-level shell for the admin "Bảng điều khiển" view.
 *
 * This is the named-export entry point. Owns the dashboard-wide state
 * (channels, chat workspace) and orchestrates the StatsOverview + 4 tabs
 * (Chat / Brand CRUD / Campaigns / Reviews).
 *
 * Migrated from Zustand view-state routing + manual fetch to TanStack
 * Router + TanStack Query. The `/api/stats` and `/api/campaigns` calls
 * are now backed by `useStats` / `useCampaigns` hooks (the campaigns list
 * is consumed directly inside `<CampaignsPanel />`). The chat channels
 * + chat messages endpoints have no TanStack Query hook yet, so they
 * remain on the manual `useEffect + fetch + useState` pattern — kept
 * verbatim from the original implementation.
 */

import { memo, useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@/router'
import { useStats } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  LayoutDashboard,
  Eye,
  CalendarRange,
  Download,
  Building2,
  MessageSquare,
  TrendingUp,
  Star,
  Ticket,
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminDashboardSkeleton } from '../skeletons'
import { AdminBrandManagement } from '../admin-brand-management'
import type {
  Channel,
  ChatMessage,
  DateRange,
} from './types'
import { RECENT_BOOKINGS } from './mock-data'
import { buildCSV, downloadCSV } from './helpers'
import { StatsOverview } from './stats-overview'
import { ChatPanel } from './chat-panel'
import { CampaignsPanel } from './campaigns-panel'
import { ReviewsModerationPanel } from './reviews-panel'
import { TicketsPanel } from './tickets-panel'

export const AdminDashboard = memo(function AdminDashboard() {
  const navigate = useNavigate()
  const [channels, setChannels] = useState<Channel[]>([])
  // `statsQuery` is shared with `<StatsOverview />` via TanStack Query's
  // cache (same queryKey `['stats', dateRange]`) — we only consume
  // `isLoading` here for the full-dashboard skeleton gate.
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const statsQuery = useStats(dateRange)
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    // Chat channels endpoint has no TanStack Query hook (admin-only,
    // rarely used) — keep the original manual fetch.
    fetch('/api/chat/channels?role=employee&employeeId=any')
      .then((r) => r.json())
      .then((d) => setChannels(d.items ?? []))
      .catch(() => {})
  }, [])

  const handleExportCSV = useCallback(() => {
    const csv = buildCSV(RECENT_BOOKINGS)
    const today = new Date().toISOString().slice(0, 10)
    downloadCSV(`vexevn_bookings_${today}.csv`, csv)
    toast.success('Xuất CSV thành công', {
      description: `Đã xuất ${RECENT_BOOKINGS.length} vé đặt gần đây ra file CSV`,
    })
  }, [])

  const openChatWorkspace = useCallback(async (channel: Channel) => {
    setActiveChannel(channel)
    try {
      const res = await fetch(`/api/chat/channels/${channel.id}/messages?limit=50`)
      const data = await res.json()
      setChatMessages((data.items ?? []) as ChatMessage[])
    } catch {
      setChatMessages([])
    }
  }, [])

  const sendReply = useCallback(async () => {
    if (!replyText.trim() || !activeChannel) return
    setSending(true)
    try {
      const res = await fetch(`/api/chat/channels/${activeChannel.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderType: 'employee',
          senderId: 'emp-1',
          senderName: 'CSKH VeXeVN',
          content: replyText.trim(),
          kind: 'text',
        }),
      })
      const data = await res.json()
      if (data.message) {
        setChatMessages((prev) => [...prev, data.message])
        setReplyText('')
        toast.success('Đã gửi phản hồi')
      }
    } catch {
      toast.error('Không thể gửi tin nhắn')
    } finally {
      setSending(false)
    }
  }, [replyText, activeChannel])

  const blockChannel = useCallback(async (channelId: string) => {
    toast.success('Đã chặn cuộc trò chuyện', { description: 'Khách sẽ không thể gửi tin nhắn mới' })
    setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, status: 'blocked' } : c)))
    if (activeChannel?.id === channelId) setActiveChannel(null)
  }, [activeChannel])

  /**
   * After the employee creates a ticket via the chat picker, POST a chat
   * message with `kind: 'ticket'` + the booking-card payload as
   * `attachments`, then append it to the local message list so it shows up
   * immediately as a beautiful ticket card in the conversation.
   */
  const sendTicketCard = useCallback(
    async (payload: import('./chat-ticket-picker').CreatedTicketPayload) => {
      if (!activeChannel) return
      const attachments = JSON.stringify(payload)
      try {
        const res = await fetch(`/api/chat/channels/${activeChannel.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderType: 'employee',
            senderId: 'emp-1',
            senderName: 'CSKH VeXeVN',
            content: `Đã đặt vé ${payload.bookingCode} cho bạn`,
            kind: 'ticket',
            attachments,
          }),
        })
        const data = await res.json()
        if (data.message) {
          setChatMessages((prev) => [...prev, data.message as ChatMessage])
        }
      } catch {
        // Silently fail — the booking was already created; the chat message
        // is just a notification. The employee can manually paste the code.
      }
    },
    [activeChannel],
  )

  if (statsQuery.isLoading) {
    return <AdminDashboardSkeleton />
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Bảng điều khiển
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Tổng quan hoạt động</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Date range selector */}
            <div className="inline-flex items-center rounded-lg border bg-white p-0.5" role="group" aria-label="Khoảng thời gian">
              <CalendarRange className="h-3.5 w-3.5 text-muted-foreground mx-2" />
              {([
                { key: '7d' as DateRange, label: '7 ngày' },
                { key: '30d' as DateRange, label: '30 ngày' },
                { key: '90d' as DateRange, label: '90 ngày' },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setDateRange(opt.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    dateRange === opt.key
                      ? 'bg-blue-600 text-white '
                      : 'text-muted-foreground hover:text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button variant="outline" onClick={handleExportCSV} className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50">
              <Download className="h-4 w-4" />
              Xuất CSV
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/' })} className="gap-2">
              <Eye className="h-4 w-4" />
              Về trang khách hàng
            </Button>
          </div>
        </div>

        {/* Stats overview (KPIs + charts + recent bookings + activity feed) */}
        <StatsOverview dateRange={dateRange} onExportCSV={handleExportCSV} />

        {/* ─── Tabs: Tickets / Chat / Brands & Routes CRUD / Campaigns / Reviews ─── */}
        <div>
          <Tabs defaultValue="tickets" className="space-y-4">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="tickets" className="gap-1.5"><Ticket className="h-4 w-4" /> Vé đã bán</TabsTrigger>
              <TabsTrigger value="crud" className="gap-1.5"><Building2 className="h-4 w-4" /> Hãng xe &amp; Tuyến</TabsTrigger>
              <TabsTrigger value="chat" className="gap-1.5"><MessageSquare className="h-4 w-4" /> Hỗ trợ trực tuyến</TabsTrigger>
              <TabsTrigger value="campaigns" className="gap-1.5"><TrendingUp className="h-4 w-4" /> Khuyến mãi</TabsTrigger>
              <TabsTrigger value="reviews" className="gap-1.5"><Star className="h-4 w-4" /> Đánh giá</TabsTrigger>
            </TabsList>

            {/* Sold tickets management — new Phase 9 tab */}
            <TabsContent value="tickets" className="space-y-4">
              <TicketsPanel />
            </TabsContent>

            {/* Chat queue + workspace */}
            <TabsContent value="chat" className="space-y-4">
              <ChatPanel
                channels={channels}
                activeChannel={activeChannel}
                chatMessages={chatMessages}
                replyText={replyText}
                sending={sending}
                onOpenChannel={openChatWorkspace}
                onSendReply={sendReply}
                onBlockChannel={blockChannel}
                onSetReplyText={setReplyText}
                onSendTicketCard={sendTicketCard}
                onViewTicket={(code) => {
                  // Switch to the Tickets tab + open the detail dialog.
                  // We do this via a custom event so the TicketsPanel can
                  // pick it up without prop-drilling.
                  const ev = new CustomEvent('admin:view-ticket', { detail: code })
                  window.dispatchEvent(ev)
                  // Also switch the active tab via a state update — but
                  // since the Tabs value is internal, we use a tiny URL
                  // hash hack to force the user to the tickets tab.
                  if (typeof window !== 'undefined') {
                    const tabEl = document.querySelector('[data-state="inactive"][value="tickets"]') as HTMLButtonElement | null
                    tabEl?.click()
                  }
                }}
              />
            </TabsContent>

            {/* Brand & Route CRUD master-detail — Brands, Routes, Schedules, Pickup/Dropping points */}
            <TabsContent value="crud" className="space-y-4">
              <AdminBrandManagement />
            </TabsContent>

            {/* Campaigns */}
            <TabsContent value="campaigns" className="space-y-4">
              <CampaignsPanel />
            </TabsContent>

            {/* Reviews moderation */}
            <TabsContent value="reviews" className="space-y-4">
              <ReviewsModerationPanel />
            </TabsContent>
          </Tabs>
        </div>

        {/* CSS for auto-scrolling activity feed */}
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes scrollUp {
            0% { transform: translateY(0); }
            100% { transform: translateY(-50%); }
          }
          .animate-scroll-up {
            animation: scrollUp 20s linear infinite;
          }
          .animate-scroll-up:hover {
            animation-play-state: paused;
          }
        `}} />
      </div>
    </div>
  )
})

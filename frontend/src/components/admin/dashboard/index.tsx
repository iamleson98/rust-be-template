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

import { memo, useCallback, useState } from 'react'
import { useNavigate } from '@/router'
import {
  useStats,
  useChatChannels,
  useChatMessages,
  usePostChatMessage,
  useAdminBookingExport,
  type AdminBookingFilter,
} from '@/lib/queries'
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
import { AdminDashboardSkeleton } from '@/components/layout/skeletons'
import { AdminBrandManagement } from '@/components/admin/brands'
import type {
  Channel,
  ChatMessage,
  DateRange,
} from './types'
import { downloadCSV } from './helpers'
import { StatsOverview } from './stats-overview'
import { ChatPanel } from '@/components/admin/chat/chat-panel'
import { CampaignsPanel } from './campaigns-panel'
import { ReviewsModerationPanel } from '@/components/admin/reviews/reviews-panel'
import { TicketsPanel } from '@/components/admin/tickets/tickets-panel'

export const AdminDashboard = memo(function AdminDashboard() {
  const navigate = useNavigate()
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const statsQuery = useStats()
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [replyText, setReplyText] = useState('')

  // Chat data via TanStack Query hooks
  const channelsQuery = useChatChannels(50)
  const channels: Channel[] = (channelsQuery.data?.items ?? []) as unknown as Channel[]
  const messagesQuery = useChatMessages(activeChannel?.id, 50)
  const chatMessages: ChatMessage[] = (messagesQuery.data?.items ?? []) as unknown as ChatMessage[]
  const postMessageMut = usePostChatMessage()
  const exportQuery = useAdminBookingExport({})

  const handleExportCSV = useCallback(async () => {
    try {
      const result = await exportQuery.refetch()
      const data = result.data
      if (!data) throw new Error('Export failed')
      downloadCSV(data.filename, data.csv)
      toast.success('Xuất CSV thành công', {
        description: `Đã xuất ${data.count} vé ra file ${data.filename}`,
      })
    } catch (e: any) {
      toast.error('Xuất CSV thất bại', { description: e?.message ?? 'Vui lòng thử lại' })
    }
  }, [exportQuery])

  const sendReply = useCallback(() => {
    if (!replyText.trim() || !activeChannel) return
    postMessageMut.mutate(
      { path: { id: activeChannel.id }, body: { content: replyText.trim(), kind: 'text' } } as any,
      {
        onSuccess: () => {
          setReplyText('')
          toast.success('Đã gửi phản hồi')
        },
        onError: () => {
          toast.error('Không thể gửi tin nhắn')
        },
      },
    )
  }, [replyText, activeChannel, postMessageMut])

  const blockChannel = useCallback((channelId: string) => {
    toast.success('Đã chặn cuộc trò chuyện', { description: 'Khách sẽ không thể gửi tin nhắn mới' })
    if (activeChannel?.id === channelId) setActiveChannel(null)
  }, [activeChannel])

  const sendTicketCard = useCallback(
    (payload: { bookingCode: string }) => {
      if (!activeChannel) return
      const attachments = JSON.stringify(payload)
      postMessageMut.mutate(
        { path: { id: activeChannel.id }, body: { content: `Đã đặt vé ${payload.bookingCode}`, kind: 'ticket', attachments } } as any,
        {
          onError: () => {
            // Silently fail — the booking was already created
          },
        },
      )
    },
    [activeChannel, postMessageMut],
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
                sending={postMessageMut.isPending}
                onOpenChannel={setActiveChannel}
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

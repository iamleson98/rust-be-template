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
  useAdminBookingExport,
} from '@/lib/queries'
import { useAdminChatWorkspace } from '@/components/admin/chat/use-admin-chat-workspace'
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
import type { DateRange } from './types'
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
  const exportQuery = useAdminBookingExport({})

  const chat = useAdminChatWorkspace()

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

  if (statsQuery.isLoading) {
    return <AdminDashboardSkeleton />
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="space-y-3 p-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
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
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${dateRange === opt.key
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

        <StatsOverview dateRange={dateRange} onExportCSV={handleExportCSV} />

        <div>
          <Tabs defaultValue="tickets">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="tickets" className="gap-1.5"><Ticket className="h-4 w-4" /> Vé đã bán</TabsTrigger>
              <TabsTrigger value="crud" className="gap-1.5"><Building2 className="h-4 w-4" /> Hãng xe &amp; Tuyến</TabsTrigger>
              <TabsTrigger value="chat" className="gap-1.5"><MessageSquare className="h-4 w-4" /> Hỗ trợ trực tuyến</TabsTrigger>
              <TabsTrigger value="campaigns" className="gap-1.5"><TrendingUp className="h-4 w-4" /> Khuyến mãi</TabsTrigger>
              <TabsTrigger value="reviews" className="gap-1.5"><Star className="h-4 w-4" /> Đánh giá</TabsTrigger>
            </TabsList>

            <TabsContent value="tickets">
              <TicketsPanel />
            </TabsContent>

            <TabsContent value="chat">
              <ChatPanel
                channels={chat.channels}
                activeChannel={chat.activeChannel}
                chatMessages={chat.chatMessages}
                replyText={chat.replyText}
                sending={chat.sending}
                onOpenChannel={chat.setActiveChannel}
                onSendReply={chat.sendReply}
                onBlockChannel={chat.blockChannel}
                onSetReplyText={chat.setReplyText}
                onSendTicketCard={chat.sendTicketCard}
                typingUser={chat.typingUser}
                userOnline={chat.userOnline}
                unreadPulseChannels={chat.unreadPulseChannels}
                hasMoreMessages={chat.hasMoreMessages}
                isFetchingMoreMessages={chat.isFetchingMoreMessages}
                onFetchMoreMessages={chat.fetchMoreMessages as any}
                chatStats={chat.chatStats}
                onViewTicket={(code) => {
                  const ev = new CustomEvent('admin:view-ticket', { detail: code })
                  window.dispatchEvent(ev)
                  if (typeof window !== 'undefined') {
                    const tabEl = document.querySelector('[data-state="inactive"][value="tickets"]') as HTMLButtonElement | null
                    tabEl?.click()
                  }
                }}
              />
            </TabsContent>

            <TabsContent value="crud">
              <AdminBrandManagement />
            </TabsContent>

            <TabsContent value="campaigns">
              <CampaignsPanel />
            </TabsContent>

            <TabsContent value="reviews">
              <ReviewsModerationPanel />
            </TabsContent>
          </Tabs>
        </div>

        <style dangerouslySetInnerHTML={{
          __html: `
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

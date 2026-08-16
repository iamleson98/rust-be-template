'use client'

import { useState } from 'react'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { useNotifications, useMarkNotificationsRead } from '@/lib/queries'
import type { NotificationItem } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Bell,
  CheckCheck,
  Ticket,
  Tag,
  MessageSquare,
  Clock,
  Sparkles,
  AlertCircle,
  Settings,
  X,
} from 'lucide-react'
import { relativeTime } from '@/lib/types'
import { toast } from 'sonner'
import { NoNotifications } from './empty-states'

const ICONS: Record<string, { icon: React.ReactNode; cls: string }> = {
  booking_confirmed: { icon: <Ticket className="h-4 w-4" />, cls: 'bg-blue-100 text-blue-700' },
  booking_cancelled: { icon: <X className="h-4 w-4" />, cls: 'bg-rose-100 text-rose-700' },
  chat_reply: { icon: <MessageSquare className="h-4 w-4" />, cls: 'bg-blue-100 text-blue-700' },
  promo: { icon: <Tag className="h-4 w-4" />, cls: 'bg-amber-100 text-amber-700' },
  trip_reminder: { icon: <Clock className="h-4 w-4" />, cls: 'bg-violet-100 text-violet-700' },
  system: { icon: <AlertCircle className="h-4 w-4" />, cls: 'bg-slate-100 text-slate-700' },
  badge: { icon: <Sparkles className="h-4 w-4" />, cls: 'bg-fuchsia-100 text-fuchsia-700' },
}

export function NotificationBell() {
  const { notifOpen, setNotifOpen, user } = useApp()
  const navigate = useNavigate()
  const isLoggedIn = !!user

  // Polling + dedup + caching handled by the centralized hook (60s interval).
  // The hook is disabled entirely for guests — no point fetching notifications
  // for an unauthenticated session.
  const { data, isLoading, isError, refetch } = useNotifications(20, { enabled: isLoggedIn })
  const { mutateAsync: markRead } = useMarkNotificationsRead()

  // Local optimistic map of id → readAt so the UI updates instantly when the
  // user clicks a notification (the server round-trip can take 100ms+).
  const [optimisticReads, setOptimisticReads] = useState<Record<string, string>>({})

  const items = data?.items ?? []
  const serverUnread = data?.unreadCount ?? data?.unread ?? 0
  // Apply optimistic reads to the items list + unread count.
  // A notification is "read" when either the backend's `read` flag is
  // true OR the frontend's optimistic `readAt` timestamp is set.
  const isRead = (n: NotificationItem) => n.read === true || !!optimisticReads[n.id]
  const effectiveItems = items.map((n) =>
    optimisticReads[n.id] ? { ...n, readAt: optimisticReads[n.id] } : n,
  )
  const unread = Math.max(
    0,
    serverUnread - effectiveItems.filter((n) => optimisticReads[n.id]).length,
  )

  const markAllRead = async () => {
    if (!isLoggedIn) return
    const unreadIds = effectiveItems.filter((n) => !isRead(n)).map((n) => n.id)
    if (unreadIds.length === 0) return
    // Optimistic update
    const nowIso = new Date().toISOString()
    setOptimisticReads((m) => {
      const next = { ...m }
      for (const id of unreadIds) next[id] = nowIso
      return next
    })
    try {
      await markRead(unreadIds)
      toast.success('Đã đánh dấu tất cả là đã đọc')
    } catch {
      // Roll back optimistic state on failure — the next poll will re-sync.
      setOptimisticReads((m) => {
        const next = { ...m }
        for (const id of unreadIds) delete next[id]
        return next
      })
      toast.error('Không thể đánh dấu đã đọc')
    }
  }

  const markSingleRead = async (id: string) => {
    // Optimistic
    const nowIso = new Date().toISOString()
    setOptimisticReads((m) => ({ ...m, [id]: nowIso }))
    try {
      await markRead([id])
    } catch {
      // Roll back on failure; next poll re-syncs.
      setOptimisticReads((m) => {
        const next = { ...m }
        delete next[id]
        return next
      })
    }
  }

  // ─── Hide for guests entirely (no point showing notifications for guests) ───
  if (!isLoggedIn) return null

  // If the user has never had any notifications, hide the bell to reduce clutter.
  // (We still keep it visible if there's any unread badge to draw attention.)
  const isEmpty = effectiveItems.length === 0 && unread === 0

  return (
    <>
      <button
        onClick={() => setNotifOpen(true)}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full text-blue-100 hover:bg-white/10 hover:text-white transition-colors ${isEmpty ? 'opacity-60 hidden sm:inline-flex' : ''
          }`}
        aria-label="Thông báo"
        title="Thông báo"
      >
        <Bell className={unread > 0 ? 'h-4 w-4 text-amber-300' : 'h-4 w-4'} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {notifOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setNotifOpen(false)} />
          <div className="fixed right-2 sm:right-4 top-16 z-50 w-[calc(100vw-1rem)] sm:w-100 max-h-[80vh] bg-white rounded-2xl ring-1 ring-black/10 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-linear-to-r from-blue-50 to-blue-50">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-linear-to-br from-blue-500 to-blue-500 text-white inline-flex items-center justify-center">
                  <Bell className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Thông báo</div>
                  <div className="text-[10px] text-muted-foreground">
                    {unread > 0 ? `${unread} chưa đọc` : 'Tất cả đã đọc'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={markAllRead}>
                    <CheckCheck className="h-3.5 w-3.5" />
                    Đọc hết
                  </Button>
                )}
                <button
                  onClick={() => setNotifOpen(false)}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-slate-200 text-muted-foreground"
                  aria-label="Đóng"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <ScrollArea className="flex-1 max-h-[60vh]">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Đang tải...</div>
              ) : isError ? (
                <div className="p-6 text-center">
                  <AlertCircle className="h-7 w-7 text-rose-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-3">Không thể tải thông báo</p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>
                    Thử lại
                  </Button>
                </div>
              ) : effectiveItems.length === 0 ? (
                <div className="p-4">
                  <NoNotifications />
                </div>
              ) : (
                <div className="divide-y">
                  {effectiveItems.map((n) => {
                    const cfg = ICONS[n.type] ?? ICONS.system
                    const isUnread = !isRead(n)
                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          // Mark as read on click (if unread)
                          if (isUnread) void markSingleRead(n.id)
                          if (n.link?.includes('my-bookings')) {
                            navigate({ to: '/bookings' })
                            setNotifOpen(false)
                          }
                        }}
                        className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-slate-50 transition-colors ${isUnread ? 'bg-blue-50/40' : ''
                          }`}
                      >
                        <div className={`h-9 w-9 shrink-0 rounded-full inline-flex items-center justify-center ${cfg.cls}`}>
                          {cfg.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm line-clamp-1">{n.title}</span>
                            {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                          <div className="text-[10px] text-muted-foreground mt-1">{relativeTime(n.createdAt)}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            <div className="border-t px-4 py-2 flex items-center justify-between bg-slate-50">
              <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <Settings className="h-3 w-3" />
                Cập nhật mỗi 60 giây
              </div>
              <button
                onClick={() => {
                  navigate({ to: '/bookings' })
                  setNotifOpen(false)
                }}
                className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
              >
                Xem vé của tôi →
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

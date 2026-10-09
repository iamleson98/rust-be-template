'use client'

/**
 * /account/notifications — full notification history.
 *
 * Previously this route was a dead-end stub (a title + one paragraph).
 * It now renders the real notification list from `GET /api/notifications`
 * (same data as the header bell, with a larger limit) plus mark-all-read.
 */

import { useQuery, useMutation } from '@tanstack/react-query'
import { notificationsListOptions, notificationsMarkReadMutation } from '@/api'
import { useSession } from '@/stores/session'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Bell,
  CheckCheck,
  Ticket,
  Tag,
  MessageSquare,
  Clock,
  Sparkles,
  AlertCircle,
  X,
} from 'lucide-react'
import { relativeTime } from '@/lib/format'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { getErrorMessage } from '@/lib/error-message'

const ICONS: Record<string, { icon: React.ReactNode; cls: string }> = {
  booking_confirmed: { icon: <Ticket className="h-4 w-4" />, cls: 'bg-blue-100 text-blue-700' },
  booking_cancelled: { icon: <X className="h-4 w-4" />, cls: 'bg-rose-100 text-rose-700' },
  chat_reply: { icon: <MessageSquare className="h-4 w-4" />, cls: 'bg-blue-100 text-blue-700' },
  promo: { icon: <Tag className="h-4 w-4" />, cls: 'bg-amber-100 text-amber-700' },
  trip_reminder: { icon: <Clock className="h-4 w-4" />, cls: 'bg-violet-100 text-violet-700' },
  system: { icon: <AlertCircle className="h-4 w-4" />, cls: 'bg-slate-100 text-slate-700' },
  badge: { icon: <Sparkles className="h-4 w-4" />, cls: 'bg-fuchsia-100 text-fuchsia-700' },
}

export function AccountNotificationsPage() {
  const user = useSession((s) => s.user)
  const navigate = useNavigate()
  const t = useT()
  const isLoggedIn = !!user

  const { data, isLoading, isError, refetch } = useQuery({ ...notificationsListOptions({ query: { limit: 50 } }), enabled: isLoggedIn })
  const { mutateAsync: markRead, isPending } = useMutation(notificationsMarkReadMutation())
  const [optimisticReads, setOptimisticReads] = useState<Record<string, string>>({})

  const items = data?.items ?? []
  const unreadCount =
    (data?.unreadCount ?? 0) - items.filter((n) => optimisticReads[n.id] && !n.read).length

  const markAllRead = async () => {
    try {
      // Empty ids = mark ALL of the user's unread notifications read.
      await markRead({ body: {} })
      setOptimisticReads({})
      toast.success(t('notifications.markedAllRead'))
    } catch (e) {
      toast.error(getErrorMessage(e, t('notifications.markReadFailed')))
    }
  }

  const openNotification = (id: string) => {
    if (!optimisticReads[id]) {
      setOptimisticReads((m) => ({ ...m, [id]: new Date().toISOString() }))
      markRead({ body: {} }).catch(() => undefined)
    }
    navigate({ to: '/account/trips' })
  }

  return (
    <div className="page-transition">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
        <Card>
          <CardHeader className="flex-row flex items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" /> {t('accountPage.notificationSettings')}
            </CardTitle>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={markAllRead}
                disabled={isPending}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t('notifications.readAll')}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!isLoggedIn ? (
              <p className="text-sm text-muted-foreground">{t('notifications.emptyDesc')}</p>
            ) : isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Skeleton className="size-9 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  {t('notifications.loadFailed')}
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-blue-50 text-blue-600">
                  <Bell className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-sm mb-1">{t('notifications.emptyTitle')}</h3>
                <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                  {t('notifications.emptyDesc')}
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((n) => {
                  const meta = ICONS[n.type] ?? ICONS.system
                  const isRead = n.read === true || !!optimisticReads[n.id]
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(n.id)}
                        className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-muted/40 rounded-lg px-2 -mx-2"
                      >
                        <span
                          className={`grid size-9 shrink-0 place-items-center rounded-lg ${meta.cls}`}
                        >
                          {meta.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            {n.title && (
                              <span
                                className={`text-sm line-clamp-1 ${isRead ? 'font-normal' : 'font-semibold'}`}
                              >
                                {n.title}
                              </span>
                            )}
                            {!isRead && (
                              <span
                                className="size-2 shrink-0 rounded-full bg-blue-500"
                                aria-hidden
                              />
                            )}
                          </span>
                          {n.body && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                              {n.body}
                            </p>
                          )}
                          <span className="block text-[10px] text-muted-foreground mt-1">
                            {relativeTime(n.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {isLoggedIn && items.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-4 text-center">
                {t('notifications.updatesEvery60s')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

'use client'

/**
 * AdminShell — sidebar + main content area for all /admin/* routes.
 *
 * Uses a custom flex layout (not the shadcn sidebar.tsx) because the
 * shadcn sidebar relies on CSS custom properties (--sidebar-width) that
 * don't cascade properly with Base UI's render prop pattern under
 * Tailwind v4. This custom implementation is simpler, more reliable,
 * and gives us full control over styling.
 *
 * Features:
 *   - Fixed-width sidebar (16rem) on desktop, collapsible to 3rem
 *   - Mobile: sidebar hidden, opens as a Sheet drawer
 *   - Gradient brand header
 *   - Grouped nav items with active state
 *   - User card + logout in footer
 *   - Ctrl+B keyboard shortcut to toggle collapse
 */

import { useState, useEffect } from 'react'
import { Link, useRouterState } from '@/router'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  LayoutDashboard,
  Ticket,
  MessageSquare,
  Star,
  MessageSquareWarning,
  Building2,
  Route as RouteIcon,
  CalendarDays,
  Armchair,
  CreditCard,
  Activity,
  CalendarClock,
  Eye,
  LogOut,
  Bus,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { useApp } from '@/lib/store'
import { useLogout } from '@/lib/queries'
import { cn } from '@/lib/utils'

const NAV_GROUPS = [
  {
    label: 'Tổng quan',
    items: [
      { title: 'Bảng điều khiển', icon: LayoutDashboard, url: '/admin' },
    ],
  },
  {
    label: 'Vận hành',
    items: [
      { title: 'Vé đã bán', icon: Ticket, url: '/admin/tickets' },
      { title: 'Hỗ trợ trực tuyến', icon: MessageSquare, url: '/admin/chat' },
      { title: 'Đánh giá', icon: Star, url: '/admin/reviews' },
      { title: 'Phản hồi', icon: MessageSquareWarning, url: '/admin/feedback' },
    ],
  },
  {
    label: 'Danh mục',
    items: [
      { title: 'Hãng xe & Tuyến', icon: Building2, url: '/admin/brands' },
      { title: 'Tuyến đường', icon: RouteIcon, url: '/admin/routes' },
      { title: 'Lịch trình', icon: CalendarDays, url: '/admin/schedules' },
      { title: 'Sơ đồ ghế', icon: Armchair, url: '/admin/bus-layouts' },
    ],
  },
  {
    label: 'Tài chính',
    items: [
      { title: 'Thanh toán', icon: CreditCard, url: '/admin/payments' },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      { title: 'Theo dõi hệ thống', icon: Activity, url: '/admin/system' },
      { title: 'Cron jobs', icon: CalendarClock, url: '/admin/cron-jobs' },
    ],
  },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user } = useApp()
  const logoutMut = useLogout()

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Ctrl+B to toggle collapse
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCollapsed((c) => !c)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const isActive = (url: string) => {
    if (url === '/admin') return pathname === '/admin'
    return pathname.startsWith(url)
  }

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'A'

  // Nav content — shared between desktop sidebar and mobile drawer
  const navContent = (
    <>
      {/* Header */}
      {/* <div className={cn(
        'bg-linear-to-br from-primary to-primary/80 shrink-0',
        collapsed ? 'px-2 py-3' : 'px-3 py-4',
      )}>
        <Link to="/admin" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
          <div className="flex aspect-square size-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20 shrink-0">
            <Bus className="size-5 text-white" />
          </div>
          {!collapsed && (
            <div className="grid flex-1 text-left text-sm leading-tight overflow-hidden">
              <span className="truncate font-bold text-white">VeXeVN</span>
              <span className="truncate text-xs text-white/70">Hệ thống quản trị</span>
            </div>
          )}
        </Link>
      </div> */}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 gap-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            {!collapsed && (
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 px-3 py-1.5">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.url)
                return (
                  <Link
                    key={item.url}
                    to={item.url as any}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.title : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg text-sm font-medium transition-all h-9',
                      collapsed ? 'justify-center px-0' : 'px-3',
                      active
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground/60')} />
                    {!collapsed && <span className="truncate">{item.title}</span>}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/40 px-2 py-2 shrink-0">
        <div className="space-y-0.5">
          <Link
            to="/"
            onClick={() => setMobileOpen(false)}
            title={collapsed ? 'Trang khách hàng' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all h-9',
              collapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <Eye className="size-4 shrink-0" />
            {!collapsed && <span>Trang khách hàng</span>}
          </Link>
          <button
            onClick={() => { logoutMut.mutate(); setMobileOpen(false) }}
            title={collapsed ? 'Đăng xuất' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all h-9 w-full',
              collapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && <span>Đăng xuất</span>}
          </button>
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2.5 px-3 py-2 mt-1 rounded-lg bg-muted/50">
            <Avatar className="size-8 ring-2 ring-primary/20 shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-xs leading-tight overflow-hidden">
              <span className="truncate font-semibold">{user?.name || 'Admin'}</span>
              <span className="truncate text-muted-foreground">{user?.email || ''}</span>
            </div>
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="flex w-full overflow-hidden bg-background">
      {/* Desktop sidebar — fixed width, hidden on mobile */}
      <aside
        className={cn(
          'hidden md:flex flex-col shrink-0 border-r border-border/40 bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        {navContent}
      </aside>

      {/* Mobile sidebar — Sheet drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0 [&>button]:hidden bg-sidebar text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>Admin sidebar</SheetTitle>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">
            {navContent}
          </div>
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <header className="flex h-14 items-center gap-2 border-b border-border/40 bg-background/95 backdrop-blur px-4 shrink-0">
          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden size-9"
            onClick={() => setMobileOpen(true)}
          >
            <PanelLeft className="size-4" />
          </Button>
          {/* Desktop collapse toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:flex size-9"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          <Separator orientation="vertical" className="mr-2 h-5" />
          <span className="text-sm font-medium text-muted-foreground truncate">
            {user?.name || 'Admin'} · VeXeVN Admin
          </span>
        </header>
        <div className="flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}

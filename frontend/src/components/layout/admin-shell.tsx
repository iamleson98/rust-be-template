'use client'

/**
 * AdminShell — sidebar + main content area for all /admin/* routes.
 *
 * Replaces the old top-tabs layout with a persistent left sidebar that
 * groups admin features by domain:
 *   - Tổng quan: Dashboard
 *   - Vận hành: Tickets, Chat, Reviews, Feedback
 *   - Danh mục: Brands, Routes, Schedules, Bus Layouts
 *   - Tài chính: Payments
 *   - Hệ thống: System Monitor
 *
 * Responsive:
 *   - Desktop (≥768px): Fixed 16rem sidebar, collapsible to 3rem icon rail.
 *   - Mobile (<768px): Sidebar hidden, opens as a Sheet drawer (hamburger).
 *
 * Uses the existing shadcn Sidebar component (was unused — now wired up).
 * Active-link highlighting via TanStack Router's pathname.
 */

import { Link, useRouterState } from '@/router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  LayoutDashboard,
  Ticket,
  MessageSquare,
  Star,
  MessageSquareWarning,
  Building2,
  Route,
  CalendarDays,
  Armchair,
  CreditCard,
  Activity,
  Eye,
  LogOut,
  Bus,
} from 'lucide-react'
import { useApp } from '@/lib/store'
import { useLogout } from '@/lib/queries'

// Nav items grouped by section
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
      { title: 'Tuyến đường', icon: Route, url: '/admin/routes' },
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
    ],
  },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user } = useApp()
  const logoutMut = useLogout()

  const isActive = (url: string) => {
    if (url === '/admin') return pathname === '/admin'
    return pathname.startsWith(url)
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        {/* ── Header: Logo + brand ─────────────────────────── */}
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/admin">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Bus className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">VeXeVN</span>
                    <span className="truncate text-xs text-muted-foreground">Quản trị</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* ── Nav groups ─────────────────────────────────────── */}
        <SidebarContent>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.url)
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                        >
                          <Link to={item.url as any}>
                            <Icon className="size-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        {/* ── Footer: user + actions ─────────────────────── */}
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Về trang khách hàng">
                <Link to="/">
                  <Eye className="size-4" />
                  <span>Trang khách hàng</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Đăng xuất"
                onClick={() => logoutMut.mutate()}
              >
                <LogOut className="size-4" />
                <span>Đăng xuất</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {/* ── Main content area ─────────────────────────────── */}
      <SidebarInset>
        {/* Top bar with sidebar trigger */}
        <header className="flex h-14 items-center gap-2 border-b px-4 bg-background sticky top-0 z-30">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {user?.name || 'Admin'}
            </span>
          </div>
        </header>

        {/* Route content */}
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

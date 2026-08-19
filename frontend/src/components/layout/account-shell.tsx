'use client'

/**
 * AccountShell — sidebar + main content area for user account pages.
 *
 * Provides a persistent left sidebar with sections:
 *   - Tài khoản: Profile, Bookings
 *   - Tiện ích: Wishlist, Loyalty Points
 *   - Cài đặt: Notifications, Security
 *
 * Responsive:
 *   - Desktop (≥768px): Fixed 16rem sidebar, collapsible to 3rem icon rail.
 *   - Mobile (<768px): Sidebar hidden, opens as a Sheet drawer (hamburger).
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
import { Separator } from '@/components/ui/separator'
import {
  UserCircle,
  Ticket,
  Heart,
  Gift,
  Bell,
  ShieldCheck,
  Bus,
  ArrowLeft,
  LogOut,
} from 'lucide-react'
import { useApp } from '@/lib/store'
import { useLogout } from '@/lib/queries'

const NAV_GROUPS = [
  {
    label: 'Tài khoản',
    items: [
      { title: 'Hồ sơ cá nhân', icon: UserCircle, url: '/account' },
      { title: 'Vé của tôi', icon: Ticket, url: '/bookings' },
    ],
  },
  {
    label: 'Tiện ích',
    items: [
      { title: 'Danh sách yêu thích', icon: Heart, url: '/account/wishlist' },
      { title: 'Điểm thưởng', icon: Gift, url: '/account/loyalty' },
    ],
  },
  {
    label: 'Cài đặt',
    items: [
      { title: 'Thông báo', icon: Bell, url: '/account/notifications' },
      { title: 'Bảo mật', icon: ShieldCheck, url: '/account/security' },
    ],
  },
]

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user } = useApp()
  const logoutMut = useLogout()

  const isActive = (url: string) => {
    if (url === '/account') return pathname === '/account'
    return pathname.startsWith(url)
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        {/* ── Header ─────────────────────────────────────────── */}
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/account">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Bus className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">VeXeVN</span>
                    <span className="truncate text-xs text-muted-foreground">Tài khoản</span>
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

        {/* ── Footer ────────────────────────────────────────── */}
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Về trang chủ">
                <Link to="/">
                  <ArrowLeft className="size-4" />
                  <span>Trang chủ</span>
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
        <header className="flex h-14 items-center gap-2 border-b px-4 bg-background sticky top-0 z-30">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium text-muted-foreground">
            {user?.name || 'Tài khoản'}
          </span>
        </header>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

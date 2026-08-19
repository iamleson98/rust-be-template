'use client'

/**
 * AccountShell — sidebar + main content area for user account pages.
 *
 * Professional sidebar with:
 *   - Gradient brand header
 *   - Grouped nav items with icons
 *   - User avatar + logout in footer
 *   - Collapsible + mobile drawer
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
  SidebarRail,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { cn } from '@/lib/utils'

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

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U'

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-border/40">
        {/* ── Header ─────────────────────────────────────────── */}
        <SidebarHeader className="bg-gradient-to-br from-primary to-primary/80 px-3 py-4">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild className="hover:bg-white/10">
                <Link to="/account">
                  <div className="flex aspect-square size-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
                    <Bus className="size-5 text-white" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-bold text-white">VeXeVN</span>
                    <span className="truncate text-xs text-white/70">Tài khoản của tôi</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* ── Nav ────────────────────────────────────────────── */}
        <SidebarContent className="px-2 py-3 gap-1">
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label} className="px-0">
              <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 px-3 py-1.5">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = isActive(item.url)
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                          className={cn(
                            'h-9 px-3 rounded-lg text-sm font-medium transition-all',
                            active
                              ? 'bg-primary/10 text-primary font-semibold'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                        >
                          <Link to={item.url as any}>
                            <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground/60')} />
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
        <SidebarFooter className="border-t border-border/40 px-2 py-2">
          <SidebarMenu className="gap-0.5">
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Trang chủ" className="h-9 px-3 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                <Link to="/">
                  <ArrowLeft className="size-4 shrink-0" />
                  <span>Trang chủ</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Đăng xuất"
                className="h-9 px-3 rounded-lg text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                onClick={() => logoutMut.mutate()}
              >
                <LogOut className="size-4 shrink-0" />
                <span>Đăng xuất</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {/* User card */}
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/50">
            <Avatar className="size-8 ring-2 ring-primary/20">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-xs leading-tight overflow-hidden">
              <span className="truncate font-semibold">{user?.name || 'Người dùng'}</span>
              <span className="truncate text-muted-foreground">{user?.email || ''}</span>
            </div>
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      {/* ── Main content ─────────────────────────────────────── */}
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 sticky top-0 z-30">
          <SidebarTrigger className="size-8" />
          <Separator orientation="vertical" className="mr-2 h-5" />
          <span className="text-sm font-medium text-muted-foreground truncate">
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

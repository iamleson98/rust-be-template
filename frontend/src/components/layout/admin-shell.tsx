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
 *   - Fixed app layout: the shell fills the viewport below the global
 *     4rem header and the
 *     CONTENT pane is the scroll container — the sidebar (and the top
 *     bar) stay pinned in place no matter how far the page content
 *     scrolls (they never scroll out of view).
 *   - Fixed-width sidebar (16rem) on desktop, collapsible to 3rem
 *   - Mobile: sidebar hidden, opens as a Sheet drawer
 *   - Grouped nav items with active state
 *   - User card + logout in footer
 *   - Ctrl+B keyboard shortcut to toggle collapse
 */

import { useState, useEffect } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
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
  MessageSquareWarning,
  Building2,
  Armchair,
  CreditCard,
  Activity,
  CalendarClock,
  Eye,
  LogOut,
  Bus,
  PanelLeftClose,
  PanelLeft,
  Users,
} from 'lucide-react'
import { useApp } from '@/lib/store'
import { useLogout } from '@/lib/queries'
import { useT, type Lang } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Nav groups — labels resolve through the i18n dictionary so the
 *  admin sidebar follows the VI/EN language switch. */
const navGroups = (t: (k: string) => string) => [
  {
    label: t('admin.group.overview'),
    items: [
      { title: t('admin.dashboard'), icon: LayoutDashboard, url: '/admin' },
    ],
  },
  {
    label: t('admin.group.operations'),
    items: [
      { title: t('admin.ticketsSold'), icon: Ticket, url: '/admin/tickets' },
      { title: t('admin.chatOnline'), icon: MessageSquare, url: '/admin/chat' },
      { title: t('admin.feedback'), icon: MessageSquareWarning, url: '/admin/feedback' },
    ],
  },
  {
    label: t('admin.group.catalog'),
    items: [
      { title: t('admin.brands'), icon: Building2, url: '/admin/brands' },
      { title: t('admin.busLayouts'), icon: Armchair, url: '/admin/bus-layouts' },
      { title: t('admin.vehicleTypes'), icon: Bus, url: '/admin/vehicle-types' },
    ],
  },
  {
    label: t('admin.group.finance'),
    items: [
      { title: t('admin.payments'), icon: CreditCard, url: '/admin/payments' },
    ],
  },
  {
    label: t('admin.group.system'),
    items: [
      { title: t('admin.systemMonitoring'), icon: Activity, url: '/admin/system' },
      { title: t('admin.cronJobs'), icon: CalendarClock, url: '/admin/cron-jobs' },
    ],
  },
]

/** Admin-only navigation entries. Employees never see these — the
 *  backend also enforces the permission (`admin:users:manage-roles` /
 *  cron-jobs perms), so hiding is UX, not security. */
const adminOnlyItems = (t: (k: string) => string) => [
  { title: t('admin.users'), icon: Users, url: '/admin/users' },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user, lang, setLang } = useApp()
  const logoutMut = useLogout()
  const t = useT()

  // Admin-only entries (Users / governance) merge into the nav for
  // admins. Employees keep the operational view.
  const isAdmin = user?.type === 'admin'
  const groups = isAdmin
    ? [
        ...navGroups(t).slice(0, 5),
        {
          label: t('admin.group.governance'),
          items: adminOnlyItems(t),
        },
      ]
    : navGroups(t)

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
              <span className="truncate font-bold text-white">DatXeVui</span>
              <span className="truncate text-xs text-white/70">{t('admin.adminSystem')}</span>
            </div>
          )}
        </Link>
      </div> */}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 gap-1">
        {groups.map((group) => (
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
                    to={item.url as never}
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
          {/* Language switcher — VI/EN, persisted via the app store. */}
          <div className={cn('flex items-center rounded-lg transition-all h-9', collapsed ? 'justify-center px-0' : 'px-2 gap-1')}>
            {(['vi', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code as Lang)}
                aria-pressed={lang === code}
                title={code === 'vi' ? 'Tiếng Việt' : 'English'}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                  lang === code
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {code === 'vi' ? 'VI' : 'EN'}
              </button>
            ))}
          </div>
          <Link
            to="/"
            onClick={() => setMobileOpen(false)}
            title={collapsed ? t('admin.customerSite') : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all h-9',
              collapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <Eye className="size-4 shrink-0" />
            {!collapsed && <span>{t('admin.customerSite')}</span>}
          </Link>
          <button
            onClick={() => { logoutMut.mutate(); setMobileOpen(false) }}
            title={collapsed ? t('auth.logout') : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all h-9 w-full',
              collapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && <span>{t('auth.logout')}</span>}
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
    <div className="flex w-full h-[calc(100dvh-4rem)] overflow-hidden bg-background">
      {/* Desktop sidebar — in-flow but full viewport height (the shell is
       * h-dvh and only the content pane scrolls), so it stays pinned to
       * the left edge for the entire page. */}
      <aside
        className={cn(
          'hidden md:flex flex-col shrink-0 h-full border-r border-border/40 bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear',
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

      {/* Main content — also viewport-height; only this pane's content
       * area scrolls (overflow-y-auto), so the header + sidebar remain
       * fixed on screen while the page data scrolls beneath them. */}
      <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/40 bg-background/95 backdrop-blur px-4">
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
            {user?.name || 'Admin'} · DatXeVui Admin
          </span>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  )
}

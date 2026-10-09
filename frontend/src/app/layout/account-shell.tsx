import { useSession } from '@/stores/session'
import { useState, useEffect } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  UserCircle,
  Gift,
  KeyRound,
  History,
  ArrowLeft,
  LogOut,
  MessageSquareHeart,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { useLogout } from '@/features/auth/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const NAV_GROUPS = (t: (k: string) => string) => [
  {
    label: t('auth.account'),
    items: [
      { title: t('layout.account.overview'), icon: UserCircle, url: '/account' },
      { title: t('layout.account.tripHistory'), icon: History, url: '/account/trips' },
    ],
  },
  {
    label: t('bookingHistory.reviews'),
    items: [
      {
        title: t('layout.account.tripFeedback'),
        icon: MessageSquareHeart,
        url: '/account/feedback',
      },
    ],
  },
  {
    label: t('layout.account.utilities'),
    items: [{ title: t('nav.loyalty'), icon: Gift, url: '/account/loyalty' }],
  },
  {
    label: t('account.settings'),
    items: [{ title: t('accountPage.passwordShort'), icon: KeyRound, url: '/account/password' }],
  },
]

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const user = useSession((s) => s.user)
  const logout = useLogout()
  const t = useT()

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
    if (url === '/account') return pathname === '/account'
    return pathname.startsWith(url)
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U'

  const navContent = (
    <>
      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 gap-1">
        {NAV_GROUPS(t).map((group) => (
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
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-primary' : 'text-muted-foreground/60',
                      )}
                    />
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
            title={collapsed ? t('nav.home') : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all h-9',
              collapsed ? 'justify-center px-0' : 'px-3',
            )}
          >
            <ArrowLeft className="size-4 shrink-0" />
            {!collapsed && <span>{t('nav.home')}</span>}
          </Link>
          <button
            onClick={() => {
              logout()
              setMobileOpen(false)
            }}
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
              <span className="truncate font-semibold">
                {user?.name || t('accountPage.fallbackUserName')}
              </span>
              <span className="truncate text-muted-foreground">{user?.email || ''}</span>
            </div>
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="flex w-full h-dvh overflow-hidden bg-background">
      <aside
        className={cn(
          'hidden md:flex flex-col shrink-0 h-full border-r border-border/40 text-sidebar-foreground transition-[width] duration-200 ease-linear',
          collapsed ? 'w-14' : 'w-64',
        )}
      >
        {navContent}
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 [&>button]:hidden bg-sidebar text-sidebar-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Account sidebar</SheetTitle>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{navContent}</div>
        </SheetContent>
      </Sheet>

      {/* Main content — only this pane's content area scrolls */}
      <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/40 bg-background/95 backdrop-blur px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden size-9"
            onClick={() => setMobileOpen(true)}
          >
            <PanelLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:flex size-9"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          <Separator orientation="vertical" className="mr-2 h-full" />
          <span className="text-sm font-medium text-muted-foreground truncate">
            {user?.name || t('auth.account')}
          </span>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  )
}

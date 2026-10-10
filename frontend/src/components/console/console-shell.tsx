import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { LogOut, Menu, PanelLeft, PanelLeftClose, type LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useLogout } from '@/features/auth/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useSession } from '@/stores/session'

export type ConsoleNavItem = {
  title: string
  /** A shorter label for the phone tab bar (defaults to `title`). */
  short?: string
  icon: LucideIcon
  url: string
  /** Active on this exact path only (a console's home page). */
  exact?: boolean
}
export type ConsoleNavGroup = { label: string; items: ConsoleNavItem[] }

const COLLAPSED_KEY = 'console.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function initialsOf(name: string | undefined, fallback: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length
    ? parts
        .map((p) => p[0])
        .slice(-2)
        .join('')
        .toUpperCase()
    : fallback
}

/**
 * The frame both consoles (account and admin) share: a sidebar on desktop
 * (collapsible, remembered). On phones, a console with up to five sections
 * gets a bottom tab bar (every section in thumb reach, like a native app);
 * a bigger one gets a slim top bar with a menu drawer. Only the content
 * pane scrolls.
 */
export function ConsoleShell({
  label,
  groups,
  exit,
  mobileNav,
  children,
}: {
  /** Accessible name of the navigation ("Admin", "Account"). */
  label: string
  groups: ConsoleNavGroup[]
  /** The way out of the console, shown above sign-out. */
  exit: { title: string; icon: LucideIcon; to: '/' }
  /** Phones: `tabs` = bottom tab bar (at most five sections), `drawer` = menu. */
  mobileNav: 'tabs' | 'drawer'
  children: ReactNode
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const t = useT()
  const user = useSession((s) => s.user)
  const logout = useLogout()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const items = groups.flatMap((g) => g.items)
  const isActive = (item: ConsoleNavItem) =>
    item.exact ? pathname === item.url : pathname.startsWith(item.url)
  const current = items.find(isActive)

  // New page: content back to the top.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // private mode: the sidebar simply starts expanded next time
    }
  }, [collapsed])

  // Ctrl/⌘+B collapses the sidebar, like most desktop consoles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCollapsed((c) => !c)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navLink = (item: ConsoleNavItem, compact: boolean) => {
    const active = isActive(item)
    const Icon = item.icon
    return (
      <Link
        key={item.url}
        to={item.url as never}
        onClick={() => setDrawerOpen(false)}
        title={compact ? item.title : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-9 items-center gap-2.5 rounded-lg text-sm transition-colors',
          compact ? 'justify-center' : 'px-3',
          active
            ? 'bg-primary/10 font-semibold text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {!compact && <span className="truncate">{item.title}</span>}
      </Link>
    )
  }

  const nav = (compact: boolean) => (
    <>
      <nav aria-label={label} className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.label}>
            {!compact && (
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">{group.items.map((item) => navLink(item, compact))}</div>
          </div>
        ))}
      </nav>
      <div className="shrink-0 space-y-0.5 border-t px-2 py-2">
        <Link
          to={exit.to}
          onClick={() => setDrawerOpen(false)}
          title={compact ? exit.title : undefined}
          className={cn(
            'flex h-9 items-center gap-2.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            compact ? 'justify-center' : 'px-3',
          )}
        >
          <exit.icon className="size-4 shrink-0" aria-hidden />
          {!compact && <span>{exit.title}</span>}
        </Link>
        <button
          type="button"
          onClick={() => {
            setDrawerOpen(false)
            logout()
          }}
          title={compact ? t('auth.logout') : undefined}
          className={cn(
            'flex h-9 w-full items-center gap-2.5 rounded-lg text-sm text-rose-600 transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/30',
            compact ? 'justify-center' : 'px-3',
          )}
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          {!compact && <span>{t('auth.logout')}</span>}
        </button>
        {!compact && user && (
          <div className="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2">
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                {initialsOf(user.name, 'U')}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 text-xs leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-muted-foreground">{user.email ?? user.phone}</span>
            </div>
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="flex h-[calc(100dvh-var(--header-h))] w-full overflow-hidden bg-background">
      <aside
        className={cn(
          'hidden h-full shrink-0 flex-col border-r transition-[width] duration-200 ease-out md:flex',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        {nav(collapsed)}
      </aside>

      {mobileNav === 'drawer' && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-72 p-0 [&>button]:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>{label}</SheetTitle>
            </SheetHeader>
            <div className="flex h-full flex-col">{nav(false)}</div>
          </SheetContent>
        </Sheet>
      )}

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Desktop: collapse toggle + where you are. */}
        <div className="hidden h-12 shrink-0 items-center gap-2 border-b px-3 md:flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? t('console.expandSidebar') : t('console.collapseSidebar')}
          >
            {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          <span className="truncate text-sm font-medium">{current?.title ?? label}</span>
        </div>

        {/* Phones, many sections: a slim bar with the menu. */}
        {mobileNav === 'drawer' && (
          <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('console.openMenu')}
            >
              <Menu className="size-5" />
            </Button>
            <span className="truncate text-sm font-semibold">{current?.title ?? label}</span>
          </div>
        )}

        {/* No scroll anchoring: placeholders swapping for content must not move the page. */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto overscroll-contain bg-canvas [overflow-anchor:none]"
        >
          {children}
        </div>

        {/* Phones, few sections: every one in a bottom tab bar. */}
        {mobileNav === 'tabs' && (
          <nav
            aria-label={label}
            className="grid shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
            style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
          >
            {items.map((item) => {
              const active = isActive(item)
              return (
                <Link
                  key={item.url}
                  to={item.url as never}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-14 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] transition-colors',
                    active ? 'font-semibold text-primary' : 'text-muted-foreground',
                  )}
                >
                  <item.icon className="size-5" aria-hidden />
                  <span className="max-w-full truncate">{item.short ?? item.title}</span>
                </Link>
              )
            })}
          </nav>
        )}
      </div>
    </div>
  )
}

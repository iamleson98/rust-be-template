import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Check,
  ChevronsUpDown,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  type LucideIcon,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useLogout } from '@/features/auth/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/stores/prefs'
import { isStaffUser, useSession } from '@/stores/session'

export type ConsoleNavItem = {
  title: string
  icon: LucideIcon
  url: string
  /** Active on this exact path only (a console's home page). */
  exact?: boolean
}
/** A run of sections; `label` is left out for a group that needs no heading. */
export type ConsoleNavGroup = { label?: string; items: ConsoleNavItem[] }

const COLLAPSED_KEY = 'console.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function initialsOf(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return (
    parts
      .map((p) => p[0])
      .slice(-2)
      .join('')
      .toUpperCase() || 'U'
  )
}

/**
 * The admin console's frame, in the site's light look: a white sidebar
 * with the logo and the sections (collapsible on desktop, a drawer on
 * phones), one slim top bar with where you are and the account menu, and
 * a canvas content pane that alone scrolls.
 */
export function ConsoleShell({
  label,
  groups,
  exit,
  children,
}: {
  /** Accessible name of the navigation, also shown under the logo ("Admin"). */
  label: string
  groups: ConsoleNavGroup[]
  /** The way out of the console, at the foot of the sidebar. */
  exit: { title: string; icon: LucideIcon; to: '/' }
  children: ReactNode
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const t = useT()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const isActive = (item: ConsoleNavItem) =>
    item.exact ? pathname === item.url : pathname.startsWith(item.url)

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

  const row = (compact: boolean) =>
    cn(
      'flex h-9 items-center gap-3 rounded-lg text-sm transition-colors',
      compact ? 'justify-center' : 'px-3',
    )
  const brand = (
    <>
      <img src="/logo.svg" alt="" className="size-8 shrink-0" />
      <span className="min-w-0 leading-tight">
        <span className="block text-[15px] font-bold tracking-tight text-slate-900">DatXeVui</span>
        <span className="block text-[11px] font-medium text-slate-500">{label}</span>
      </span>
    </>
  )

  const nav = (compact: boolean) => (
    <nav aria-label={label} className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((group, i) => (
        <div key={group.label ?? i}>
          {group.label && !compact && (
            <div className="px-3 pb-1.5 text-xs font-medium text-slate-400">{group.label}</div>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item)
              return (
                <Link
                  key={item.url}
                  to={item.url as never}
                  activeOptions={{ exact: !!item.exact }}
                  onClick={() => setDrawerOpen(false)}
                  title={compact ? item.title : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    row(compact),
                    active
                      ? 'bg-primary/8 font-semibold text-primary'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  )}
                >
                  <item.icon className="size-4.5 shrink-0" aria-hidden />
                  {!compact && <span className="truncate">{item.title}</span>}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )

  const exitLink = (compact: boolean) => (
    <Link
      to={exit.to}
      onClick={() => setDrawerOpen(false)}
      title={compact ? exit.title : undefined}
      className={cn(row(compact), 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}
    >
      <exit.icon className="size-4.5 shrink-0" aria-hidden />
      {!compact && <span className="truncate">{exit.title}</span>}
    </Link>
  )

  const toggleLabel = collapsed ? t('console.expandSidebar') : t('console.collapseSidebar')

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      {/* Desktop: the sidebar is the whole chrome — pages get the full height. */}
      <aside
        className={cn(
          'hidden h-full shrink-0 flex-col border-r border-slate-200/80 bg-white transition-[width] duration-200 ease-out md:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 px-3">
          {collapsed ? (
            // Collapsed: the logo is the way back (it turns into the expand icon on hover).
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title={toggleLabel}
              aria-label={toggleLabel}
              className="group grid size-10 place-items-center rounded-lg hover:bg-slate-50"
            >
              <img src="/logo.svg" alt="" className="size-8 group-hover:hidden" />
              <PanelLeft className="hidden size-4.5 text-slate-500 group-hover:block" />
            </button>
          ) : (
            <>
              <Link to="/admin" className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
                {brand}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-slate-400 hover:text-slate-700"
                onClick={() => setCollapsed(true)}
                title={`${toggleLabel} (Ctrl/⌘ B)`}
                aria-label={toggleLabel}
              >
                <PanelLeftClose className="size-4" />
              </Button>
            </>
          )}
        </div>
        {nav(collapsed)}
        <div className="shrink-0 space-y-1 border-t border-slate-100 p-3">
          {exitLink(collapsed)}
          <AccountMenu variant={collapsed ? 'avatar' : 'card'} />
        </div>
      </aside>

      {/* Phones: the same sections in a drawer. */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-72 bg-white p-0 [&>button]:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>{label}</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">
            <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">{brand}</div>
            {nav(false)}
            <div className="shrink-0 border-t border-slate-100 p-3">{exitLink(false)}</div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-slate-200/80 bg-white/90 pr-2 pl-1 backdrop-blur-xl md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-slate-600"
            onClick={() => setDrawerOpen(true)}
            aria-label={t('console.openMenu')}
          >
            <Menu className="size-5" />
          </Button>
          <Link to="/admin" className="flex min-w-0 items-center gap-2.5">
            {brand}
          </Link>
          <div className="ml-auto">
            <AccountMenu variant="avatar" />
          </div>
        </header>

        {/* No scroll anchoring: placeholders swapping for content must not move the page. */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** Who is signed in, the language, and the way out. `card` = the sidebar foot, `avatar` = just the face. */
function AccountMenu({ variant }: { variant: 'card' | 'avatar' }) {
  const t = useT()
  const user = useSession((s) => s.user)
  const lang = usePrefs((s) => s.lang)
  const setLang = usePrefs((s) => s.setLang)
  const logout = useLogout()
  if (!user) return null

  const role = !isStaffUser(user)
    ? null
    : user.employeeRole === 'admin'
      ? t('nav.role.admin')
      : user.employeeRole === 'support_lead'
        ? t('nav.role.supportLead')
        : user.employeeRole === 'ops'
          ? t('nav.role.operations')
          : t('nav.role.support')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={user.name}
            title={variant === 'avatar' ? user.name : undefined}
            className={cn(
              'flex items-center rounded-lg text-left transition-colors hover:bg-slate-50',
              variant === 'card' ? 'h-12 w-full gap-2.5 px-2' : 'size-10 justify-center',
            )}
          />
        }
      >
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            {initialsOf(user.name)}
          </AvatarFallback>
        </Avatar>
        {variant === 'card' && (
          <>
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium text-slate-900">{user.name}</span>
              <span className="truncate text-xs text-slate-500">{role}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-slate-400" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={variant === 'card' ? 'top' : 'bottom'}
        align={variant === 'card' ? 'start' : 'end'}
        className="w-64"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
            <div className="truncate text-xs text-slate-500">{user.email ?? user.phone}</div>
            {role && (
              <div className="mt-1.5 inline-flex rounded-md bg-primary/8 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {role}
                {user.brandName ? ` · ${user.brandName}` : ''}
              </div>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {(['vi', 'en'] as const).map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLang(l)} className="gap-2">
            <Check className={cn('size-4 text-primary', lang !== l && 'invisible')} />
            {l === 'vi' ? 'Tiếng Việt' : 'English'}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="gap-2 text-rose-600 focus:bg-rose-50 focus:text-rose-700"
        >
          <LogOut className="size-4" /> {t('auth.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

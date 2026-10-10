'use client'

import { memo, useCallback } from 'react'
import { useUi } from '@/stores/ui'
import { usePrefs } from '@/stores/prefs'
import { isStaffUser, useSession } from '@/stores/session'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { useLogout } from '@/features/auth/api'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  LayoutDashboard,
  Globe,
  Gift,
  Check,
  GitCompare,
  LogIn,
  LogOut,
  Phone,
  Briefcase,
  Ticket,
  Mail,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** The site's light, translucent bar (the admin console has its own frame). */
const tone = {
  bar: 'border-b border-slate-200/80 bg-white/85 text-slate-900 backdrop-blur-xl',
  icon: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
}

export const Header = memo(function Header() {
  const compareCount = useUi((s) => s.compareList.length)
  const setCompareOpen = useUi((s) => s.setCompareOpen)
  const setLoyaltyOpen = useUi((s) => s.setLoyaltyOpen)
  const lang = usePrefs((s) => s.lang)
  const setLang = usePrefs((s) => s.setLang)
  const user = useSession((s) => s.user)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const t = useT()

  const handleLangChange = useCallback(
    (newLang: 'vi' | 'en') => {
      setLang(newLang)
      toast.success(newLang === 'vi' ? t('lang.switchedVi') : t('lang.switchedEn'))
    },
    [setLang, t],
  )

  const logout = useLogout()

  const initials = (user?.name ?? '?')
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(-2)
    .join('')
    .toUpperCase()

  // Primary destinations, from md up (phones have the bottom tab bar).
  const links = [
    { to: '/search', label: t('nav.searchTrips'), active: pathname === '/search' },
    ...(user && !isStaffUser(user)
      ? [
          {
            to: '/account/trips',
            label: t('layout.account.tripsShort'),
            active: pathname.startsWith('/account/trips'),
          },
        ]
      : []),
  ] as const

  return (
    <header className={cn('sticky top-0 z-40 w-full', tone.bar)}>
      <div className="page-x flex h-(--header-h) items-center gap-2">
        <Link to="/" className="group flex shrink-0 items-center gap-2.5" aria-label="DatXeVui">
          <img
            src="/logo.svg"
            alt=""
            aria-hidden
            className="size-8 shrink-0 transition-transform duration-300 group-hover:scale-105 md:size-9"
          />
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight text-slate-900">DatXeVui</div>
            <div className="-mt-0.5 hidden text-[10px] text-slate-500 sm:block">
              {t('trips.imageTagline')}
            </div>
          </div>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label={t('nav.home')}>
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              aria-current={l.active ? 'page' : undefined}
              className={cn(
                'rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                l.active ? 'bg-primary/10 text-primary' : tone.icon,
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          {compareCount > 0 && (
            <button
              onClick={() => setCompareOpen(true)}
              className={cn(
                'relative inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-50 px-3 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100',
              )}
              title={t('nav.compare')}
            >
              <GitCompare className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t('nav.compare')}</span>
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                {compareCount}
              </span>
            </button>
          )}

          <button
            onClick={() => setLoyaltyOpen(true)}
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-full transition-colors',
              tone.icon,
            )}
            title={t('nav.loyalty')}
            aria-label={t('nav.loyalty')}
          >
            <Gift className="size-4.5" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('h-9 gap-1.5 rounded-full px-2.5', tone.icon)}
                />
              }
            >
              <Globe className="size-4" />
              <span className="hidden text-xs font-semibold sm:inline">
                {lang === 'vi' ? 'VI' : 'EN'}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => handleLangChange('vi')}
                className="flex items-center gap-2"
              >
                <Check className={cn('size-3.5 text-primary', lang !== 'vi' && 'invisible')} />
                Tiếng Việt
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleLangChange('en')}
                className="flex items-center gap-2"
              >
                <Check className={cn('size-3.5 text-primary', lang !== 'en' && 'invisible')} />
                English
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {!user ? (
            pathname !== '/login' && (
              <Button
                onClick={() => navigate({ to: '/login' })}
                size="sm"
                className="ml-1 h-9 gap-1.5 rounded-full px-4"
              >
                <LogIn className="size-4" />
                {t('nav.login')}
              </Button>
            )
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    title={user.name}
                    aria-label={user.name}
                    className="ml-1 inline-flex h-9 items-center gap-2 rounded-full bg-white p-1 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 sm:pr-3"
                  />
                }
              >
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary text-[11px] font-bold text-primary-foreground">
                    {initials || 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-30 truncate text-xs font-semibold sm:inline">
                  {user.name}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex items-center gap-2.5">
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                        {initials || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{user.name}</div>
                      <div className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                        {user.email ? (
                          <>
                            <Mail className="size-3 shrink-0" />
                            <span className="truncate">{user.email}</span>
                          </>
                        ) : (
                          <>
                            <Phone className="size-3 shrink-0" />
                            <span className="truncate">{user.phone}</span>
                          </>
                        )}
                      </div>
                      {isStaffUser(user) && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                          <Briefcase className="size-2.5" />
                          {user.employeeRole === 'admin'
                            ? t('nav.role.admin')
                            : user.employeeRole === 'support_lead'
                              ? t('nav.role.supportLead')
                              : user.employeeRole === 'ops'
                                ? t('nav.role.operations')
                                : t('nav.role.support')}
                          {user.brandName ? ` · ${user.brandName}` : ''}
                        </div>
                      )}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: '/account' })} className="gap-2">
                  <LayoutDashboard className="size-4" /> {t('nav.myConsole')}
                </DropdownMenuItem>
                {!isStaffUser(user) && (
                  <DropdownMenuItem
                    onClick={() => navigate({ to: '/account/trips' })}
                    className="gap-2"
                  >
                    <Ticket className="size-4" /> {t('layout.account.tripHistory')}
                  </DropdownMenuItem>
                )}
                {isStaffUser(user) && (
                  <DropdownMenuItem onClick={() => navigate({ to: '/admin' })} className="gap-2">
                    <Briefcase className="size-4" /> {t('nav.admin')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="gap-2 text-rose-600 focus:bg-rose-50 focus:text-rose-700"
                >
                  <LogOut className="size-4" /> {t('nav.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  )
})

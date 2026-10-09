'use client'

import { memo, useCallback } from 'react'
import { useUi } from '@/stores/ui'
import { usePrefs } from '@/stores/prefs'
import { isStaffUser, useSession } from '@/stores/session'
import { useNavigate } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { useLogout } from '@/features/auth/api'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { LayoutDashboard, Globe, Gift, Check, LogIn, LogOut, Phone, Briefcase } from 'lucide-react'
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

export const Header = memo(function Header() {
  const compareCount = useUi((s) => s.compareList.length)
  const setCompareOpen = useUi((s) => s.setCompareOpen)
  const setLoyaltyOpen = useUi((s) => s.setLoyaltyOpen)
  const lang = usePrefs((s) => s.lang)
  const setLang = usePrefs((s) => s.setLang)
  const user = useSession((s) => s.user)
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

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 text-white">
      {/* Gradient background layer */}
      <div className="absolute inset-0 -z-10 bg-blue-900/90 backdrop-blur-xl bg-linear-to-r from-blue-900 via-blue-800 to-blue-900" />

      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <button onClick={() => navigate({ to: '/' })} className="flex items-center gap-2.5 group">
          <img
            src="/logo.svg"
            alt=""
            aria-hidden
            className="h-9 w-9 shrink-0 transition-transform duration-300 group-hover:scale-105"
          />
          <div className="leading-tight">
            <div className="font-extrabold text-lg tracking-tight">DatXeVui</div>
            <div className="text-[10px] text-blue-200 -mt-0.5">{t('trips.imageTagline')}</div>
          </div>
        </button>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Compare quick-access button */}
          {compareCount > 0 && (
            <button
              onClick={() => setCompareOpen(true)}
              className="relative inline-flex h-9 px-2.5 items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-medium transition-colors"
              title={t('nav.compare')}
            >
              <span aria-hidden>⚖️</span>
              <span className="hidden sm:inline">{t('nav.compare')}</span>
              <span className="min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full bg-violet-500 text-white text-[10px] font-bold">
                {compareCount}
              </span>
            </button>
          )}

          {/* Loyalty button */}
          <button
            onClick={() => setLoyaltyOpen(true)}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-blue-100 hover:bg-white/10 hover:text-white transition-colors"
            title={t('nav.loyalty')}
          >
            <Gift className="h-4 w-4" />
          </button>

          {/* language switch */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-blue-100 hover:bg-white/10 hover:text-white sm:flex gap-2 transition-colors"
                />
              }
            >
              <Globe className="h-4 w-4" /> {lang === 'vi' ? 'VI' : 'EN'}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => handleLangChange('vi')}
                className="flex items-center gap-2"
              >
                {lang === 'vi' && <Check className="h-3.5 w-3.5 text-blue-600" />} Tiếng Việt
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleLangChange('en')}
                className="flex items-center gap-2"
              >
                {lang === 'en' && <Check className="h-3.5 w-3.5 text-blue-600" />} English
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Auth: login button (guest) or avatar dropdown (logged in) */}
          {!user ? (
            <Button
              onClick={() => navigate({ to: '/login' })}
              size="sm"
              className="gap-1.5 bg-white text-blue-800 hover:bg-blue-50 transition-colors"
            >
              <LogIn className="h-4 w-4" />
              <span className="sm:inline">{t('nav.login')}</span>
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    title={user.name}
                    className="inline-flex items-center gap-2 rounded-full pl-1 pr-3 h-9 bg-white/10 hover:bg-white/15 transition-colors ring-1 ring-white/20"
                  />
                }
              >
                <Avatar className="h-7 w-7 ring-1 ring-white/40">
                  <AvatarFallback className="bg-linear-to-br from-blue-400 to-blue-500 text-white text-xs font-bold">
                    {initials || 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="sm:inline text-xs font-semibold max-w-30 truncate">
                  {user.name}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-linear-to-br from-blue-400 to-blue-500 text-white text-xs font-bold">
                        {initials || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 space-x-1">
                      <div className="text-sm font-semibold truncate">{user.name}</div>
                      <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                        {user.email ? (
                          <>
                            <Globe className="h-3 w-3" />
                            <span className="truncate max-w-40">{user.email}</span>
                          </>
                        ) : (
                          <>
                            <Phone className="h-3 w-3" />
                            <span className="truncate">{user.phone}</span>
                          </>
                        )}
                      </div>
                      {isStaffUser(user) && (
                        <div className="text-[10px] mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                          <Briefcase className="h-2.5 w-2.5" />
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
                  <LayoutDashboard className="h-4 w-4" /> {t('nav.myConsole')}
                </DropdownMenuItem>
                {isStaffUser(user) && (
                  <DropdownMenuItem onClick={() => navigate({ to: '/admin' })} className="gap-2">
                    <Briefcase className="h-4 w-4" /> {t('nav.admin')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="gap-2 text-rose-600 focus:text-rose-700 focus:bg-rose-50"
                >
                  <LogOut className="h-4 w-4 hover:text-rose-600" /> {t('nav.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  )
})

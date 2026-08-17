'use client'

import { memo, lazy, Suspense, useCallback } from 'react'
import { useApp } from '@/lib/store'
import { useNavigate, useRouterState } from '@/router'
import { useT } from '@/lib/i18n'
import { useLogout } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Bus, Headset, LayoutDashboard, Home as HomeIcon, Globe, Menu, Ticket, Gift, Check, LogIn, LogOut, UserCircle, Phone, MapPinned, Briefcase } from 'lucide-react'
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

// Lazy-load heavy sub-components to keep the Header chunk small (low memory).
// They load on the client after hydration.
const NotificationBell = lazy(() => import('@/components/notifications/notification-bell').then((m) => ({ default: m.NotificationBell })))
const WishlistButton = lazy(() => import('@/components/wishlist/wishlist-button').then((m) => ({ default: m.WishlistButton })))
const LoyaltyWidget = lazy(() => import('@/components/home/loyalty-widget').then((m) => ({ default: m.LoyaltyWidget })))

export const Header = memo(function Header() {
  const { setChatOpen, compareList, setCompareOpen, setLoyaltyOpen, lang, setLang, user, setUser, setAuthOpen } = useApp()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const t = useT()

  // ── Active-route helpers ────────────────────────────────────────
  // The previous `view === 'bookings'` checks mapped directly to the
  // Zustand view state. Now that views are real URL paths, we derive the
  // active state from the router's pathname (with prefix matching for
  // parameterized routes like /bookings/:code).
  const isBookings = pathname === '/bookings' || pathname.startsWith('/bookings/')
  const isMap = pathname === '/map'
  const isAdmin = pathname === '/admin'

  const handleLangChange = useCallback((newLang: 'vi' | 'en') => {
    setLang(newLang)
    toast.success(newLang === 'vi' ? 'Đã chuyển sang Tiếng Việt' : 'Switched to English')
  }, [setLang])

  const logoutMut = useLogout({
    onSuccess: () => {
      setUser(null)
      toast.success('Đã đăng xuất')
      navigate({ to: '/' })
    },
    onError: () => {
      toast.error('Failed to logout')
    },
  })

  const initials = (user?.name ?? '?')
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(-2)
    .join('')
    .toUpperCase()

  // ─── (parallax mouse-move effect removed) ───

  return (
    <header
      className="sticky top-0 z-40 w-full border-b border-white/10 text-white"
    >
      {/* Gradient background layer */}
      <div className="absolute inset-0 -z-10 bg-blue-900/90 backdrop-blur-xl bg-linear-to-r from-blue-900 via-blue-800 to-blue-900" />

      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <button onClick={() => navigate({ to: '/' })} className="flex items-center gap-2.5 group">
          <div
            className="h-9 w-9 rounded-xl bg-linear-to-br from-blue-400 to-blue-500 flex items-center justify-center"
          >
            <Bus className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="font-extrabold text-lg tracking-tight">VeXeVN</div>
            <div className="text-[10px] text-blue-200 -mt-0.5">Đặt vé xe khách online</div>
          </div>
        </button>

        <nav className="hidden md:flex items-center gap-1">
          {/* Logo is the home link, so we skip a redundant "Trang chủ" button */}
          <NavBtn active={isBookings} onClick={() => navigate({ to: '/bookings' })} icon={<Ticket className="h-4 w-4" />}>
            {t('nav.tickets')}
          </NavBtn>
          <NavBtn active={isMap} onClick={() => navigate({ to: '/map' })} icon={<MapPinned className="h-4 w-4" />}>
            Bản đồ
          </NavBtn>
          {/* Admin nav — only visible to employees */}
          {user?.type === 'employee' && (
            <NavBtn active={isAdmin} onClick={() => navigate({ to: '/admin' })} icon={<LayoutDashboard className="h-4 w-4" />}>
              {t('nav.admin')}
            </NavBtn>
          )}
          {/* Online agents indicator */}
          <div className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 ring-1 ring-blue-400/20 text-[11px] font-medium text-blue-200">
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-400">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60 animate-ping" />
            </span>
            Hỗ trợ 24/7
          </div>
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          {/* Compare quick-access button */}
          {compareList.length > 0 && (
            <button
              onClick={() => setCompareOpen(true)}
              className="relative inline-flex h-9 px-2.5 items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-medium transition-colors"
              title="So sánh chuyến"
            >
              <span aria-hidden>⚖️</span>
              <span className="hidden sm:inline">So sánh</span>
              <span className="min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full bg-violet-500 text-white text-[9px] font-bold">
                {compareList.length}
              </span>
            </button>
          )}

          <Suspense fallback={null}>
            <WishlistButton variant="icon" />
          </Suspense>
          <Suspense fallback={null}>
            <NotificationBell />
          </Suspense>

          {/* Loyalty button */}
          <button
            onClick={() => setLoyaltyOpen(true)}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-blue-100 hover:bg-white/10 hover:text-white transition-colors"
            title="Điểm thưởng"
          >
            <Gift className="h-4 w-4" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="text-blue-100 hover:bg-white/10 hover:text-white sm:flex gap-2 transition-colors" />}>
              <Globe className="h-4 w-4" /> {lang === 'vi' ? 'VI' : 'EN'}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleLangChange('vi')} className="flex items-center gap-2">
                {lang === 'vi' && <Check className="h-3.5 w-3.5 text-blue-600" />} Tiếng Việt
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleLangChange('en')} className="flex items-center gap-2">
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
              <span className="sm:inline">Đăng nhập</span>
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <button
                  type="button"
                  title={user.name}
                  className="inline-flex items-center gap-2 rounded-full pl-1 pr-3 h-9 bg-white/10 hover:bg-white/15 transition-colors ring-1 ring-white/20"
                />
              }>
                <Avatar className="h-7 w-7 ring-1 ring-white/40">
                  <AvatarFallback className="bg-linear-to-br from-blue-400 to-blue-500 text-white text-xs font-bold">
                    {initials || 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="sm:inline text-xs font-semibold max-w-30 truncate">
                  {user.name}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-linear-to-br from-blue-400 to-blue-500 text-white text-xs font-bold">
                        {initials || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
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
                      {user.type === 'employee' && (
                        <div className="text-[10px] mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
                          <Briefcase className="h-2.5 w-2.5" />
                          {user.employeeRole === 'admin' ? 'Quản trị' :
                            user.employeeRole === 'support_lead' ? 'Trưởng hỗ trợ' :
                              user.employeeRole === 'ops' ? 'Vận hành' : 'Hỗ trợ'}
                          {user.brandName ? ` · ${user.brandName}` : ''}
                        </div>
                      )}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: '/bookings' })} className="gap-2">
                  <Ticket className="h-4 w-4" /> Vé của tôi
                </DropdownMenuItem>
                {user.type === 'employee' && (
                  <DropdownMenuItem onClick={() => navigate({ to: '/admin' })} className="gap-2">
                    <LayoutDashboard className="h-4 w-4" /> Quản trị
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => navigate({ to: '/' })} className="gap-2">
                  <UserCircle className="h-4 w-4" /> Trang cá nhân
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logoutMut.mutate()} className="gap-2 text-rose-600 focus:text-rose-700 focus:bg-rose-50">
                  <LogOut className="h-4 w-4" /> Đăng xuất
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            onClick={() => setChatOpen(true)}
            size="sm"
            className="bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white gap-1.5 transition-all"
          >
            <Headset className="h-4 w-4" />
            <span className="hidden sm:inline">{t('nav.support')}</span>
          </Button>

          <Suspense fallback={null}>
            <LoyaltyWidget />
          </Suspense>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="md:hidden text-white hover:bg-white/10 transition-colors" />}>
              <Menu className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate({ to: '/' })}>
                <HomeIcon className="h-4 w-4 mr-2" /> {t('nav.home')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: '/bookings' })}>
                <Ticket className="h-4 w-4 mr-2" /> {t('nav.tickets')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: '/map' })}>
                <MapPinned className="h-4 w-4 mr-2" /> Bản đồ tuyến đường
              </DropdownMenuItem>
              {user?.type === 'employee' && (
                <DropdownMenuItem onClick={() => navigate({ to: '/admin' })}>
                  <LayoutDashboard className="h-4 w-4 mr-2" /> {t('nav.admin')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setChatOpen(true)}>
                <Headset className="h-4 w-4 mr-2" /> {t('nav.support')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
})

const NavBtn = memo(function NavBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${active
        ? 'bg-white/15 text-white '
        : 'text-blue-100 hover:bg-white/10 hover:text-white'
        }`}
    >
      {icon}
      {children}
    </button>
  )
})

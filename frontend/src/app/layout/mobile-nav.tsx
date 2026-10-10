import { isStaffUser, useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { Home, Search, LogIn, Headset, LayoutDashboard } from 'lucide-react'

type TabKey = 'home' | 'search' | 'bookings' | 'support'

const tabs: { key: TabKey; icon: React.ElementType; labelKey: string }[] = [
  { key: 'home', icon: Home, labelKey: 'nav.home' },
  { key: 'search', icon: Search, labelKey: 'nav.searchTrips' },
  { key: 'bookings', icon: LogIn, labelKey: 'nav.login' },
  { key: 'support', icon: Headset, labelKey: 'nav.support' },
]

export function MobileNav() {
  const chatOpen = useUi((s) => s.chatOpen)
  const setChatOpen = useUi((s) => s.setChatOpen)
  const user = useSession((s) => s.user)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const t = useT()

  if (chatOpen) return null

  const consoleTab = !!user
  const bookingsIcon = consoleTab ? LayoutDashboard : LogIn
  const bookingsLabel = t(consoleTab ? 'nav.myConsoleShort' : 'nav.login')
  const getActiveTab = (): TabKey => {
    if (pathname === '/') return 'home'
    if (pathname === '/search') return 'search'
    if (
      pathname === '/login' ||
      pathname === '/bookings' ||
      pathname.startsWith('/bookings/') ||
      pathname.startsWith('/account')
    )
      return 'bookings'
    return 'home'
  }

  const handleTab = (key: TabKey) => {
    switch (key) {
      case 'home':
        navigate({ to: '/' })
        break
      case 'search':
        navigate({ to: '/search' })
        break
      case 'bookings':
        navigate({ to: consoleTab ? '/account' : '/login' })
        break
      case 'support':
        if (!user) navigate({ to: '/login' })
        // Staff answer support from the admin inbox, not the customer widget.
        else if (isStaffUser(user)) navigate({ to: '/admin/chat' })
        else setChatOpen(true)
        break
    }
  }

  const activeTab = getActiveTab()

  return (
    <>
      {/* Bottom nav bar — touch targets are ≥48px (Apple HIG + Material). */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-xl"
        aria-label={t('layout.mobileNav.aria')}
      >
        <div
          className="flex items-center justify-around h-16 px-2"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key
            const Icon = tab.key === 'bookings' ? bookingsIcon : tab.icon
            const label = tab.key === 'bookings' ? bookingsLabel : t(tab.labelKey)
            return (
              <button
                key={tab.key}
                onClick={() => handleTab(tab.key)}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                className="relative flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors active:bg-muted"
              >
                <div className="relative">
                  <Icon
                    className={`h-5 w-5 transition-colors duration-200 ${
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    }`}
                  />
                  {isActive && (
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-1 w-5 rounded-full bg-primary" />
                  )}
                </div>
                <span
                  className={`text-[10px] font-medium transition-colors duration-200 ${
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}

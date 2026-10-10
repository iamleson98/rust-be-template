import { isStaffUser, useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { Home, Search, LogIn, Headset, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const bookingsIcon = consoleTab ? UserRound : LogIn
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
    // Touch targets are ≥48px (Apple HIG + Material); the active tab gets a pill.
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label={t('layout.mobileNav.aria')}
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch px-2">
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
              className="flex min-h-12 flex-1 flex-col items-center justify-center gap-1"
            >
              <span
                className={cn(
                  'grid h-7 w-14 place-items-center rounded-full transition-colors duration-200',
                  isActive ? 'bg-primary/10 text-primary' : 'text-slate-500',
                )}
              >
                <Icon className="size-5" strokeWidth={isActive ? 2.25 : 2} />
              </span>
              <span
                className={cn(
                  'text-[11px] leading-none font-medium transition-colors duration-200',
                  isActive ? 'text-primary' : 'text-slate-500',
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

'use client'

import { useApp } from '@/lib/store'
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
  const { chatOpen, setChatOpen, user } = useApp()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const t = useT()

  if (chatOpen) return null

  // Derive the active tab from the current URL path — the router is now
  // the source of truth for the active view. For signed-in users the
  // middle tab is their personal console (/account); guests get a Login
  // shortcut (their tickets live behind the account console — the old
  // phone-number ticket lookup was removed).
  const consoleTab = !!user
  const bookingsIcon = consoleTab ? LayoutDashboard : LogIn
  const bookingsLabel = t(consoleTab ? 'nav.myConsole' : 'nav.login')
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
        // Straight to the search page — it carries its own compact
        // search widget AND a full route directory when no from/to is
        // set (browsing schedules without knowing what to type).
        navigate({ to: '/search' })
        break
      case 'bookings':
        navigate({ to: consoleTab ? '/account' : '/login' })
        break
      case 'support':
        if (user) setChatOpen(true)
        else navigate({ to: '/login' })
        break
    }
  }

  const activeTab = getActiveTab()

  return (
    <>
      {/* Bottom nav bar — touch targets are ≥48px (Apple HIG + Material). */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-slate-200/60"
        aria-label={t('layout.mobileNav.aria')}
      >
        <div
          className="flex items-center justify-around h-16 px-2"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key
            // The middle tab is context-aware: console (signed in) vs
            // ticket lookup (guest).
            const Icon = tab.key === 'bookings' ? bookingsIcon : tab.icon
            const label = tab.key === 'bookings' ? bookingsLabel : t(tab.labelKey)
            return (
              <button
                key={tab.key}
                onClick={() => handleTab(tab.key)}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                // min-h-12 ensures the touch target meets Apple HIG (44px)
                // and Material Design (48px) guidelines even on dense layouts.
                className="flex flex-col items-center justify-center gap-0.5 min-w-16 min-h-12 relative active:bg-slate-100/50 rounded-lg transition-colors"
              >
                <div className="relative">
                  <Icon
                    className={`h-5 w-5 transition-colors duration-200 ${
                      isActive ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  />
                  {isActive && (
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-1 w-5 rounded-full bg-blue-500" />
                  )}
                </div>
                <span
                  className={`text-[10px] font-medium transition-colors duration-200 ${
                    isActive ? 'text-blue-600' : 'text-slate-400'
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

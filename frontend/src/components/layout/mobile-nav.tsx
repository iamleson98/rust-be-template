'use client'

import { useApp } from '@/lib/store'
import { useNavigate, useRouterState } from '@/router'
import { useT } from '@/lib/i18n'
import { Home, Search, Ticket, Headset, Bus } from 'lucide-react'

type TabKey = 'home' | 'search' | 'bookings' | 'support'

const tabs: { key: TabKey; icon: React.ElementType; labelKey: string }[] = [
  { key: 'home', icon: Home, labelKey: 'nav.home' },
  { key: 'search', icon: Search, labelKey: 'nav.searchTrips' },
  { key: 'bookings', icon: Ticket, labelKey: 'nav.tickets' },
  { key: 'support', icon: Headset, labelKey: 'nav.support' },
]

export function MobileNav() {
  const { setChatOpen } = useApp()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const t = useT()

  // Derive the active tab from the current URL path — the router is now
  // the source of truth for the active view (was `view` in the Zustand store).
  const getActiveTab = (): TabKey => {
    if (pathname === '/') return 'home'
    if (pathname === '/search') return 'search'
    if (pathname === '/bookings' || pathname.startsWith('/bookings/')) return 'bookings'
    return 'home'
  }

  const handleTab = (key: TabKey) => {
    switch (key) {
      case 'home':
        navigate({ to: '/' })
        break
      case 'search':
        // The "search" tab returns to the homepage where the SearchWidget lives.
        navigate({ to: '/' })
        break
      case 'bookings':
        navigate({ to: '/bookings' })
        break
      case 'support':
        setChatOpen(true)
        break
    }
  }

  const activeTab = getActiveTab()

  return (
    <>
      {/* Floating CTA button */}
      {/* <div className="md:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-50">
        <button
          onClick={() => navigate({ to: '/' })}
          className="h-14 w-14 rounded-full bg-linear-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center ring-4 ring-white/20"
          aria-label={t('nav.bookTicket')}
        >
          <Bus className="h-6 w-6" />
        </button>
        <div className="text-center mt-1">
          <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">
            {t('nav.bookTicket')}
          </span>
        </div>
      </div> */}

      {/* Bottom nav bar — touch targets are ≥48px (Apple HIG + Material). */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-slate-200/60"
        aria-label="Điều hướng chính"
      >
        <div
          className="flex items-center justify-around h-16 px-2"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => handleTab(tab.key)}
                aria-label={t(tab.labelKey)}
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
                  {t(tab.labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}

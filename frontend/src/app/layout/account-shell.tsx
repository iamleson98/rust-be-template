import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Gift, History, KeyRound, LayoutGrid, LogOut, MessageSquareHeart } from 'lucide-react'
import { PageInset } from '@/components/console/page'
import { useLogout } from '@/features/auth/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The customer's account area, inside the site (header, bottom tabs): on
 * desktop the sections in a card beside the page; on phones and
 * tablets the sections as tabs that stay under the header.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  const t = useT()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const logout = useLogout()

  const items = [
    { url: '/account', title: t('layout.account.overview'), icon: LayoutGrid, exact: true },
    { url: '/account/trips', title: t('layout.account.tripsShort'), icon: History },
    {
      url: '/account/feedback',
      title: t('layout.account.feedbackShort'),
      icon: MessageSquareHeart,
    },
    { url: '/account/loyalty', title: t('nav.loyalty'), icon: Gift },
    { url: '/account/password', title: t('accountPage.passwordShort'), icon: KeyRound },
  ]
  const active = (item: (typeof items)[number]) =>
    item.exact ? pathname === item.url : pathname.startsWith(item.url)

  // Narrow screens: keep the current section's tab in view.
  const rail = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>('[aria-current=page]')
    if (rail.current && el) {
      rail.current.scrollLeft = el.offsetLeft - (rail.current.clientWidth - el.offsetWidth) / 2
    }
  }, [pathname])

  return (
    <div className="page-x pb-8 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8 lg:pt-8">
      {/* Phones and tablets: the sections as tabs, kept under the header. */}
      <nav
        aria-label={t('auth.account')}
        className="sticky top-(--header-h) z-20 -mx-4 border-b border-slate-200/80 bg-canvas/95 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:hidden"
      >
        <div ref={rail} className="relative flex overflow-x-auto scroll-smooth scrollbar-none">
          {items.map((item) => (
            <Link
              key={item.url}
              to={item.url as never}
              activeOptions={{ exact: !!item.exact }}
              aria-current={active(item) ? 'page' : undefined}
              className={cn(
                'relative inline-flex h-12 shrink-0 items-center gap-1.5 px-3.5 text-sm font-medium transition-colors',
                'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full',
                active(item)
                  ? 'text-primary after:bg-primary'
                  : 'text-slate-500 hover:text-slate-900',
              )}
            >
              <item.icon className="size-4" />
              {item.title}
            </Link>
          ))}
        </div>
      </nav>

      {/* Desktop: the sections and the way out (the header already shows who is signed in). */}
      <aside className="hidden lg:block">
        <div className="sticky top-[calc(var(--header-h)+2rem)] rounded-2xl bg-white p-3 shadow-soft ring-1 ring-slate-200/80">
          <nav aria-label={t('auth.account')} className="space-y-0.5">
            {items.map((item) => (
              <Link
                key={item.url}
                to={item.url as never}
                activeOptions={{ exact: !!item.exact }}
                aria-current={active(item) ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                  active(item)
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )}
              >
                <item.icon className="size-4.5 shrink-0" />
                {item.title}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={logout}
            className="mt-2 flex h-10 w-full items-center gap-3 rounded-xl border-t border-slate-100 px-3 text-sm text-rose-600 transition-colors hover:bg-rose-50"
          >
            <LogOut className="size-4.5 shrink-0" />
            {t('auth.logout')}
          </button>
        </div>
      </aside>

      <div className="min-w-0 pt-5 lg:pt-0">
        <PageInset value={false}>{children}</PageInset>
      </div>
    </div>
  )
}

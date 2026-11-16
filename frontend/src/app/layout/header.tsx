import { lazy, memo, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useUi } from '@/stores/ui'
import { usePrefs } from '@/stores/prefs'
import { isStaffUser, useSession } from '@/stores/session'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'
import { afterLoadWhenIdle } from '@/lib/idle'
import { SUPPORT } from '@/lib/support'
import { Button } from '@/components/ui/button'
import { Gift, GitCompare, LogIn, PhoneCall } from 'lucide-react'
import { cn } from '@/lib/utils'
import { personInitials } from '@/lib/text'
import {
  ACCOUNT_BUTTON,
  AccountButtonContent,
  LANGUAGE_BUTTON,
  LanguageButtonContent,
  tone,
} from './header-parts'

// Base UI's menu code is a large part of the first download and nothing in the
// first paint needs it, so the two menus load apart (see `header-menus.tsx`).
const LanguageMenu = lazy(() => import('./header-menus').then((m) => ({ default: m.LanguageMenu })))
const AccountMenu = lazy(() => import('./header-menus').then((m) => ({ default: m.AccountMenu })))

/**
 * A menu whose code loads once the page is idle: until then (and while it
 * loads) its button is drawn without the menu, and reaching for it loads the
 * menu at once and opens it.
 */
function LazyMenu({
  button,
  menu,
}: {
  /** The closed button, with what to do when it is pressed before the menu is there. */
  button: (onPress: () => void) => ReactNode
  menu: (defaultOpen: boolean) => ReactNode
}) {
  const [stage, setStage] = useState<'waiting' | 'idle' | 'asked'>('waiting')
  useEffect(() => {
    afterLoadWhenIdle(() => setStage((s) => (s === 'waiting' ? 'idle' : s)))
  }, [])
  const placeholder = button(() => setStage('asked'))
  if (stage === 'waiting') return placeholder
  return <Suspense fallback={placeholder}>{menu(stage === 'asked')}</Suspense>
}

export const Header = memo(function Header() {
  const compareCount = useUi((s) => s.compareList.length)
  const setCompareOpen = useUi((s) => s.setCompareOpen)
  const setLoyaltyOpen = useUi((s) => s.setLoyaltyOpen)
  const lang = usePrefs((s) => s.lang)
  const user = useSession((s) => s.user)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const t = useT()

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
          {/* A real number to call, in view on every desktop page. */}
          <a
            href={SUPPORT.hotlineHref}
            className="mr-1 hidden items-center gap-2 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-slate-100 lg:inline-flex"
          >
            <span className="grid size-8 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <PhoneCall className="size-4" aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-[10px] text-slate-500">{t('footer.hotline')}</span>
              <span className="block text-sm font-semibold text-slate-900 tabular-nums">
                {SUPPORT.hotline}
              </span>
            </span>
          </a>
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

          <LazyMenu
            button={(onPress) => (
              <Button variant="ghost" size="sm" className={LANGUAGE_BUTTON} onClick={onPress}>
                <LanguageButtonContent lang={lang} />
              </Button>
            )}
            menu={(defaultOpen) => <LanguageMenu defaultOpen={defaultOpen} />}
          />

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
            <LazyMenu
              button={(onPress) => (
                <button
                  type="button"
                  title={user.name}
                  aria-label={user.name}
                  className={ACCOUNT_BUTTON}
                  onClick={onPress}
                >
                  <AccountButtonContent name={user.name} initials={personInitials(user.name)} />
                </button>
              )}
              menu={(defaultOpen) => <AccountMenu user={user} defaultOpen={defaultOpen} />}
            />
          )}
        </div>
      </div>
    </header>
  )
})

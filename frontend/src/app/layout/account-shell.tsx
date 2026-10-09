import type { ReactNode } from 'react'
import { ArrowLeft, Gift, History, KeyRound, MessageSquareHeart, UserCircle } from 'lucide-react'
import { ConsoleShell, type ConsoleNavGroup } from '@/components/console/console-shell'
import { useT } from '@/lib/i18n'

/** The customer's console: overview, trips, feedback, points and password. */
export function AccountShell({ children }: { children: ReactNode }) {
  const t = useT()
  const groups: ConsoleNavGroup[] = [
    {
      label: t('auth.account'),
      items: [
        {
          title: t('layout.account.overview'),
          icon: UserCircle,
          url: '/account',
          exact: true,
        },
        {
          title: t('layout.account.tripHistory'),
          short: t('layout.account.tripsShort'),
          icon: History,
          url: '/account/trips',
        },
      ],
    },
    {
      label: t('bookingHistory.reviews'),
      items: [
        {
          title: t('layout.account.tripFeedback'),
          short: t('layout.account.feedbackShort'),
          icon: MessageSquareHeart,
          url: '/account/feedback',
        },
      ],
    },
    {
      label: t('layout.account.utilities'),
      items: [
        {
          title: t('nav.loyalty'),
          short: t('layout.account.pointsShort'),
          icon: Gift,
          url: '/account/loyalty',
        },
      ],
    },
    {
      label: t('account.settings'),
      items: [{ title: t('accountPage.passwordShort'), icon: KeyRound, url: '/account/password' }],
    },
  ]

  return (
    <ConsoleShell
      label={t('auth.account')}
      groups={groups}
      exit={{ title: t('nav.home'), icon: ArrowLeft, to: '/' }}
      mobileNav="tabs"
    >
      {children}
    </ConsoleShell>
  )
}

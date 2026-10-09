import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Bell,
  ChevronRight,
  Gift,
  History,
  MessageSquareHeart,
  ShieldCheck,
  Ticket,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useT } from '@/lib/i18n'

type LinkTarget =
  | '/account/trips'
  | '/account/feedback'
  | '/account/loyalty'
  | '/account/notifications'
  | '/account/security'

const icon = (Icon: typeof Ticket, color: string): ReactNode => (
  <Icon className={`h-4 w-4 ${color}`} />
)

const LINKS: { to: LinkTarget; icon: ReactNode; label: string; desc: string }[] = [
  {
    to: '/account/trips',
    icon: icon(Ticket, 'text-blue-600'),
    label: 'nav.tickets',
    desc: 'accountPage.qkBookingsDesc',
  },
  {
    to: '/account/trips',
    icon: icon(History, 'text-blue-600'),
    label: 'layout.account.tripHistory',
    desc: 'accountPage.console.qkTripsDesc',
  },
  {
    to: '/account/feedback',
    icon: icon(MessageSquareHeart, 'text-amber-600'),
    label: 'layout.account.tripFeedback',
    desc: 'accountPage.console.qkFeedbackDesc',
  },
  {
    to: '/account/loyalty',
    icon: icon(Gift, 'text-violet-600'),
    label: 'nav.loyalty',
    desc: 'accountPage.qkLoyaltyDesc',
  },
  {
    to: '/account/notifications',
    icon: icon(Bell, 'text-blue-600'),
    label: 'account.notifications',
    desc: 'accountPage.qkNotificationsDesc',
  },
  {
    to: '/account/security',
    icon: icon(ShieldCheck, 'text-emerald-600'),
    label: 'accountPage.qkSecurity',
    desc: 'accountPage.qkSecurityDesc',
  },
]

/** Shortcuts into the other account pages. */
export function QuickLinks() {
  const t = useT()
  const navigate = useNavigate()
  return (
    <Card className="mt-5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t('accountPage.quickAccess')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {LINKS.map((link) => (
          <button
            key={link.label}
            onClick={() => navigate({ to: link.to })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
          >
            {link.icon}
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t(link.label)}</div>
              <div className="truncate text-xs text-muted-foreground">{t(link.desc)}</div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

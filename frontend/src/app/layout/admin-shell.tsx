import type { ReactNode } from 'react'
import {
  Activity,
  Armchair,
  Building2,
  Bus,
  CalendarClock,
  CreditCard,
  Eye,
  LayoutDashboard,
  MessageSquare,
  MessageSquareWarning,
  Ticket,
  Users,
} from 'lucide-react'
import { ConsoleShell, type ConsoleNavGroup } from '@/components/console/console-shell'
import { useT } from '@/lib/i18n'
import { useSession } from '@/stores/session'

/** The admin console: operations, catalog, finance and system; user management for admins only. */
export function AdminShell({ children }: { children: ReactNode }) {
  const t = useT()
  const isAdmin = useSession((s) => s.user?.type === 'admin')

  const groups: ConsoleNavGroup[] = [
    {
      label: t('admin.group.overview'),
      items: [{ title: t('admin.dashboard'), icon: LayoutDashboard, url: '/admin', exact: true }],
    },
    {
      label: t('admin.group.operations'),
      items: [
        { title: t('admin.ticketsSold'), icon: Ticket, url: '/admin/tickets' },
        { title: t('admin.chatOnline'), icon: MessageSquare, url: '/admin/chat' },
        { title: t('admin.feedback'), icon: MessageSquareWarning, url: '/admin/feedback' },
      ],
    },
    {
      label: t('admin.group.catalog'),
      items: [
        { title: t('admin.brands'), icon: Building2, url: '/admin/brands' },
        { title: t('admin.busLayouts'), icon: Armchair, url: '/admin/bus-layouts' },
        { title: t('admin.vehicleTypes'), icon: Bus, url: '/admin/vehicle-types' },
      ],
    },
    {
      label: t('admin.group.finance'),
      items: [{ title: t('admin.payments'), icon: CreditCard, url: '/admin/payments' }],
    },
    {
      label: t('admin.group.system'),
      items: [
        { title: t('admin.systemMonitoring'), icon: Activity, url: '/admin/system' },
        { title: t('admin.cronJobs'), icon: CalendarClock, url: '/admin/cron-jobs' },
      ],
    },
    ...(isAdmin
      ? [
          {
            label: t('admin.group.governance'),
            items: [{ title: t('admin.users'), icon: Users, url: '/admin/users' }],
          },
        ]
      : []),
  ]

  return (
    <ConsoleShell
      label={t('nav.admin')}
      groups={groups}
      exit={{ title: t('admin.customerSite'), icon: Eye, to: '/' }}
      mobileNav="drawer"
    >
      {children}
    </ConsoleShell>
  )
}

import { useNavigate } from '@tanstack/react-router'
import type { LoyaltyResponse } from '@/api'
import { PageHeader } from '@/components/console/page'
import { Button } from '@/components/ui/button'
import { tierView } from '@/features/loyalty/api'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useSession } from '@/stores/session'

const GREETINGS = ['Morning', 'Afternoon', 'Evening'] as const
const greetingKey = (hour = new Date().getHours()) => GREETINGS[hour < 12 ? 0 : hour < 18 ? 1 : 2]

/** "Good evening, <name>", the ticket/points line, and the loyalty tier as a shortcut. */
export function ConsoleGreeting({
  upcoming,
  loyalty,
}: {
  upcoming: number
  loyalty?: LoyaltyResponse
}) {
  const t = useT()
  const navigate = useNavigate()
  const name = useSession((s) => s.user?.name)
  const { tier, style } = tierView(loyalty)

  return (
    <PageHeader
      title={`${t(`accountPage.console.greeting${greetingKey()}`)}${name ? `, ${name}` : ''}`}
      description={t('accountPage.console.subtitleLine', {
        active: upcoming,
        points: loyalty ? formatNum(loyalty.points) : '0',
      })}
      actions={
        tier && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => navigate({ to: '/account/loyalty' })}
          >
            <span style={{ color: style.ring }} aria-hidden>
              {style.icon}
            </span>
            {tier.name} · {formatNum(loyalty?.points ?? 0)}
          </Button>
        )
      }
    />
  )
}

import type { ReactNode } from 'react'
import { Bus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** A console section: gradient top bar, icon + title (+ count badge), body. */
export function ConsoleCard({
  bar,
  icon,
  title,
  badge,
  children,
}: {
  /** Tailwind gradient stops, e.g. `from-sky-500 to-blue-600`. */
  bar: string
  icon: ReactNode
  title: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className={cn('h-1 bg-linear-to-r', bar)} />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
          {badge}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

const BADGE_TONES = {
  blue: 'bg-blue-500/10 text-blue-700 ring-blue-500/20',
  amber: 'bg-amber-500/10 text-amber-600 ring-amber-500/20',
}

export const CountBadge = ({ n, tone = 'blue' }: { n: number; tone?: keyof typeof BADGE_TONES }) => (
  <span
    className={cn(
      'ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1',
      BADGE_TONES[tone],
    )}
  >
    {n}
  </span>
)

/** Nothing here yet: an icon, one line, and a way to get started. */
export function EmptyHint({
  icon,
  tone,
  text,
  ctaLabel,
  onCta,
}: {
  icon: ReactNode
  /** Circle colour classes, e.g. `bg-sky-500/10 text-sky-600`. */
  tone: string
  text: string
  ctaLabel: string
  onCta: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className={cn('flex size-11 items-center justify-center rounded-full', tone)}>{icon}</div>
      <p className="text-xs text-muted-foreground">{text}</p>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={onCta}>
        <Bus className="h-3.5 w-3.5" /> {ctaLabel}
      </Button>
    </div>
  )
}

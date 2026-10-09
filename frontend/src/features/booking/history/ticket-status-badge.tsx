import { CheckCircle2, Clock, PhoneCall, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { STAGE_CONFIG, ticketStage, type BookingItem } from './booking-types'

const ICONS = { check: CheckCircle2, clock: Clock, xcircle: XCircle, phone: PhoneCall }

/** Where a ticket stands: awaiting the operator's call, paying, confirmed, done or cancelled. */
export function TicketStatusBadge({
  booking,
  className,
}: {
  booking: Pick<BookingItem, 'status' | 'paymentMethod'>
  className?: string
}) {
  const t = useT()
  const stage = STAGE_CONFIG[ticketStage(booking)]
  const Icon = ICONS[stage.icon]
  return (
    <Badge className={cn('gap-1 border-0 font-semibold', stage.cls, className)}>
      <Icon className="h-3.5 w-3.5" />
      {t(stage.labelKey)}
    </Badge>
  )
}

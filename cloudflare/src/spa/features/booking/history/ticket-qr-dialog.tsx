import { useQuery } from '@tanstack/react-query'
import { QrCode } from 'lucide-react'
import { bookingsDetailOptions } from '@spa/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@spa/components/ui/dialog'
import { Skeleton } from '@spa/components/ui/skeleton'
import { useT } from '@spa/lib/i18n'

/** The ticket's boarding QR, shown in place (the list never leaves the page for it). */
export function TicketQrDialog({
  code,
  onOpenChange,
}: {
  /** The ticket to show; `null` closes the dialog. */
  code: string | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const { data: ticket, isLoading } = useQuery({
    ...bookingsDetailOptions({ path: { id: code ?? '' } }),
    enabled: !!code,
  })
  return (
    <Dialog open={!!code} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader icon={<QrCode />}>
          <DialogTitle>{t('bookingHistory.qrTitle')}</DialogTitle>
          <DialogDescription>{t('bookingHistory.qrHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {isLoading ? (
            <Skeleton className="h-60 w-60 rounded-xl" />
          ) : ticket?.ticketQr ? (
            <img
              src={ticket.ticketQr}
              alt={t('bookingHistory.qrAlt', { code: ticket.code })}
              width={240}
              height={240}
              className="rounded-2xl bg-white p-2 ring-1 ring-slate-200"
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('bookingHistory.qrUnavailable')}
            </p>
          )}
          <code className="font-mono text-xl font-bold tracking-wide text-slate-900">{code}</code>
          {ticket && ticket.seats.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('bookingHistory.qrSeats', {
                seats: ticket.seats.map((s) => s.seatCode ?? '—').join(', '),
              })}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

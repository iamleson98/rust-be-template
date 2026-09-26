'use client'

import { useCallback, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Ticket as TicketIcon,
  CheckCircle2,
  TrendingUp,
  Ban,
  RotateCcw,
  AlertCircle,
  User,
  Phone,
  Mail,
  Bus,
  MapPin,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useAdminBookingDetail,
  useUpdateBookingStatus,
} from '@/lib/queries'
import { BookingStatusBadge } from '@/features/admin/dashboard/booking-status-badge'
import { TicketDetailSkeleton } from './ticket-detail-skeleton'
import { formatVND, formatDepartureDate } from './tickets-helpers'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'

// ── BookingDetailDialog ─────────────────────────────────────

export function BookingDetailDialog({
  bookingId,
  onClose,
}: {
  bookingId: string | null
  onClose: () => void
}) {
  const { data, isLoading, isError, refetch } = useAdminBookingDetail(bookingId ?? undefined)
  const updateStatus = useUpdateBookingStatus()
  const [reason, setReason] = useState('')
  const [force, setForce] = useState(false)
  const t = useT()

  const booking = data?.item

  const handleStatusChange = useCallback(
    async (status: 'confirmed' | 'cancelled' | 'completed' | 'refunded') => {
      if (!booking) return
      try {
        await updateStatus.mutateAsync({
          path: { id: booking.id },
          body: {
            status,
            reason: reason.trim() || undefined,
            force,
          },
        })
        toast.success(t('adminTickets.statusUpdated'), {
          description: t('adminTickets.statusUpdatedDesc', {
            code: booking.code,
            status: statusLabel(status, t),
          }),
        })
        setReason('')
        setForce(false)
      } catch (e) {
        toast.error(t('adminTickets.statusUpdateFailed'), {
          description: getErrorMessage(e, t('adminTickets.pleaseRetry')),
        })
      }
    },
    [booking, updateStatus, reason, force, t],
  )

  return (
    <Dialog open={!!bookingId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TicketIcon className="h-5 w-5 text-blue-600" />
            {booking ? t('adminTickets.ticketCode', { code: booking.code }) : t('adminTickets.detailTitle')}
            {booking && <BookingStatusBadge status={booking.status} />}
          </DialogTitle>
          <DialogDescription>
            {t('adminTickets.detailDescription')}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <TicketDetailSkeleton />
        ) : isError ? (
          <div className="p-4 text-center">
            <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t('adminTickets.detailLoadFailed')}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              {t('payment.retry')}
            </Button>
          </div>
        ) : booking ? (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 pb-4">
              {/* Status management block */}
              <Card className="bg-slate-50/50 border-dashed">
                <CardContent className="p-3 space-y-2.5">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t('adminTickets.statusManagement')}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant={booking.status === 'confirmed' ? 'default' : 'outline'}
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('confirmed')}
                      disabled={updateStatus.isPending || booking.status === 'confirmed'}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('common.confirm')}
                    </Button>
                    <Button
                      size="sm"
                      variant={booking.status === 'completed' ? 'default' : 'outline'}
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('completed')}
                      disabled={updateStatus.isPending || booking.status === 'completed'}
                    >
                      <TrendingUp className="h-3.5 w-3.5" />
                      {t('adminTickets.statusCompleted')}
                    </Button>
                    <Button
                      size="sm"
                      variant={booking.status === 'cancelled' ? 'destructive' : 'outline'}
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('cancelled')}
                      disabled={updateStatus.isPending || booking.status === 'cancelled'}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      {t('cancel.title')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('refunded')}
                      disabled={
                        updateStatus.isPending ||
                        booking.status === 'refunded'
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('adminTickets.statusRefunded')}
                    </Button>
                  </div>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('adminTickets.reasonPlaceholder')}
                    className="text-xs min-h-10 resize-none"
                  />
                  <div className="flex items-center gap-2 text-[11px]">
                    <Switch checked={force} onCheckedChange={setForce} id="force" />
                    <Label htmlFor="force" className="cursor-pointer text-muted-foreground">
                      {t('adminTickets.forceOverride')}
                    </Label>
                  </div>
                </CardContent>
              </Card>

              {/* Contact info */}
              <Section title={t('adminTickets.passengerInfo')} icon={<User className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField label={t('adminTickets.fullName')} value={booking.contactName} />
                  <InfoField label={t('adminTickets.phoneLabel')} value={booking.contactPhone} icon={<Phone className="h-3 w-3" />} />
                  <InfoField label={t('booking.contactEmail')} value={booking.contactEmail} icon={<Mail className="h-3 w-3" />} />
                  <InfoField
                    label={t('payment.method')}
                    value={booking.paymentMethod ?? '—'}
                  />
                </div>
                {booking.contactName && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground bg-blue-50/50 rounded-md px-2 py-1.5">
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-[9px] bg-blue-100 text-blue-700">
                        {booking.contactName?.[0] ?? 'U'}
                      </AvatarFallback>
                    </Avatar>
                    {t('adminTickets.accountLabel')} <span className="font-medium text-blue-700">{booking.contactName}</span>
                    {booking.contactPhone && <span>· {booking.contactPhone}</span>}
                  </div>
                )}
              </Section>

              <Section title={t('adminTickets.tripInfo')} icon={<Bus className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField
                    label={t('adminTickets.route')}
                    value={`${booking.pickupName ?? '—'} → ${booking.dropoffName ?? '—'}`}
                  />
                  <InfoField
                    label={t('admin.brands')}
                    value={booking.contactName ?? '—'}
                  />
                  <InfoField
                    label={t('search.date')}
                    value={formatDepartureDate(booking.createdAt)}
                  />
                  <InfoField
                    label={t('admin.vehicleTypes')}
                    value={booking.paymentMethod ?? '—'}
                  />
                </div>
              </Section>

              {/* Seats + passengers */}
              <Section title={t('adminTickets.seatsAndPassengers')} icon={<TicketIcon className="h-4 w-4" />}>
                <div className="space-y-1.5">
                  {booking.seats.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs rounded-md bg-slate-50 px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {s.seatId ?? '—'}
                        </Badge>
                        <span className="font-medium">{s.passengerName ?? '—'}</span>
                        {s.passengerType && (
                          <Badge variant="secondary" className="text-[9px]">
                            {s.passengerType === 'adult' ? t('booking.passengerType.adult') : s.passengerType === 'child' ? t('booking.passengerType.child') : s.passengerType}
                          </Badge>
                        )}
                      </div>
                      <span className="font-semibold">{formatVND(s.price)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Pickup / dropoff + total */}
              <Section title={t('adminTickets.pickupDropoffAndTotal')} icon={<MapPin className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField label={t('adminTickets.pickupPoint')} value={booking.pickupName} />
                  <InfoField label={t('adminTickets.dropoffPoint')} value={booking.dropoffName} />
                </div>
                <div className="mt-2 flex items-center justify-between rounded-md bg-linear-to-r from-blue-50 to-emerald-50 px-3 py-2 text-sm">
                  <span className="font-medium">{t('booking.totalAmount')}</span>
                  <span className="font-bold text-blue-700">{formatVND(booking.total)}</span>
                </div>
                {(booking.discount || 0) > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[11px] text-emerald-700">
                    <span>{t('adminTickets.discounted')}</span>
                    <span>-{formatVND(booking.discount)}</span>
                  </div>
                )}
              </Section>
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function InfoField({
  label,
  value,
  icon,
}: {
  label: string
  value: string | null | undefined
  icon?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="font-medium truncate flex items-center gap-1">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {value || '—'}
      </div>
    </div>
  )
}

function statusLabel(s: string, t: ReturnType<typeof useT>): string {
  const m: Record<string, string> = {
    pending: t('adminTickets.statusPending'),
    confirmed: t('adminTickets.statusConfirmed'),
    paid: t('adminTickets.statusConfirmed'),
    completed: t('adminTickets.statusCompleted'),
    cancelled: t('adminTickets.statusCancelled'),
    refunded: t('adminTickets.statusRefunded'),
  }
  return m[s] ?? s
}

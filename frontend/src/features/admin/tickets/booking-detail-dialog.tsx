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
        toast.success('Đã cập nhật trạng thái', {
          description: `Vé ${booking.code}: ${statusLabel(status)}`,
        })
        setReason('')
        setForce(false)
      } catch (e: any) {
        toast.error('Không thể cập nhật trạng thái', {
          description: e?.message ?? 'Vui lòng thử lại',
        })
      }
    },
    [booking, updateStatus, reason, force],
  )

  return (
    <Dialog open={!!bookingId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TicketIcon className="h-5 w-5 text-blue-600" />
            {booking ? `Vé ${booking.code}` : 'Chi tiết vé'}
            {booking && <BookingStatusBadge status={booking.status} />}
          </DialogTitle>
          <DialogDescription>
            Thông tin chi tiết vé, hành khách, chuyến đi và quản lý trạng thái.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <TicketDetailSkeleton />
        ) : isError ? (
          <div className="p-4 text-center">
            <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Không tải được chi tiết vé.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              Thử lại
            </Button>
          </div>
        ) : booking ? (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 pb-4">
              {/* Status management block */}
              <Card className="bg-slate-50/50 border-dashed">
                <CardContent className="p-3 space-y-2.5">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Quản lý trạng thái
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
                      Xác nhận
                    </Button>
                    <Button
                      size="sm"
                      variant={booking.status === 'completed' ? 'default' : 'outline'}
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('completed')}
                      disabled={updateStatus.isPending || booking.status === 'completed'}
                    >
                      <TrendingUp className="h-3.5 w-3.5" />
                      Hoàn thành
                    </Button>
                    <Button
                      size="sm"
                      variant={booking.status === 'cancelled' ? 'destructive' : 'outline'}
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('cancelled')}
                      disabled={updateStatus.isPending || booking.status === 'cancelled'}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Huỷ vé
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
                      Hoàn tiền
                    </Button>
                  </div>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Ghi chú / lý do (tuỳ chọn)…"
                    className="text-xs min-h-10 resize-none"
                  />
                  <div className="flex items-center gap-2 text-[11px]">
                    <Switch checked={force} onCheckedChange={setForce} id="force" />
                    <Label htmlFor="force" className="cursor-pointer text-muted-foreground">
                      Bật chế độ ghi đè (admin override) — cho phép chuyển trạng thái bất kỳ
                    </Label>
                  </div>
                </CardContent>
              </Card>

              {/* Contact info */}
              <Section title="Thông tin hành khách" icon={<User className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField label="Họ tên" value={booking.contactName} />
                  <InfoField label="SĐT" value={booking.contactPhone} icon={<Phone className="h-3 w-3" />} />
                  <InfoField label="Email" value={booking.contactEmail} icon={<Mail className="h-3 w-3" />} />
                  <InfoField
                    label="Phương thức thanh toán"
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
                    Tài khoản: <span className="font-medium text-blue-700">{booking.contactName}</span>
                    {booking.contactPhone && <span>· {booking.contactPhone}</span>}
                  </div>
                )}
              </Section>

              <Section title="Thông tin chuyến đi" icon={<Bus className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField
                    label="Tuyến"
                    value={`${booking.pickupName ?? '—'} → ${booking.dropoffName ?? '—'}`}
                  />
                  <InfoField
                    label="Hãng xe"
                    value={booking.contactName ?? '—'}
                  />
                  <InfoField
                    label="Ngày đi"
                    value={formatDepartureDate(booking.createdAt)}
                  />
                  <InfoField
                    label="Loại xe"
                    value={booking.paymentMethod ?? '—'}
                  />
                </div>
              </Section>

              {/* Seats + passengers */}
              <Section title="Ghế & hành khách" icon={<TicketIcon className="h-4 w-4" />}>
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
                            {s.passengerType === 'adult' ? 'Người lớn' : s.passengerType === 'child' ? 'Trẻ em' : s.passengerType}
                          </Badge>
                        )}
                      </div>
                      <span className="font-semibold">{formatVND(s.price)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Pickup / dropoff + total */}
              <Section title="Điểm đón / trả & tổng tiền" icon={<MapPin className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField label="Điểm đón" value={booking.pickupName} />
                  <InfoField label="Điểm trả" value={booking.dropoffName} />
                </div>
                <div className="mt-2 flex items-center justify-between rounded-md bg-linear-to-r from-blue-50 to-emerald-50 px-3 py-2 text-sm">
                  <span className="font-medium">Tổng tiền</span>
                  <span className="font-bold text-blue-700">{formatVND(booking.total)}</span>
                </div>
                {(booking.discount || 0) > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[11px] text-emerald-700">
                    <span>Đã giảm</span>
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

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    pending: 'Chờ xử lý',
    confirmed: 'Đã xác nhận',
    paid: 'Đã xác nhận',
    completed: 'Hoàn thành',
    cancelled: 'Đã huỷ',
    refunded: 'Hoàn tiền',
  }
  return m[s] ?? s
}

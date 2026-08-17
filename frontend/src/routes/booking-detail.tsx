/**
 * Single booking detail route — `/bookings/$code`
 *
 * Deep-linkable booking detail. Renders the booking info inline (the
 * BookingCard component is list-oriented with expand/collapse state;
 * here we want a full-page detail view).
 */
import { useParams, Link } from '@tanstack/react-router'
import { useBooking } from '@/lib/queries'
import { useApp } from '@/lib/store'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/currency'
import { ArrowLeft, AlertCircle, Bus, MapPin, Calendar, Users, Ticket, CheckCircle2, XCircle } from 'lucide-react'

export function BookingDetailPage() {
  const { code } = useParams({ from: '/bookings/$code' })
  const { data: booking, isLoading, isError, error } = useBooking(code)
  const { currency } = useApp()

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (isError || !booking) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <Button asChild variant="ghost" size="sm" className="mb-4">
          <Link to="/bookings"><ArrowLeft className="h-4 w-4 mr-1" /> Vé của tôi</Link>
        </Button>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="h-12 w-12 text-rose-400 mb-3" />
          <h2 className="text-lg font-semibold">Không tìm thấy vé</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {(error as Error)?.message ?? `Mã vé "${code}" không hợp lệ hoặc đã bị huỷ.`}
          </p>
        </div>
      </div>
    )
  }

  const statusLabel = (() => {
    switch (booking.status) {
      case 'confirmed': return { text: 'Đã xác nhận', cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="h-3.5 w-3.5" /> }
      case 'pending': return { text: 'Chờ thanh toán', cls: 'bg-amber-100 text-amber-700', icon: <Calendar className="h-3.5 w-3.5" /> }
      case 'cancelled': return { text: 'Đã huỷ', cls: 'bg-rose-100 text-rose-700', icon: <XCircle className="h-3.5 w-3.5" /> }
      case 'completed': return { text: 'Hoàn thành', cls: 'bg-blue-100 text-blue-700', icon: <CheckCircle2 className="h-3.5 w-3.5" /> }
      default: return { text: booking.status, cls: 'bg-slate-100 text-slate-700', icon: <Ticket className="h-3.5 w-3.5" /> }
    }
  })()

  // Extract trip info from the nested trip preview (if present)
  const trip = booking.trip
  const brandName = trip?.brandName ?? trip?.route?.brand?.name ?? '—'
  const routeName = trip?.routeName ?? trip?.route?.name ?? '—'
  const departureAt = trip?.departureAt ?? null
  const passengerName = booking.seats?.[0]?.passengerName ?? booking.contactName ?? '—'
  const seatCodes = booking.seats?.map((s: any) => s.seatCode ?? s.seatId).filter(Boolean) ?? []
  const totalAmount = booking.total ?? 0

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to="/bookings"><ArrowLeft className="h-4 w-4 mr-1" /> Vé của tôi</Link>
      </Button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Chi tiết vé {booking.code}</h1>
        <Badge className={statusLabel.cls}>{statusLabel.icon} {statusLabel.text}</Badge>
      </div>

      <Card className="mb-4">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bus className="h-4 w-4" />
            <span className="font-medium text-foreground">{brandName}</span>
            <span>·</span>
            <span>{routeName}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-blue-500 mt-0.5" />
              <div>
                <div className="text-muted-foreground text-xs">Điểm đi</div>
                <div className="font-medium">{trip?.route?.from ?? '—'}</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-rose-500 mt-0.5" />
              <div>
                <div className="text-muted-foreground text-xs">Điểm đến</div>
                <div className="font-medium">{trip?.route?.to ?? '—'}</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Calendar className="h-4 w-4 text-violet-500 mt-0.5" />
              <div>
                <div className="text-muted-foreground text-xs">Khởi hành</div>
                <div className="font-medium">{departureAt ?? '—'}</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Users className="h-4 w-4 text-amber-500 mt-0.5" />
              <div>
                <div className="text-muted-foreground text-xs">Hành khách</div>
                <div className="font-medium">{passengerName}</div>
              </div>
            </div>
          </div>

          {seatCodes.length > 0 && (
            <div className="flex items-start gap-2 text-sm pt-3 border-t">
              <Ticket className="h-4 w-4 text-blue-500 mt-0.5" />
              <div>
                <div className="text-muted-foreground text-xs">Ghế</div>
                <div className="font-medium">{seatCodes.join(', ')}</div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t">
            <span className="text-sm text-muted-foreground">Tổng tiền</span>
            <span className="text-xl font-bold text-blue-700">{formatCurrency(totalAmount, currency)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

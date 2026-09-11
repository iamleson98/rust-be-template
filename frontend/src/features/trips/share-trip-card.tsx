'use client'

/**
 * ShareTripCard — the trip-card preview shown inside the share dialog
 * (gradient backdrop + white card with brand, route, departure, price
 * and the share code/URL).
 *
 * Extracted from the original `share-dialog.tsx`.
 */

import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/currency'
import { formatDateVN, formatTimeVN } from '@/lib/types'
import {
  Bus,
  Star,
  Navigation,
  Clock,
  Calendar,
  Armchair,
  Sparkles,
} from 'lucide-react'
import type { ShareTripData } from './share-helpers'

export function ShareTripCard({
  shareTripData,
  shareInfo,
  currency,
}: {
  shareTripData: ShareTripData
  shareInfo: { code: string; url: string }
  currency: 'VND' | 'USD'
}) {
  return (
            <div
              className="relative rounded-2xl overflow-hidden"
            >
              {/* Gradient background */}
              <div className="bg-linear-to-br from-blue-600 via-blue-500 to-blue-600 p-5 text-white relative">
                {/* Decorative circles */}
                <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-white/10" />
                <div className="absolute -bottom-16 -left-12 h-44 w-44 rounded-full bg-white/10" />

                {/* Brand strip */}
                <div className="flex items-center gap-2 mb-3 relative z-10">
                  <div className="h-7 w-7 rounded-lg bg-white/20 flex items-center justify-center">
                    <Bus className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-extrabold tracking-wide">DatXeVui</div>
                  <span className="text-[10px] text-white/80 ml-auto">Đặt vé xe online</span>
                </div>

                {/* White card */}
                <div className="bg-white rounded-xl overflow-hidden relative z-10">
                  {/* Top accent stripe */}
                  <div
                    className="h-1.5"
                    style={{ background: shareTripData.brandAccent || '#2563eb' }}
                  />
                  <div className="p-4">
                    {/* Brand + rating */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-bold text-slate-900 text-sm truncate flex-1">
                        {shareTripData.brandName}
                      </div>
                      {shareTripData.brandRating && (
                        <Badge variant="outline" className="text-[10px] gap-0.5 border-amber-300 text-amber-700 font-semibold">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {shareTripData.brandRating.toFixed(1)}
                        </Badge>
                      )}
                    </div>

                    {/* Route */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className="font-extrabold text-slate-900 text-base truncate flex-1">
                        {shareTripData.fromName}
                      </div>
                      <div className="shrink-0 h-7 w-7 rounded-full bg-blue-50 flex items-center justify-center">
                        <Navigation className="h-3.5 w-3.5 text-blue-600" />
                      </div>
                      <div className="font-extrabold text-slate-900 text-base truncate flex-1 text-right">
                        {shareTripData.toName}
                      </div>
                    </div>

                    {/* Departure + vehicle type */}
                    <div className="grid grid-cols-2 gap-3 text-xs mb-3 pb-3 border-b border-dashed">
                      <div>
                        <div className="text-muted-foreground uppercase tracking-wide text-[9px]">Khởi hành</div>
                        <div className="font-semibold text-slate-900 flex items-center gap-1">
                          <Clock className="h-3 w-3 text-blue-600" />
                          {shareTripData.departureTime || (shareTripData.departureAt ? formatTimeVN(shareTripData.departureAt) : '')}
                        </div>
                        {shareTripData.departureAt && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-2.5 w-2.5" />
                            {formatDateVN(shareTripData.departureAt, { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-muted-foreground uppercase tracking-wide text-[9px]">Loại xe</div>
                        <div className="font-semibold text-slate-900 flex items-center gap-1">
                          <Armchair className="h-3 w-3 text-blue-600" />
                          {shareTripData.vehicleTypeLabel || 'Xe khách'}
                        </div>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="rounded-lg bg-blue-50 p-3 flex items-end justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-blue-700 font-semibold">Giá từ</div>
                        <div className="text-2xl font-extrabold text-blue-700 leading-none">
                          {formatCurrency(shareTripData.minPrice, currency)}
                        </div>
                      </div>
                      <Badge className="bg-amber-100 text-amber-800 border-0 gap-0.5 text-[10px]">
                        <Sparkles className="h-3 w-3" />
                        Ưu đãi hôm nay
                      </Badge>
                    </div>

                    {/* Share code + URL */}
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Mã: <span className="font-mono font-bold text-blue-700">{shareInfo.code}</span></span>
                      <span className="truncate ml-2">{shareInfo.url}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
  )
}

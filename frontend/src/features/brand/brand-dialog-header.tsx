'use client'

// Extracted from the original 'brand-detail-dialog.tsx'.

import {
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  Star,
  Phone,
  Mail,
  Bus,
  Route as RouteIcon,
  MessageSquareQuote,
  CheckCircle2,
} from 'lucide-react'
import { renderStars, type BrandDetail } from './brand-detail-helpers'
import { StatCard } from './brand-dialog-parts'

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function BrandDialogHeader({
  brand,
  accent,
  reviewCount,
  routesCount,
}: {
  brand: BrandDetail
  accent: string
  reviewCount: number
  routesCount: number
}) {
  return (
    <>
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            background: `linear-gradient(135deg, ${accent} 0%, transparent 60%)`,
          }}
        />
        {/* Accent color bar */}
        <div
          className="h-1.5 w-full"
          style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }}
        />
        <div className="px-5 py-4 relative">
          <div className="flex items-start gap-4">
            {/* Logo / initials */}
            <div
              className="h-16 w-16 rounded-xl flex items-center justify-center text-white font-extrabold text-xl shrink-0"
              style={{ background: accent }}
            >
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt={brand.name}
                  className="h-11 w-11 object-contain"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                getInitials(brand.name)
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-xl font-extrabold tracking-tight">
                  {brand.name}
                </DialogTitle>
                {brand.status === 'active' && (
                  <Badge
                    className="text-[10px] gap-1 bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100"
                    variant="outline"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Đang hoạt động
                  </Badge>
                )}
              </div>
              <DialogDescription className="sr-only">
                Chi tiết hãng xe {brand.name}
              </DialogDescription>

              <div className="flex items-center gap-3 mt-1.5 text-sm flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="flex items-center gap-0.5">
                    {renderStars(brand.rating)}
                  </span>
                  <span className="font-semibold text-amber-600">
                    {brand.rating.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({reviewCount} đánh giá)
                  </span>
                </span>
                {brand.contactPhone && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {brand.contactPhone}
                  </span>
                )}
                {brand.contactEmail && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" />
                    {brand.contactEmail}
                  </span>
                )}
              </div>

              {brand.description && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                  {brand.description}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-5 py-3 bg-slate-50/70 border-b">
        <StatCard
          icon={<RouteIcon className="h-4 w-4" />}
          label="Tuyến đường"
          value={routesCount}
          color={accent}
        />
        <StatCard
          icon={<Bus className="h-4 w-4" />}
          label="Chuyến / ngày"
          value={brand.totalTrips ?? 0}
          color={accent}
        />
        <StatCard
          icon={<Star className="h-4 w-4" />}
          label="Đánh giá TB"
          value={brand.rating.toFixed(1)}
          color="#f59e0b"
        />
        <StatCard
          icon={<MessageSquareQuote className="h-4 w-4" />}
          label="Lượt đánh giá"
          value={reviewCount}
          color="#2563eb"
        />
      </div>
    </>
  )
}

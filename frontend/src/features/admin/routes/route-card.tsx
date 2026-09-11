'use client'

/**
 * Mobile card for one route — rendered inside the DataTable's
 * `mobileList` below `md`.
 *
 * Extracted from the original 'src/routes/admin/routes.tsx'.
 */

import { Button } from '@/components/ui/button'
import { Pencil, Trash2 } from 'lucide-react'
import type { AdminBrandOut, AdminRouteOut } from '@/lib/api/types.gen'
import { BrandDot } from '@/features/admin/brand-dot'
import { cityLabel } from './route-page-helpers'

export function RouteMobileCard({
  route,
  brand,
  onEdit,
  onDelete,
}: {
  route: AdminRouteOut
  brand?: AdminBrandOut
  onEdit: (route: AdminRouteOut) => void
  onDelete: (route: AdminRouteOut) => void
}) {
  return (
    <div className="p-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{route.name}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
          {brand ? (
            <>
              <BrandDot color={brand.accentColor} />
              <span className="truncate">{brand.name}</span>
              <span>·</span>
            </>
          ) : null}
          {cityLabel(route.startLocationId)} → {cityLabel(route.endLocationId)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {route.scheduleCount} lịch trình · {route.pickupPointCount} điểm đón
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onEdit(route)}
          aria-label="Sửa tuyến"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-rose-600"
          onClick={() => onDelete(route)}
          aria-label="Xoá tuyến"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

'use client'

/**
 * Breadcrumb of the AdminBrandManagement master-detail layout
 * (Hãng xe / brand / route).
 *
 * Extracted from the original 'src/features/admin/brands/panels.tsx'.
 */

import { ChevronRight } from 'lucide-react'
import type { AdminRouteOut, AdminBrandOut } from '@/lib/api/types.gen'

export function BrandManagementBreadcrumb({
  selectedBrand,
  selectedRoute,
  onBrandsClick,
  onRoutesClick,
}: {
  selectedBrand: AdminBrandOut | null
  selectedRoute: AdminRouteOut | null
  onBrandsClick: () => void
  onRoutesClick: () => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm flex-wrap">
      <button
        onClick={onBrandsClick}
        className={`font-semibold hover:underline ${!selectedBrand ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        Hãng xe
      </button>
      {selectedBrand && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            onClick={onRoutesClick}
            className={`hover:underline ${!selectedRoute ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}
          >
            {selectedBrand.name}
          </button>
        </>
      )}
      {selectedBrand && selectedRoute && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-foreground font-semibold">{selectedRoute.name}</span>
        </>
      )}
    </div>
  )
}

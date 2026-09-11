'use client'

/**
 * Table columns for the admin routes DataTable — name, brand, cities,
 * schedule/pickup counts and row actions.
 *
 * Extracted from the original 'src/routes/admin/routes.tsx'.
 */

import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowRight, MapPin, Pencil, Trash2 } from 'lucide-react'
import type { AdminBrandOut, AdminRouteOut } from '@/lib/api/types.gen'
import { BrandDot } from '@/features/admin/brand-dot'
import { cityLabel } from './route-page-helpers'

const routeColumnHelper = createColumnHelper<DataTableFeatures, AdminRouteOut>()

export function useRouteColumns({
  brandById,
  setEditRoute,
  setDialogOpen,
  setDeleteTarget,
}: {
  brandById: Map<string, AdminBrandOut>
  setEditRoute: React.Dispatch<React.SetStateAction<AdminRouteOut | null>>
  setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  setDeleteTarget: React.Dispatch<React.SetStateAction<AdminRouteOut | null>>
}) {
  // Columns close over the brand map (icon color + name) and stable setters.
  return useMemo(
    () =>
      routeColumnHelper.columns([
        routeColumnHelper.accessor('name', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Tên tuyến" />
          ),
          cell: ({ getValue }) => (
            <span className="block max-w-55 truncate font-medium">{getValue()}</span>
          ),
          sortFn: 'text',
          meta: { label: 'Tên tuyến' },
        }),
        routeColumnHelper.accessor((r) => brandById.get(r.brandId ?? '')?.name ?? '', {
          id: 'brand',
          header: ({ column }) => <DataTableColumnHeader column={column} title="Hãng" />,
          cell: ({ row }) => {
            const brand = brandById.get(row.original.brandId ?? '')
            return brand ? (
              <span className="flex items-center gap-1.5">
                <BrandDot color={brand.accentColor} />
                <span className="max-w-45 truncate">{brand.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          },
          sortFn: 'text',
          meta: { label: 'Hãng' },
        }),
        routeColumnHelper.display({
          id: 'cities',
          header: 'Điểm đi → Điểm đến',
          cell: ({ row }) => (
            <span className="flex items-center gap-1.5 text-sm">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-600" />
              <span className="max-w-32.5 truncate">
                {cityLabel(row.original.startLocationId)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <MapPin className="h-3.5 w-3.5 shrink-0 text-rose-600" />
              <span className="max-w-32.5 truncate">
                {cityLabel(row.original.endLocationId)}
              </span>
            </span>
          ),
          meta: { label: 'Điểm đi → Điểm đến' },
        }),
        routeColumnHelper.accessor('scheduleCount', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Lịch trình" />
          ),
          cell: ({ getValue }) => (
            <Badge variant="secondary" className="tabular-nums">
              {getValue()}
            </Badge>
          ),
          sortFn: 'basic',
          meta: { label: 'Lịch trình', align: 'center' },
        }),
        routeColumnHelper.accessor('pickupPointCount', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Điểm đón" />,
          cell: ({ getValue }) => (
            <Badge variant="outline" className="tabular-nums">
              {getValue()}
            </Badge>
          ),
          sortFn: 'basic',
          meta: { label: 'Điểm đón', align: 'center' },
        }),
        routeColumnHelper.display({
          id: 'actions',
          header: 'Thao tác',
          cell: ({ row }) => (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setEditRoute(row.original)
                  setDialogOpen(true)
                }}
                aria-label="Sửa tuyến"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                onClick={() => setDeleteTarget(row.original)}
                aria-label="Xoá tuyến"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ),
          enableSorting: false,
          enableHiding: false,
          meta: { align: 'right', label: 'Thao tác' },
        }),
      ]),
    [brandById, setEditRoute, setDialogOpen, setDeleteTarget],
  )
}

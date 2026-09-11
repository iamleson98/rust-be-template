'use client'

/**
 * Routes list panel of the AdminBrandManagement master-detail layout.
 *
 * Extracted from the original 'src/features/admin/brands/panels.tsx'.
 */

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RouteListSkeleton } from '@/features/admin/routes/route-list-skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Route as RouteIcon,
  MapPin,
  Plus,
  Pencil,
  Trash2,
  Search,
  ArrowLeft,
} from 'lucide-react'
import type { AdminRouteOut, AdminBrandOut } from '@/lib/api/types.gen'

export function RouteListPanel({
  routesLoading,
  filteredRoutes,
  routeSearch,
  setRouteSearch,
  selectedBrand,
  selectedRoute,
  onSelectRoute,
  onAdd,
  onEdit,
  onDelete,
  onBack,
  mobileView,
}: {
  routesLoading: boolean
  filteredRoutes: AdminRouteOut[]
  routeSearch: string
  setRouteSearch: (v: string) => void
  selectedBrand: AdminBrandOut | null
  selectedRoute: AdminRouteOut | null
  onSelectRoute: (r: AdminRouteOut) => void
  onAdd: () => void
  onEdit: (r: AdminRouteOut) => void
  onDelete: (r: AdminRouteOut) => void
  onBack: () => void
  mobileView: 'brands' | 'routes' | 'details'
}) {
  return (
    <Card
      className={` overflow-hidden ${mobileView === 'routes' ? 'block' : 'hidden lg:block'}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <RouteIcon className="h-4 w-4 text-blue-600" /> Tuyến đường
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 lg:hidden"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1"
              disabled={!selectedBrand}
              onClick={onAdd}
            >
              <Plus className="h-3.5 w-3.5" /> Thêm
            </Button>
          </div>
        </div>
        {selectedBrand ? (
          <div className="text-[11px] text-muted-foreground truncate">
            Thuộc: <span className="font-medium" style={{ color: selectedBrand.accentColor as any }}>{selectedBrand.name}</span>
          </div>
        ) : null}
        <div className="relative mt-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Tìm tuyến..."
            value={routeSearch}
            onChange={(e) => setRouteSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
            disabled={!selectedBrand}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-135">
          {!selectedBrand ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <RouteIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Chọn một hãng xe bên trái
            </div>
          ) : routesLoading ? (
            <RouteListSkeleton count={4} />
          ) : filteredRoutes.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <RouteIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Chưa có tuyến nào
            </div>
          ) : (
            <div className="divide-y">
              {filteredRoutes.map((r) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRoute(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectRoute(r)
                    }
                  }}
                  className={`w-full text-left p-3 hover:bg-slate-50 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-200 rounded-sm ${selectedRoute?.id === r.id ? 'bg-blue-50/60 border-l-2 border-l-blue-600' : ''
                    }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-[11px] font-mono font-bold text-blue-700">{r.id.slice(0, 8)}</code>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                        {r.scheduleCount} lịch
                      </Badge>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onEdit(r)
                        }}
                        className="text-slate-400 hover:text-blue-600 p-1 rounded transition-colors"
                        title="Sửa"
                        aria-label={`Sửa tuyến ${r.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(r)
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                        title="Xoá"
                        aria-label={`Xoá tuyến ${r.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="font-medium text-sm mt-0.5 truncate">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {r.startLocation?.name ?? '—'} → {r.endLocation?.name ?? '—'}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                    <span className="flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" /> {r.pickupPointCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

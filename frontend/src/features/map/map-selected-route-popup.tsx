'use client'

// Extracted from the original 'map-view.tsx'.

import { Button } from '@/components/ui/button'
import { Bus, ArrowRight, X, Navigation, Wallet, Search } from 'lucide-react'
import { formatVND } from '@/lib/types'
import type { RouteItem } from './map-view-types'

export function MapSelectedRoutePopup({
  selectedRoute,
  quickSearch,
  setSelectedRoute,
}: {
  selectedRoute: RouteItem | null
  quickSearch: (fromName: string, toName: string) => void
  setSelectedRoute: React.Dispatch<React.SetStateAction<RouteItem | null>>
}) {
  return (
    selectedRoute && (
      <div className="absolute bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-1000 w-85 max-w-[calc(100vw-1.5rem)] rounded-xl bg-white ring-1 ring-black/5 overflow-hidden ">
        <div className="h-1.5 w-full" style={{ background: selectedRoute.brand.accentColor }} />
        <div className="p-3.5">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                <Bus className="h-3 w-3" style={{ color: selectedRoute.brand.accentColor }} />
                {selectedRoute.brand.name}
              </div>
              <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">
                <span className="truncate">{selectedRoute.from.name}</span>
                <ArrowRight className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                <span className="truncate">{selectedRoute.to.name}</span>
              </div>
            </div>
            <button onClick={() => setSelectedRoute(null)} className="hover:bg-slate-100 rounded p-1 -mt-1 -mr-1">
              <X className="h-3.5 w-3.5 text-slate-500" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            <div className="rounded-md bg-slate-50 px-2 py-1.5 text-center">
              <Navigation className="h-3 w-3 text-slate-500 mx-auto mb-0.5" />
              <div className="text-[10px] text-muted-foreground">Chuyến/ngày</div>
              <div className="text-[11px] font-semibold">{selectedRoute.scheduleCount}</div>
            </div>
            {selectedRoute.minPrice > 0 ? (
              <div className="rounded-md bg-slate-50 px-2 py-1.5 text-center">
                <Wallet className="h-3 w-3 text-slate-500 mx-auto mb-0.5" />
                <div className="text-[10px] text-muted-foreground">
                  Giá{selectedRoute.maxPrice > selectedRoute.minPrice ? ' từ' : ''}
                </div>
                <div className="text-[11px] font-semibold">{formatVND(selectedRoute.minPrice)}</div>
              </div>
            ) : (
              <div className="rounded-md bg-slate-50 px-2 py-1.5 text-center opacity-60">
                <Wallet className="h-3 w-3 text-slate-500 mx-auto mb-0.5" />
                <div className="text-[10px] text-muted-foreground">Giá</div>
                <div className="text-[11px] font-semibold">—</div>
              </div>
            )}
          </div>
          <Button
            size="sm"
            className="w-full text-white gap-1.5"
            style={{ background: selectedRoute.brand.accentColor }}
            onClick={() => quickSearch(selectedRoute.from.name, selectedRoute.to.name)}
          >
            <Search className="h-3.5 w-3.5" />
            Tìm chuyến
          </Button>
        </div>
      </div>
    )
  )
}

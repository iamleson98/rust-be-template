'use client'

// Extracted from the original 'map-view.tsx'.

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MapPin, X, ArrowRight, Search } from 'lucide-react'
import type { Place } from './map-view-types'

export function MapSelectedCityPopup({
  selectedCity,
  places,
  handleCityClick,
  quickSearch,
  setSelectedCity,
}: {
  selectedCity: { place: Place; routeCount: number; popularDests: string[] } | null
  places: Place[]
  handleCityClick: (place: Place) => void
  quickSearch: (fromName: string, toName: string) => void
  setSelectedCity: React.Dispatch<React.SetStateAction<{ place: Place; routeCount: number; popularDests: string[] } | null>>
}) {
  return (
    selectedCity && (
      <div className="absolute top-3 left-3 md:left-72.5 z-1000 w-70 max-w-[calc(100vw-1.5rem)] rounded-xl bg-white ring-1 ring-black/5 overflow-hidden ">
        <div className="bg-linear-to-r from-blue-600 to-blue-700 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4" />
            <span className="font-bold text-sm">{selectedCity.place.name}</span>
          </div>
          <button onClick={() => setSelectedCity(null)} className="hover:bg-white/15 rounded p-0.5">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="secondary" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
              {selectedCity.place.type === 'city' ? 'Thành phố' : selectedCity.place.type === 'bus_station' ? 'Bến xe' : 'Địa điểm'}
            </Badge>
            {selectedCity.place.province && <span className="text-muted-foreground">{selectedCity.place.province}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-blue-50 ring-1 ring-blue-100 p-2">
              <div className="text-lg font-bold text-blue-700 tabular-nums">{selectedCity.routeCount}</div>
              <div className="text-[10px] text-muted-foreground">tuyến đường</div>
            </div>
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-100 p-2">
              <div className="text-lg font-bold text-amber-600 tabular-nums">{selectedCity.popularDests.length}</div>
              <div className="text-[10px] text-muted-foreground">điểm đến</div>
            </div>
          </div>
          {selectedCity.popularDests.length > 0 ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Điểm đến phổ biến</div>
              <div className="flex flex-wrap gap-1">
                {selectedCity.popularDests.map((d) => {
                  const destPlace = places.find((p) => p.name === d)
                  return (
                    <button
                      key={d}
                      onClick={() => {
                        if (destPlace) handleCityClick(destPlace)
                        else quickSearch(selectedCity.place.name, d)
                      }}
                      className="inline-flex items-center gap-1 text-[11px] rounded-full bg-slate-100 hover:bg-blue-100 hover:text-blue-700 px-2 py-0.5 transition-colors"
                    >
                      <ArrowRight className="h-2.5 w-2.5" />
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">Chưa có tuyến đường nào đi qua địa điểm này.</p>
          )}
          {selectedCity.popularDests.length > 0 && (
            <Button
              size="sm"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              onClick={() => quickSearch(selectedCity.place.name, selectedCity.popularDests[0])}
            >
              <Search className="h-3.5 w-3.5" />
              Tìm chuyến từ {selectedCity.place.name}
            </Button>
          )}
        </div>
      </div>
    )
  )
}

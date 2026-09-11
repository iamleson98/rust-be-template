'use client'

import { useEffect, useMemo, useState, useCallback, lazy, Suspense } from 'react'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { usePlacesList, usePopularRoutes } from '@/lib/queries'
import {
  MapPin,
  Navigation,
  Crosshair,
  Search,
  X,
  Wallet,
  Locate,
  Loader2,
  Bus,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatVND, noTones } from '@/lib/types'
import { buildSearchInput } from '@/lib/search-params'

// Real OSM map (loaded client-side only — leaflet touches `window`).
const RouteMapInner = lazy(() => import('@/features/map/route-map-inner').then((m) => ({ default: m.RouteMapInner })))
const RouteMapInnerFallback = (
  <div className="flex items-center justify-center h-full text-muted-foreground">
    <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
  </div>
)

// ── Types ─────────────────────────────────────────────────
type Place = {
  id: string
  name: string
  type: string
  province: string | null
  lat: number
  lon: number
  population: number
}

type RouteItem = {
  id: string
  slug: string
  name: string
  code: string
  brand: { name: string; slug: string; accentColor: string; logoUrl: string | null; rating: number }
  from: { name: string; lat: number; lon: number }
  to: { name: string; lat: number; lon: number }
  scheduleCount: number
  minPrice: number
  maxPrice: number
}

// ── Mock current location (Hà Nội center) ─────────────────
const MOCK_USER_LOCATION = { lat: 21.0285, lon: 105.8542, label: 'Hà Nội (vị trí của bạn)' }

// ── Component ─────────────────────────────────────────────
export function MapView() {
  const { setSearchParams } = useApp()
  const navigate = useNavigate()
  const [places, setPlaces] = useState<Place[]>([])
  const [routes, setRoutes] = useState<RouteItem[]>([])
  const [loading, setLoading] = useState(true)

  // Interaction state
  const [selectedCity, setSelectedCity] = useState<{ place: Place; routeCount: number; popularDests: string[] } | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<RouteItem | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [placeSearch, setPlaceSearch] = useState<Place[]>([])
  const [showUserLocation, setShowUserLocation] = useState(false)
  const [activeBrandSlugs, setActiveBrandSlugs] = useState<Set<string>>(new Set())
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false)
  // flyTo trigger — `key` forces re-fly even if coords are the same
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; zoom?: number; key: number } | null>(null)

  // ── Fetch places + routes via TanStack Query ────────────────
  const placesQuery = usePlacesList(50)
  const routesQuery = usePopularRoutes()

  useEffect(() => {
    if (placesQuery.data) {
      setPlaces((placesQuery.data.items ?? []) as any)
    }
  }, [placesQuery.data])

  useEffect(() => {
    if (routesQuery.data) {
      const rs: any[] = routesQuery.data.items ?? []
      setRoutes(rs)
      const slugs = new Set<string>()
      rs.forEach((route: any) => slugs.add(route.brand?.slug ?? ''))
      setActiveBrandSlugs(slugs)
      setLoading(false)
    }
  }, [routesQuery.data])

  // ── Derived: route counts per city, popular destinations ──
  const cityStats = useMemo(() => {
    const map = new Map<string, { count: number; dests: Map<string, number> }>()
    for (const r of routes) {
      if (!activeBrandSlugs.has(r.brand.slug)) continue
      if (!map.has(r.from.name)) map.set(r.from.name, { count: 0, dests: new Map() })
      const f = map.get(r.from.name)!
      f.count += 1
      f.dests.set(r.to.name, (f.dests.get(r.to.name) ?? 0) + 1)
      if (!map.has(r.to.name)) map.set(r.to.name, { count: 0, dests: new Map() })
      const t = map.get(r.to.name)!
      t.count += 1
      t.dests.set(r.from.name, (t.dests.get(r.from.name) ?? 0) + 1)
    }
    return map
  }, [routes, activeBrandSlugs])

  const visibleRoutes = useMemo(
    () => routes.filter((r) => activeBrandSlugs.has(r.brand.slug)),
    [routes, activeBrandSlugs],
  )

  const brands = useMemo(() => {
    const map = new Map<string, { slug: string; name: string; accentColor: string; routeCount: number }>()
    for (const r of routes) {
      const existing = map.get(r.brand.slug)
      if (existing) existing.routeCount += 1
      else
        map.set(r.brand.slug, {
          slug: r.brand.slug,
          name: r.brand.name,
          accentColor: r.brand.accentColor,
          routeCount: 1,
        })
    }
    return Array.from(map.values())
  }, [routes])

  // ── Search: filter places by query ───────────────────────
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setPlaceSearch([])
      return
    }
    const qNoTones = noTones(q)
    const results = places
      .filter(
        (p) =>
          noTones(p.name).includes(qNoTones) ||
          (p.province && noTones(p.province).includes(qNoTones)),
      )
      .slice(0, 6)
    setPlaceSearch(results)
  }, [searchQuery, places])

  // ── City click ───────────────────────────────────────────
  const handleCityClick = useCallback(
    (place: Place) => {
      const stats = cityStats.get(place.name)
      setSelectedRoute(null)
      setSelectedCity({
        place,
        routeCount: stats?.count ?? 0,
        popularDests: stats
          ? Array.from(stats.dests.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map((e) => e[0])
          : [],
      })
      setFlyTo({ lat: place.lat, lon: place.lon, zoom: 8, key: Date.now() })
    },
    [cityStats],
  )

  // ── Route click ──────────────────────────────────────────
  const handleRouteClick = useCallback((route: RouteItem) => {
    setSelectedCity(null)
    setSelectedRoute(route)
  }, [])

  // ── "Tìm chuyến" — navigate to /search with the from/to/date as URL params.
  // The search route's validateSearch parses these and the SearchResults
  // component uses useTripSearch() to fetch — no manual state juggling.
  const quickSearch = (fromName: string, toName: string) => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const date = tomorrow.toISOString().slice(0, 10)
    // Keep the search form state in sync so returning to the homepage shows
    // the last-used values in the SearchWidget.
    setSearchParams({ from: fromName, to: toName, date })
    navigate({
      to: '/search',
      search: buildSearchInput({ from: fromName, to: toName, date }),
    })
  }

  const handleSearchSelect = (place: Place) => {
    setSearchQuery(place.name)
    setPlaceSearch([])
    handleCityClick(place)
  }

  const handleShowMyLocation = () => {
    setShowUserLocation(true)
    setFlyTo({ lat: MOCK_USER_LOCATION.lat, lon: MOCK_USER_LOCATION.lon, zoom: 11, key: Date.now() })
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-3" />
        <p className="text-sm">Đang tải bản đồ tuyến đường...</p>
      </div>
    )
  }

  return (
    <div className="relative w-full">
      {/* Page header */}
      <div className="bg-linear-to-r from-blue-700 to-blue-800 text-white">
        <div className="container mx-auto px-4 py-5">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
              <MapPin className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold leading-tight">Bản đồ tuyến đường</h1>
              <p className="text-[12px] text-blue-100">
                Khám phá {routes.length} tuyến đường của {brands.length} hãng xe trên khắp Việt Nam
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative md:flex md:items-start">
        {/* Sidebar */}
        <MapSidebar
          brands={brands}
          activeBrandSlugs={activeBrandSlugs}
          setActiveBrandSlugs={setActiveBrandSlugs}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchResults={placeSearch}
          onSearchSelect={(p) => {
            handleSearchSelect(p)
            setSidebarOpenMobile(false)
          }}
          open={sidebarOpenMobile}
          onClose={() => setSidebarOpenMobile(false)}
        />

        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setSidebarOpenMobile(true)}
          className="md:hidden fixed left-4 top-35 z-30 h-10 w-10 rounded-full bg-white ring-1 ring-black/10 flex items-center justify-center text-blue-700 transition-transform "
          aria-label="Mở bộ lọc"
        >
          <Search className="h-4 w-4" />
        </button>

        {/* Map canvas — real OSM. On desktop this sits next to the sidebar
            (flex-1), on mobile it stacks below.
            `isolate` creates a stacking context so leaflet's internal panes
            (z-index 200-700) stay CONTAINED here and don't paint over the
            sticky site header (z-40) when scrolling. */}
        <div className="relative isolate w-full md:flex-1 h-[75vh] md:h-[80vh] overflow-hidden">
          <Suspense fallback={RouteMapInnerFallback}>
            <RouteMapInner
              places={places}
              routes={visibleRoutes}
              cityStats={cityStats}
              selectedCity={selectedCity}
              selectedRoute={selectedRoute}
              onSelectCity={handleCityClick}
              onSelectRoute={handleRouteClick}
              flyTo={flyTo}
            />
          </Suspense>

          {/* "Vị trí của tôi" button */}
          <button
            onClick={handleShowMyLocation}
            className={`absolute bottom-6 right-3 z-1000 h-11 px-3 rounded-full ring-1 ring-black/10 flex items-center gap-1.5 text-xs font-medium transition-all  ${showUserLocation ? 'bg-blue-600 text-white ring-blue-400' : 'bg-white text-blue-700 hover:bg-blue-50'
              }`}
            aria-label="Vị trí của tôi"
          >
            <Locate className="h-4 w-4" />
            <span className="hidden sm:inline">Vị trí của tôi</span>
          </button>

          {/* Compact legend (mobile) */}
          <div className="md:hidden absolute bottom-6 left-3 z-1000 rounded-lg bg-white/95 backdrop-blur ring-1 ring-black/5 p-2.5 max-w-45 ">
            <div className="text-[10px] font-semibold text-slate-600 uppercase mb-1.5">Hãng xe</div>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {brands.map((b) => (
                <div key={b.slug} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: b.accentColor }} />
                  <span className="text-[10px] text-slate-700">{b.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Selected city popup (top-left) */}
          {selectedCity && (
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
          )}

          {/* Selected route popup (bottom-center) */}
          {selectedRoute && (
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
          )}

          {/* Hint */}
          {!selectedCity && !selectedRoute && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 md:left-[calc(50%+145px)] z-1000 pointer-events-none">
              <div className="rounded-full bg-white/90 backdrop-blur px-3 py-1.5 text-[11px] text-slate-600 ring-1 ring-black/5 ">
                <span className="hidden sm:inline">Kéo để di chuyển • Cuộn để zoom • Click điểm/tuyến để xem chi tiết</span>
                <span className="sm:hidden">Chạm vào điểm để xem chi tiết</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sidebar (brand filter + search) ───────────────────────
function MapSidebar({
  brands,
  activeBrandSlugs,
  setActiveBrandSlugs,
  searchQuery,
  setSearchQuery,
  searchResults,
  onSearchSelect,
  open,
  onClose,
}: {
  brands: { slug: string; name: string; accentColor: string; routeCount: number }[]
  activeBrandSlugs: Set<string>
  setActiveBrandSlugs: (s: Set<string>) => void
  searchQuery: string
  setSearchQuery: (s: string) => void
  searchResults: Place[]
  onSearchSelect: (p: Place) => void
  open: boolean
  onClose: () => void
}) {
  const toggleBrand = (slug: string) => {
    const next = new Set(activeBrandSlugs)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    setActiveBrandSlugs(next)
  }
  const allActive = activeBrandSlugs.size === brands.length

  return (
    <>
      {open && <div className="md:hidden fixed inset-0 bg-black/40 z-1100" onClick={onClose} />}
      <aside
        className={`md:shrink-0 z-1100 md:z-10 w-67.5 bg-white ring-1 ring-black/5 md:ring-0 md:border-r md:border-slate-200 fixed md:static top-0 left-0 h-[calc(100vh-4rem)] md:h-[80vh] md:overflow-y-auto transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          }`}
      >
        <div className="p-3.5 space-y-4 overflow-y-auto h-full max-h-[calc(80vh-2rem)] md:max-h-none">
          <div className="md:hidden flex justify-end">
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search box */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" />
              Tìm thành phố
            </div>
            <div className="relative">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="VD: Hà Nội, Đà Nẵng..."
                className="pr-8 h-9 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
                  aria-label="Xóa tìm kiếm"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="mt-1.5 rounded-md border border-slate-200 bg-white overflow-hidden">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onSearchSelect(p)}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-blue-50 transition-colors flex items-center gap-1.5 border-b border-slate-100 last:border-0"
                  >
                    <MapPin className="h-3 w-3 text-blue-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{p.name}</div>
                      {p.province && <div className="text-[10px] text-muted-foreground truncate">{p.province}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Brand filter */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lọc theo hãng</div>
              <button
                onClick={() => setActiveBrandSlugs(new Set(brands.map((b) => b.slug)))}
                className={`text-[10px] font-medium ${allActive ? 'text-slate-400' : 'text-blue-600 hover:text-blue-700'}`}
                disabled={allActive}
              >
                Chọn tất cả
              </button>
            </div>
            <div className="space-y-1">
              {brands.map((b) => {
                const active = activeBrandSlugs.has(b.slug)
                return (
                  <label
                    key={b.slug}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <input type="checkbox" checked={active} onChange={() => toggleBrand(b.slug)} className="h-3.5 w-3.5 rounded accent-blue-600" />
                    <span className="h-3 w-3 rounded-full shrink-0 ring-2 ring-white" style={{ background: b.accentColor }} />
                    <span className="text-xs font-medium flex-1 truncate">{b.name}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{b.routeCount}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Chú thích</div>
            <div className="space-y-1.5 text-[11px] text-slate-700">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-white ring-2 ring-blue-600" />
                Thành phố lớn
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-white ring-2 ring-slate-400" />
                Địa điểm nhỏ
              </div>
              <div className="flex items-center gap-2">
                <span className="block w-6 h-0.5 rounded-full" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #2563eb 0 4px, transparent 4px 8px)' }} />
                Tuyến đường
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-1">
                <Crosshair className="h-3 w-3" />
                Nguồn bản đồ: OpenStreetMap · CARTO
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

'use client'

import { useEffect, useMemo, useState, useCallback, lazy, Suspense } from 'react'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { usePlacesList, usePopularRoutes } from '@/lib/queries'
import { MapPin, Search, Locate, Loader2 } from 'lucide-react'
import { noTones } from '@/lib/types'
import { buildSearchInput } from '@/lib/search-params'
import type { Place, RouteItem } from './map-view-types'
import { MapSidebar } from './map-sidebar'
import { MapSelectedCityPopup } from './map-selected-city-popup'
import { MapSelectedRoutePopup } from './map-selected-route-popup'

// Real OSM map (loaded client-side only — leaflet touches `window`).
const RouteMapInner = lazy(() => import('@/features/map/route-map-inner').then((m) => ({ default: m.RouteMapInner })))
const RouteMapInnerFallback = (
  <div className="flex items-center justify-center h-full text-muted-foreground">
    <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
  </div>
)

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
          <MapSelectedCityPopup
            selectedCity={selectedCity}
            places={places}
            handleCityClick={handleCityClick}
            quickSearch={quickSearch}
            setSelectedCity={setSelectedCity}
          />

          {/* Selected route popup (bottom-center) */}
          <MapSelectedRoutePopup
            selectedRoute={selectedRoute}
            quickSearch={quickSearch}
            setSelectedRoute={setSelectedRoute}
          />

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

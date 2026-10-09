'use client'

/**
 * PlaceAutocomplete — the From/To field of the search widget.
 *
 * TWO search modes in ONE field (the product's "default search" +
 * "smart search"):
 *
 *  1. CITY LIST (default): on focus the dropdown opens with the full
 *     hardcoded province list (VIETNAMESE_CITIES) — no API call, instant.
 *     Typing filters it locally (diacritic-insensitive). The displayed
 *     name is the Vietnamese city name; the value handed to the form is
 *     that same canonical name, which the backend resolves to the city
 *     slug (`match_city_slugs`) for city-to-city trip search.
 *
 *  2. PRECISE PLACES (smart): the query is ALSO debounced into the
 *     Tantivy place index (/api/places/search) and those hits render in
 *     a second section. Picking one (or picking a point on the map via
 *     the map button) yields exact lat/lon coordinates, which the parent
 *     can feed to the geo trip search (/api/search/geo) to find trips
 *     whose pickup/drop points are CLOSEST to the user's chosen spots.
 *
 * Keyboard navigation (↑/↓/Enter/Esc) walks the combined city+place
 * list as one flat sequence, cities first.
 */

import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { usePlaceSearch } from '@/features/map/api'
import type { PlaceSearchHit } from '@/api'
import { MapPin, Loader2, MapIcon, Building2, Navigation2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { toast } from 'sonner'
import { VIETNAMESE_CITIES } from '@/lib/vietnamese-cities'
import { noTones } from '@/lib/text'

// Leaflet touches `window` at import time, so we must load the MapPicker
// client-side only.
const MapPicker = lazy(() =>
  import('@/features/map/leaflet-map').then((m) => ({ default: m.MapPicker })),
)
const MapPickerFallback = (
  <div className="flex items-center justify-center h-[70vh] text-muted-foreground">
    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
  </div>
)

type PickedPlace = {
  name: string
  lat: number
  lon: number
  type?: string
  province?: string | null
}

type Props = {
  value: string
  onChange: (val: string) => void
  /**
   * Fired on every deliberate value choice — city pick, place pick,
   * map confirm, or free typing — with the current name and (for
   * precise picks) exact coordinates. Parents write BOTH the form and
   * the live store from this single atomic event so the store→form
   * reset guard never sees a half-updated state (name from one pick,
   * coordinates from another).
   */
  onPick?: (pick: {
    name: string
    lat: number | null
    lon: number | null
    /** City-level name for search fallback (the place's province, or the
     *  city itself for city picks) — used when only ONE end is precise. */
    city: string
  }) => void
  placeholder?: string
  icon?: React.ReactNode
  /** Pin color to use on the map picker dialog. */
  pinColor?: 'blue' | 'red'
  className?: string
}

/** One selectable row — either a city or a precise place hit. */
type CityRow = { kind: 'city'; id: string; name: string; region: string }
type PlaceRow = {
  kind: 'place'
  id: string
  name: string
  sub: string
  city: string
  lat: number
  lon: number
}
type Row = CityRow | PlaceRow

const REGION_LABEL_KEYS: Record<string, string> = {
  north: 'searchPage.regionNorth',
  central: 'searchPage.regionCentral',
  south: 'searchPage.regionSouth',
}

export function PlaceAutocomplete({
  value,
  onChange,
  onPick,
  placeholder,
  icon,
  pinColor = 'blue',
  className,
}: Props) {
  const t = useT()
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  // Debounced query — fed into usePlaceSearch so we don't fire a request
  // on every keystroke. The hook itself does caching + deduplication.
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [mapOpen, setMapOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    // Intentional effect-synced state (dialog reset-on-open /
    // server-data snapshot / DOM-availability gate).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(value)
  }, [value])

  const { data: placesData, isLoading: loading } = usePlaceSearch(debouncedQuery, {
    enabled: open && debouncedQuery.trim().length >= 2,
  })
  const placeItems: PlaceSearchHit[] = placesData?.items ?? []

  // NOTE: declared BEFORE the memos below that reference it (a const arrow
  // called from a useMemo factory runs at first render — declaring it later
  // is a temporal-dead-zone ReferenceError that crashes the whole tree).
  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      city: t('searchPage.placeCity'),
      town: t('searchPage.placeTown'),
      village: t('searchPage.placeVillage'),
      bus_station: t('searchPage.placeBusStation'),
      bus_stop: t('searchPage.placeBusStop'),
    }
    return map[type] ?? type.replace(/_/g, ' ')
  }

  // ── City rows: the hardcoded province list, filtered locally ──
  const cityRows: CityRow[] = useMemo(() => {
    const nq = noTones(query)
    const source = nq
      ? VIETNAMESE_CITIES.filter((c) => noTones(c.name).includes(nq))
      : VIETNAMESE_CITIES
    return source.slice(0, nq ? 8 : 12).map((c) => ({
      kind: 'city' as const,
      id: `city-${c.id}`,
      name: c.name,
      region: c.region,
    }))
  }, [query])

  // ── Place rows: precise hits from the Tantivy index ──
  const placeRows: PlaceRow[] = useMemo(
    () =>
      placeItems
        .filter((p) => p.lat != null && p.lon != null)
        .slice(0, 5)
        .map((p) => ({
          kind: 'place' as const,
          id: `place-${p.id ?? `${p.lat},${p.lon}`}`,
          name: p.name,
          sub: [p.province, p.type ? typeLabel(p.type) : null].filter(Boolean).join(' • '),
          city: p.province ?? p.name,
          lat: p.lat as number,
          lon: p.lon as number,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typeLabel is a pure translator closure
    [placeItems, t],
  )

  const rows: Row[] = useMemo(() => [...cityRows, ...placeRows], [cityRows, placeRows])

  // Keep `highlight` within bounds as the row list changes.
  useEffect(() => {
    // Intentional effect-synced state (dialog reset-on-open /
    // server-data snapshot / DOM-availability gate).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlight(0)
  }, [debouncedQuery])

  const onInput = (val: string) => {
    setQuery(val)
    onChange(val)
    // Typing free text invalidates any previously picked coordinates —
    // the value is now just a name string until a row is picked again.
    onPick?.({ name: val, lat: null, lon: null, city: val })
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 180)
  }

  const pick = (row: Row) => {
    setQuery(row.name)
    onChange(row.name)
    if (row.kind === 'city') {
      // City-to-city search — no coordinates needed (the backend
      // resolves the city name to its slug).
      onPick?.({ name: row.name, lat: null, lon: null, city: row.name })
    } else {
      onPick?.({ name: row.name, lat: row.lat, lon: row.lon, city: row.city })
    }
    setOpen(false)
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Clean up the debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleMapConfirm = (place: PickedPlace) => {
    setQuery(place.name)
    onChange(place.name)
    // Map picks are EXACT coordinates — feed the geo search.
    onPick?.({
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      city: place.province ?? place.name,
    })
    setMapOpen(false)
    toast.success(t('searchPage.placeSelected', { name: place.name }))
  }

  const cityCount = cityRows.length
  const hasCitySection = cityCount > 0
  const hasPlaceSection = placeRows.length > 0 || loading

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground flex items-center">
            {icon}
          </span>
        )}
        <Input
          value={query}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => {
            setOpen(true)
            // If the user has already typed something, immediately debounce-
            // flush so the dropdown opens with results.
            if (query.trim().length >= 2) {
              if (debounceRef.current) clearTimeout(debounceRef.current)
              setDebouncedQuery(query)
            }
          }}
          onKeyDown={(e) => {
            if (!open || rows.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => Math.min(h + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const row = rows[highlight]
              if (row) pick(row)
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          className={cn(icon ? 'pl-10' : '', 'bg-white/95 backdrop-blur pr-11')}
        />
        {/* "Pick on map" button — sits inside the input on the right */}
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          title={t('searchPage.pickOnMap')}
          aria-label={t('searchPage.pickOnMap')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <MapIcon className="h-4 w-4" />
        </button>
        {loading && (
          <Loader2 className="absolute right-11 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-blue-600" />
        )}
      </div>

      {open && (hasCitySection || hasPlaceSection) && (
        <div className="absolute z-60 mt-1 w-full rounded-lg border bg-popover overflow-hidden">
          <ul className="max-h-80 overflow-y-auto py-1">
            {hasCitySection && (
              <li className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('searchPage.citySection')}
              </li>
            )}
            {cityRows.map((row, i) => (
              <li key={row.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(row)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                    i === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                >
                  <Building2 className="h-4 w-4 shrink-0 text-blue-600" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{row.name}</div>
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
                    {t(REGION_LABEL_KEYS[row.region] ?? row.region)}
                  </span>
                </button>
              </li>
            ))}

            {hasPlaceSection && (
              <li className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-t mt-1">
                {t('searchPage.placeSection')}
              </li>
            )}
            {loading && placeRows.length === 0 && (
              <li className="px-3 py-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                {t('searchPage.searchingPlaces')}
              </li>
            )}
            {placeRows.map((row, i) => {
              const idx = cityCount + i
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => pick(row)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                      idx === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                    )}
                  >
                    <MapPin className="h-4 w-4 shrink-0 text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{row.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{row.sub}</div>
                    </div>
                    <Navigation2 className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  </button>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <MapIcon className="h-4 w-4" />
            {t('searchPage.pickLocationOnMap')}
          </button>
        </div>
      )}

      {/* Typing indicator while loading with no rows at all */}
      {open && loading && !hasCitySection && placeRows.length === 0 && (
        <div className="absolute z-60 mt-1 w-full rounded-lg border bg-popover overflow-hidden">
          <div className="px-3 py-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span
                className="h-1.5 w-1.5 rounded-full bg-blue-500"
                style={{ animationDelay: '0.18s' }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-blue-500"
                style={{ animationDelay: '0.36s' }}
              />
            </span>
            <span>{t('searchPage.searchingPlaces')}</span>
          </div>
        </div>
      )}

      {/* Map picker dialog */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-3xl max-h-[92dvh] p-0 gap-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-4 py-3 pr-12 border-b bg-white shrink-0">
            <DialogTitle className="text-base flex items-center gap-2">
              <MapPin
                className={cn('h-4 w-4', pinColor === 'red' ? 'text-rose-600' : 'text-blue-600')}
              />
              {t('searchPage.pickLocationOnMap')}
            </DialogTitle>
            {/* Description (also satisfies aria-describedby) */}
            <DialogDescription className="sr-only">
              {t('searchPage.pickLocationOnMapDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <Suspense fallback={MapPickerFallback}>
              <MapPicker
                pinColor={pinColor}
                onConfirm={handleMapConfirm}
                onCancel={() => setMapOpen(false)}
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

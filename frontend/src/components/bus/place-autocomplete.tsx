'use client'

import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import type { Place } from '@/lib/store'
import { usePlaceSearch } from '@/lib/queries'
import { MapPin, Loader2, MapIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// Leaflet touches `window` at import time, so we must load the MapPicker
// client-side only.
const MapPicker = lazy(() => import('./leaflet-map').then((m) => ({ default: m.MapPicker })))
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
  placeholder?: string
  icon?: React.ReactNode
  /** Pin color to use on the map picker dialog. */
  pinColor?: 'blue' | 'red'
  className?: string
}

export function PlaceAutocomplete({ value, onChange, placeholder, icon, pinColor = 'blue', className }: Props) {
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
    setQuery(value)
  }, [value])

  const { data: placesData, isLoading: loading } = usePlaceSearch(debouncedQuery, {
    enabled: open || debouncedQuery.trim().length >= 1,
  })
  const items: Place[] = placesData?.items ?? []

  // Keep `highlight` within bounds as items change.
  useEffect(() => {
    setHighlight(0)
  }, [debouncedQuery])

  const onInput = (val: string) => {
    setQuery(val)
    onChange(val)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 180)
  }

  const pick = (p: Place) => {
    setQuery(p.name)
    onChange(p.name)
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

  const typeLabel = (t: string) => {
    const map: Record<string, string> = {
      city: 'Thành phố',
      town: 'Thị xã',
      village: 'Xã',
      bus_station: 'Bến xe',
      bus_stop: 'Trạm dừng',
    }
    return map[t] ?? t
  }

  const handleMapConfirm = (place: PickedPlace) => {
    setQuery(place.name)
    onChange(place.name)
    setMapOpen(false)
    toast.success(`Đã chọn: ${place.name}`)
  }

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
            if (query.trim().length >= 1) {
              if (debounceRef.current) clearTimeout(debounceRef.current)
              setDebouncedQuery(query)
            }
          }}
          onKeyDown={(e) => {
            if (!open || items.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => Math.min(h + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (items[highlight]) pick(items[highlight])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          className={cn(
            icon ? 'pl-10' : '',
            'bg-white/95 backdrop-blur pr-11',
          )}
        />
        {/* "Pick on map" button — sits inside the input on the right */}
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          title="Chọn trên bản đồ"
          aria-label="Chọn trên bản đồ"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-blue-600 hover:bg-blue-50 transition-colors"
        >
          <MapIcon className="h-4 w-4" />
        </button>
        {loading && (
          <Loader2 className="absolute right-11 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-blue-600" />
        )}
      </div>

      {open && items.length > 0 && (
        <div className="absolute z-60 mt-1 w-full rounded-lg border bg-popover overflow-hidden shadow-xl shadow-slate-900/10">
          <ul className="max-h-72 overflow-y-auto py-1">
            {items.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(p)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                    i === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                >
                  <MapPin className="h-4 w-4 shrink-0 text-blue-600" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {typeLabel(p.type)} {p.province ? `• ${p.province}` : ''}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setMapOpen(true)}
            className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <MapIcon className="h-4 w-4" />
            Chọn vị trí trên bản đồ
          </button>
        </div>
      )}

      {/* Typing indicator while loading */}
      {open && loading && items.length === 0 && (
        <div className="absolute z-60 mt-1 w-full rounded-lg border bg-popover overflow-hidden shadow-xl shadow-slate-900/10">
          <div className="px-3 py-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" style={{ animationDelay: '0.18s' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" style={{ animationDelay: '0.36s' }} />
            </span>
            <span>Đang tìm địa điểm...</span>
          </div>
        </div>
      )}

      {/* Map picker dialog */}
      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b bg-white">
            <DialogTitle className="text-base flex items-center gap-2">
              <MapPin className={cn('h-4 w-4', pinColor === 'red' ? 'text-rose-600' : 'text-blue-600')} />
              Chọn vị trí trên bản đồ
            </DialogTitle>
          </DialogHeader>
          <Suspense fallback={MapPickerFallback}>
            <MapPicker
              pinColor={pinColor}
              onConfirm={handleMapConfirm}
              onCancel={() => setMapOpen(false)}
            />
          </Suspense>
        </DialogContent>
      </Dialog>
    </div>
  )
}

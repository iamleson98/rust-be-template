'use client'

/**
 * AddressMapDialog — create a brand-owned address from a map.
 *
 * The modal the schedule form opens when the wanted point does not exist
 * yet ("Tạo địa điểm mới"):
 *   - full-text search (Tantivy/OSM, diacritic-insensitive) — picking a
 *     result drops the marker, fills lat/lon + name + hierarchy fields
 *     and flies the map there;
 *   - clicking the map reverse-geocodes the exact clicked coordinates
 *     (the marker never jumps — lat/lon stay the user's click);
 *   - the form (name / address / province / district / ward / lat / lon)
 *     is pre-filled but fully editable;
 *   - "Tạo địa điểm" POSTs to `/api/admin/addresses` with the parent
 *     brand id, then `onCreated` hands the new address back so the
 *     caller can immediately select it for the schedule point.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MapPin, Loader2, Plus, Search, X, Crosshair, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useCreateAdminAddress, usePlaceSearch } from '@/lib/queries'
import { reverseGeocode } from '@/features/map/leaflet-map'
import type { AdminAddressOut, PlaceSearchHit } from '@/lib/api/types.gen'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { reverseOptions } from '@/lib/api/@tanstack/react-query.gen'
import { LatLongRegex, parseLatLong } from '@/lib/slug'

// Leaflet touches `window` at import time — load the map client-side only.
const LeafletMap = lazy(() =>
  import('@/features/map/leaflet-map').then((m) => ({ default: m.LeafletMap })),
)

const MapFallback = (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
  </div>
)

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The brand the new address will belong to (each address belongs to exactly 1 brand). */
  brandId?: string
  brandName?: string
  /** Fired after a successful save — the point select should adopt this address. */
  onCreated: (address: AdminAddressOut) => void
}

type FormState = {
  name: string
  address: string
  province: string
  district: string
  ward: string
  lat: number | null
  lon: number | null
}

const EMPTY_FORM: FormState = {
  name: '',
  address: '',
  province: '',
  district: '',
  ward: '',
  lat: null,
  lon: null,
}

export function AddressMapDialog({ open, onOpenChange, brandId, brandName, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [picked, setPicked] = useState<{ name: string; lat: number; lon: number } | null>(null)
  const [reverseLoading, setReverseLoading] = useState(false)
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null)

  // Debounced full-text search (Tantivy) for the overlay box.
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const searchBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const result = parseLatLong(debounced);
    if (result.ok) {
      setReverseLoading(true)

      reverseGeocode(result.value![0], result.value![1])
        .then(({ name, lat, lon, province, district }) => {
          setPicked({ name, lat, lon })
          setForm((f) => ({
            ...f,
            name: f.name.trim() ? f.name : name,
            province: f.province.trim() ? f.province : (province ?? ''),
            district: f.district.trim() ? f.district : (district ?? ''),
            lat,
            lon,
          }))
        }).finally(() => setReverseLoading(false));
    }

    // return null;
  }, [debounced]);

  const { data: searchData, isLoading: searchLoading } = usePlaceSearch(debounced, {
    enabled: open && debounced.trim().length >= 2 && !LatLongRegex.test(debounced),
  })
  const hits: PlaceSearchHit[] = searchData?.items ?? []


  const createMutation = useCreateAdminAddress()

  // Reset every time the dialog opens.
  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM)
      setPicked(null)
      setFlyTarget(null)
      setQuery('')
      setDebounced('')
      setSearchOpen(false)
    }
  }, [open])

  // Close the search dropdown on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  /** Map click → exact lat/lon + reverse-geocoded display name (never moves the pin). */
  const handleMapClick = useCallback(async (lat: number, lon: number) => {
    setForm((f) => ({ ...f, lat, lon }))
    setPicked({ name: 'Đang tra cứu địa điểm…', lat, lon })
    setReverseLoading(true)
    const place = await reverseGeocode(lat, lon)
    setReverseLoading(false)
    setPicked({ name: place.name, lat, lon })
    setForm((f) => ({
      ...f,
      // Pre-fill name/hierarchy only when still empty — never clobber
      // what the user already typed.
      name: f.name.trim() ? f.name : place.name,
      province: f.province.trim() ? f.province : (place.province ?? ''),
    }))
  }, [])

  /** Search result click → drop the marker on the result + prefill the form. */
  const handleSearchSelect = useCallback((hit: PlaceSearchHit) => {
    if (hit.lat == null || hit.lon == null) return
    const lat = hit.lat
    const lon = hit.lon
    setForm((f) => ({
      ...f,
      lat,
      lon,
      name: f.name.trim() ? f.name : hit.name,
      province: f.province.trim() ? f.province : (hit.province ?? ''),
      district: f.district.trim() ? f.district : (hit.district ?? ''),
      ward: f.ward.trim() ? f.ward : (hit.ward ?? ''),
    }))
    setPicked({ name: hit.name, lat, lon })
    setFlyTarget([lat, lon])
    setSearchOpen(false)
    setQuery(hit.name ?? '')
  }, [])

  /** GPS "my location". */
  const handleMyLocation = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setFlyTarget([latitude, longitude])
        void handleMapClick(latitude, longitude)
      },
      () => { },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [handleMapClick])

  const onInput = (v: string) => {
    setQuery(v)
    setSearchOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebounced(v), 300)
  }

  const handleSave = async () => {
    if (!brandId) {
      toast.error('Chưa chọn hãng xe cho địa điểm')
      return
    }
    if (!form.name.trim()) {
      toast.error('Vui lòng nhập tên địa điểm')
      return
    }
    if (form.lat == null || form.lon == null) {
      toast.error('Vui lòng chọn vị trí trên bản đồ hoặc từ kết quả tìm kiếm')
      return
    }
    try {
      // SDK mutation hooks require { body: <payload> } — see the 415 note
      // in queries/index.ts.
      const res: any = await createMutation.mutateAsync({
        body: {
          brandId,
          name: form.name.trim(),
          address: form.address.trim() || undefined,
          lat: form.lat,
          lon: form.lon,
          province: form.province.trim() || undefined,
          district: form.district.trim() || undefined,
          ward: form.ward.trim() || undefined,
        },
      } as any)
      const newId: string | undefined = res?.id ?? (res?.data as any)?.id
      if (!newId) throw new Error('missing id in response')
      toast.success('Đã tạo địa điểm mới', { description: form.name.trim() })
      onCreated({
        id: newId,
        brandId,
        name: form.name.trim(),
        address: form.address.trim() || null,
        lat: form.lat,
        lon: form.lon,
        province: form.province.trim() || null,
        district: form.district.trim() || null,
        ward: form.ward.trim() || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      onOpenChange(false)
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể tạo địa điểm', {
        description: 'Vui lòng thử lại',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !createMutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b bg-white">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-blue-600" />
            Tạo địa điểm mới
            {brandName ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                · {brandName}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Tìm kiếm địa điểm, hoặc chạm vào bản đồ để chọn toạ độ chính xác.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr]">
          {/* ── Form ──────────────────────────────────────────── */}
          <div className="p-5 space-y-4 md:border-r">
            <div className="grid gap-1.5">
              <Label htmlFor="addr-name">
                Tên địa điểm <span className="text-destructive">*</span>
              </Label>
              <Input
                id="addr-name"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="VD: Bến xe Miền Đông"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="addr-detail">Địa chỉ chi tiết</Label>
              <Input
                id="addr-detail"
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                placeholder="Số nhà, đường…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="addr-province">Tỉnh / Thành phố</Label>
                <Input
                  id="addr-province"
                  value={form.province}
                  onChange={(e) => update('province', e.target.value)}
                  placeholder="Hà Nội"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="addr-district">Quận / Huyện</Label>
                <Input
                  id="addr-district"
                  value={form.district}
                  onChange={(e) => update('district', e.target.value)}
                  placeholder="Nam Từ Liêm"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="addr-ward">Phường / Xã</Label>
              <Input
                id="addr-ward"
                value={form.ward}
                onChange={(e) => update('ward', e.target.value)}
                placeholder="Mỹ Đình 1"
              />
            </div>

            {/* Coordinates — filled by the map / search; read-only UI. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Vĩ độ (lat)</Label>
                <Input
                  readOnly
                  tabIndex={-1}
                  value={form.lat != null ? form.lat.toFixed(6) : ''}
                  placeholder="Tự động từ bản đồ"
                  className="font-mono text-xs bg-muted/40"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Kinh độ (lon)</Label>
                <Input
                  readOnly
                  tabIndex={-1}
                  value={form.lon != null ? form.lon.toFixed(6) : ''}
                  placeholder="Tự động từ bản đồ"
                  className="font-mono text-xs bg-muted/40"
                />
              </div>
            </div>
          </div>

          {/* ── Map + search overlay ──────────────────────────── */}
          <div className="relative h-105 md:h-auto md:min-h-120 bg-slate-100">
            <Suspense fallback={MapFallback}>
              <LeafletMap
                className="h-full w-full"
                initialZoom={6}
                marker={picked ? { lat: picked.lat, lon: picked.lon } : null}
                onMapClick={handleMapClick}
                flyTarget={flyTarget}
                flyZoom={13}
              />
            </Suspense>

            {/* Full-text search overlay */}
            <div ref={searchBoxRef} className="absolute left-3 top-3 z-1000 w-[min(20rem,calc(100%-1.5rem))]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => onInput(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Tìm thành phố, bến xe, địa danh…"
                  className="w-full h-10 pl-10 pr-9 rounded-lg border border-slate-200 bg-white/95 backdrop-blur text-sm outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400"
                />
                {searchLoading ? (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-blue-600" />
                ) : query ? (
                  <button
                    type="button"
                    aria-label="Xoá tìm kiếm"
                    onClick={() => {
                      setQuery('')
                      setDebounced('')
                      setSearchOpen(false)
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {searchOpen && debounced.trim().length >= 2 && (
                <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {hits.length === 0 && !searchLoading ? (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground">
                      Không tìm thấy địa điểm phù hợp
                    </div>
                  ) : (
                    <ul>
                      {hits.map((h, i) => (
                        <li key={h.id ?? h.osmId ?? i}>
                          <button
                            type="button"
                            onClick={() => handleSearchSelect(h)}
                            className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-blue-50 transition-colors"
                          >
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                            <span className="line-clamp-2 text-foreground">
                              {h.name}
                              {h.province ? (
                                <span className="text-muted-foreground">, {h.province}</span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* GPS button */}
            <button
              type="button"
              onClick={handleMyLocation}
              className="absolute right-3 top-3 z-1000 h-10 w-10 rounded-lg bg-white/95 backdrop-blur ring-1 ring-slate-200 flex items-center justify-center text-blue-600 hover:bg-blue-50 transition-colors"
              title="Vị trí của tôi"
              aria-label="Vị trí của tôi"
            >
              <Crosshair className="h-5 w-5" />
            </button>

            {/* Hint pill before the first pick */}
            {!picked && (
              <div className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 z-1000 rounded-full bg-slate-900/80 backdrop-blur px-4 py-2 text-xs font-medium text-white">
                <MapPin className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
                Chạm vào bản đồ để chọn vị trí
              </div>
            )}

            {/* Picked-location pill (bottom-left) */}
            {picked && (
              <div className="absolute bottom-14 left-3 z-1000 max-w-[min(22rem,calc(100%-1.5rem))] rounded-lg bg-white/95 backdrop-blur border border-slate-200 px-3 py-2 flex items-center gap-2">
                {reverseLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600 shrink-0" />
                ) : (
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate text-foreground">
                    {picked.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {picked.lat.toFixed(4)}, {picked.lon.toFixed(4)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-5 py-4 border-t bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Huỷ
          </Button>
          <Button
            onClick={handleSave}
            disabled={createMutation.isPending || !form.name.trim() || form.lat == null || form.lon == null || !brandId}
            className={cn('bg-blue-600 hover:bg-blue-700')}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang lưu...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1.5" /> Tạo địa điểm
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

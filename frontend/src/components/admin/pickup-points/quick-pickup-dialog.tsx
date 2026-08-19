'use client'

/**
 * QuickPickupPointDialog — inline creation of a pickup point directly
 * from the route form.
 *
 * Renders a dialog with:
 *   - Name field
 *   - Stop order field (optional)
 *   - Lat/Lng fields (auto-filled from map click)
 *   - Address field (auto-filled from reverse geocode)
 *   - Kind select (boarding / dropping)
 *   - An embedded LeafletMap with click-to-select + search
 *
 * On save, creates the pickup point via the admin API, then calls
 * onCreated(point) so the parent can auto-select it in the dropdown.
 */

import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, MapPin, Loader2, Search, Crosshair } from 'lucide-react'
import { toast } from 'sonner'
import { LeafletMap, type PickedPlace } from '@/components/map/leaflet-map'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  routeId?: string
  onCreated: (point: { id: string; name: string; lat?: number; lon?: number }) => void
}

export function QuickPickupPointDialog({ open, onOpenChange, routeId, onCreated }: Props) {
  const [name, setName] = useState('')
  const [stopOrder, setStopOrder] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)
  const [address, setAddress] = useState('')
  const [kind, setKind] = useState('boarding')
  const [saving, setSaving] = useState(false)
  const [picked, setPicked] = useState<PickedPlace | null>(null)
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null)

  const handleMapClick = useCallback(async (clickLat: number, clickLon: number) => {
    setLat(clickLat)
    setLon(clickLon)
    setPicked({ name: 'Đang tải...', lat: clickLat, lon: clickLon })
    try {
      const res = await fetch(
        `/api/places/reverse?lat=${clickLat}&lon=${clickLon}&limit=1`,
        { credentials: 'include' },
      )
      if (res.ok) {
        const data = await res.json()
        const hit = data?.items?.[0]
        if (hit) {
          const placeName = hit.name || `${clickLat.toFixed(3)}, ${clickLon.toFixed(3)}`
          setName(placeName)
          setAddress(hit.name ? `${hit.name}, ${hit.province ?? ''}`.trim() : '')
          setPicked({ name: placeName, lat: clickLat, lon: clickLon, province: hit.province })
        } else {
          setName(`${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}`)
          setPicked({ name: 'Vị trí đã chọn', lat: clickLat, lon: clickLon })
        }
      }
    } catch {
      setName(`${clickLat.toFixed(4)}, ${clickLon.toFixed(4)}`)
      setPicked({ name: 'Vị trí đã chọn', lat: clickLat, lon: clickLon })
    }
  }, [])

  const handleMyLocation = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setLat(latitude)
        setLon(longitude)
        setFlyTarget([latitude, longitude])
        handleMapClick(latitude, longitude)
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [handleMapClick])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Vui lòng nhập tên điểm đón/trả')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        kind,
        lat: lat,
        lon: lon,
        address: address.trim() || undefined,
        stopOrder: stopOrder ? parseInt(stopOrder, 10) : undefined,
      }
      // Use the admin create pickup point endpoint
      const res = await fetch('/api/admin/pickup-points', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${res.status}`)
      }
      const created = await res.json()
      toast.success('Đã tạo điểm đón/trả mới')
      onCreated({
        id: created.id || created.item?.id,
        name: name.trim(),
        lat: lat ?? undefined,
        lon: lon ?? undefined,
      })
      // Reset form
      setName('')
      setStopOrder('')
      setLat(null)
      setLon(null)
      setAddress('')
      setKind('boarding')
      setPicked(null)
      onOpenChange(false)
    } catch (e: any) {
      toast.error('Không thể tạo điểm', { description: e?.message })
    } finally {
      setSaving(false)
    }
  }

  const handleSearchSelect = useCallback((hit: any) => {
    setName(hit.name)
    setLat(hit.lat)
    setLon(hit.lon)
    setAddress(hit.name + (hit.province ? `, ${hit.province}` : ''))
    setPicked({ name: hit.name, lat: hit.lat, lon: hit.lon, province: hit.province })
    setFlyTarget([hit.lat, hit.lon])
  }, [])

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" /> Tạo điểm đón/trả mới
          </DialogTitle>
          <DialogDescription>
            Nhập thông tin hoặc nhấn vào bản đồ để chọn vị trí chính xác.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Name + Kind */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tên điểm <span className="text-destructive">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Bến xe Mỹ Đình"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Loại điểm</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="boarding">Điểm đón</SelectItem>
                  <SelectItem value="dropping">Điểm trả</SelectItem>
                  <SelectItem value="both">Cả hai</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Lat/Lng + Address */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Vĩ độ</Label>
              <Input
                value={lat ? lat.toFixed(6) : ''}
                readOnly
                placeholder="Tự động từ bản đồ"
                className="mt-1 bg-muted/30 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Kinh độ</Label>
              <Input
                value={lon ? lon.toFixed(6) : ''}
                readOnly
                placeholder="Tự động từ bản đồ"
                className="mt-1 bg-muted/30 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Thứ tự dừng</Label>
              <Input
                type="number"
                value={stopOrder}
                onChange={(e) => setStopOrder(e.target.value)}
                placeholder="VD: 1, 2, 3..."
                className="mt-1"
              />
            </div>
          </div>

          {/* Map */}
          <div className="relative h-64 rounded-lg border overflow-hidden bg-slate-100">
            <LeafletMap
              className="h-full w-full"
              initialZoom={6}
              marker={picked ? { lat: picked.lat, lon: picked.lon, color: 'blue' } : null}
              onMapClick={handleMapClick}
              flyTarget={flyTarget}
              flyZoom={13}
            />
            {/* My location button */}
            <button
              onClick={handleMyLocation}
              className="absolute right-3 top-3 z-1000 h-9 w-9 rounded-lg bg-white/95 backdrop-blur shadow-md ring-1 ring-slate-200 flex items-center justify-center text-primary hover:bg-primary/5 transition-colors"
              title="Vị trí của tôi"
              aria-label="Vị trí của tôi"
            >
              <Crosshair className="h-4 w-4" />
            </button>
            {/* Hint */}
            {!picked && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 rounded-full bg-slate-900/80 backdrop-blur px-4 py-2 text-xs font-medium text-white shadow-lg">
                <MapPin className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
                Chạm vào bản đồ để chọn vị trí
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Tạo điểm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

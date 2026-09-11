'use client'

// Extracted from the original 'map-view.tsx'.

import { Input } from '@/components/ui/input'
import { MapPin, Search, X, Crosshair } from 'lucide-react'
import type { Place } from './map-view-types'

// ── Sidebar (brand filter + search) ───────────────────────
export function MapSidebar({
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

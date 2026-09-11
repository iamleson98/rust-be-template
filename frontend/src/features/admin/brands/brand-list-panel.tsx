'use client'

/**
 * Brands list panel of the AdminBrandManagement master-detail layout.
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
import { BrandListSkeleton } from '@/features/admin/brands/brand-list-skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Search,
  Star,
} from 'lucide-react'
import type { AdminBrandOut } from '@/lib/api/types.gen'

export function BrandListPanel({
  brandsLoading,
  filteredBrands,
  brandSearch,
  setBrandSearch,
  selectedBrand,
  onSelectBrand,
  onAdd,
  onEdit,
  onDelete,
  mobileView,
}: {
  brandsLoading: boolean
  filteredBrands: AdminBrandOut[]
  brandSearch: string
  setBrandSearch: (v: string) => void
  selectedBrand: AdminBrandOut | null
  onSelectBrand: (b: AdminBrandOut) => void
  onAdd: () => void
  onEdit: (b: AdminBrandOut) => void
  onDelete: (b: AdminBrandOut) => void
  mobileView: 'brands' | 'routes' | 'details'
}) {
  return (
    <Card
      className={` overflow-hidden ${mobileView === 'brands' ? 'block' : 'hidden lg:block'}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-rose-600" /> Hãng xe
          </CardTitle>
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1"
            onClick={onAdd}
          >
            <Plus className="h-3.5 w-3.5" /> Thêm
          </Button>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Tìm hãng xe..."
            value={brandSearch}
            onChange={(e) => setBrandSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-140">
          {brandsLoading ? (
            <BrandListSkeleton count={5} />
          ) : filteredBrands.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Chưa có hãng xe nào
            </div>
          ) : (
            <div className="divide-y">
              {filteredBrands.map((b) => (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectBrand(b)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectBrand(b)
                    }
                  }}
                  className={`w-full text-left p-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-rose-200 rounded-sm ${selectedBrand?.id === b.id ? 'bg-rose-50/60 border-l-2 border-l-rose-600' : ''
                    }`}
                >
                  <div
                    className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ background: b.accentColor as any }}
                  >
                    {b.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{b.name}</span>
                      {b.status === 'inactive' && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">Ẩn</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-0.5 text-amber-500">
                        <Star className="h-3 w-3 fill-current" /> {(b.rating ?? 0).toFixed(1)}
                      </span>
                      <span>{b.routeCount} tuyến</span>
                      <span>{b.layoutCount} xe</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(b)
                      }}
                      className="text-slate-400 hover:text-blue-600 p-1 rounded transition-colors"
                      title="Sửa"
                      aria-label={`Sửa hãng ${b.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(b)
                      }}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                      title="Xoá"
                      aria-label={`Xoá hãng ${b.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
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

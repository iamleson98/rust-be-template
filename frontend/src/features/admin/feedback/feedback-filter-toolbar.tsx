'use client'

/**
 * Filter toolbar of the admin feedback panel — status chips (with the
 * active brand's per-status counts), the debounced search input and
 * the "clear brand filter" escape hatch.
 *
 * Extracted from the original 'src/features/admin/feedback/feedback-panel.tsx'.
 */

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import type { AdminReviewBrandSummary } from '@/lib/api/types.gen'

/** Real backend moderation statuses (NOT the legacy `published/flagged`). */
const STATUS_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã hiển thị' },
  { value: 'rejected', label: 'Từ chối' },
  { value: 'hidden', label: 'Đã ẩn' },
] as const

export function FeedbackFilterToolbar({
  status,
  setStatus,
  search,
  setSearch,
  brandId,
  setBrandId,
  activeSummary,
}: {
  status: string
  setStatus: React.Dispatch<React.SetStateAction<string>>
  search: string
  setSearch: React.Dispatch<React.SetStateAction<string>>
  brandId: string | null
  setBrandId: React.Dispatch<React.SetStateAction<string | null>>
  activeSummary: AdminReviewBrandSummary | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setStatus(s.value)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              status === s.value
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
            {s.value !== 'all' && activeSummary && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {(s.value === 'pending' ? activeSummary.pending
                  : s.value === 'approved' ? activeSummary.approved
                  : s.value === 'rejected' ? activeSummary.rejected
                  : activeSummary.hidden)}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="relative min-w-56 flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo khách, nội dung, tiêu đề…"
          className="pl-8 h-9 text-sm"
        />
      </div>
      {brandId && (
        <Button variant="ghost" size="sm" onClick={() => setBrandId(null)} className="text-xs text-rose-600">
          Bỏ lọc hãng
        </Button>
      )}
    </div>
  )
}

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
import { useT } from '@/lib/i18n'
import type { AdminReviewBrandSummary } from '@/api'
import { ButtonGroup } from '@/components/ui/button-group'

/** Real backend moderation statuses (NOT the legacy `published/flagged`). */
const STATUS_FILTERS = [
  { value: 'all', labelKey: 'common.all' },
  { value: 'pending', labelKey: 'adminFeedback.statusPending' },
  { value: 'approved', labelKey: 'adminFeedback.statusApproved' },
  { value: 'rejected', labelKey: 'adminFeedback.statusRejected' },
  { value: 'hidden', labelKey: 'adminFeedback.statusHidden' },
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
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonGroup>
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s.value}
            onClick={() => setStatus(s.value)}
            variant="outline"
            className={`${
              status === s.value
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(s.labelKey)}
            {s.value !== 'all' && activeSummary && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {s.value === 'pending'
                  ? activeSummary.pending
                  : s.value === 'approved'
                    ? activeSummary.approved
                    : s.value === 'rejected'
                      ? activeSummary.rejected
                      : activeSummary.hidden}
              </span>
            )}
          </Button>
        ))}
      </ButtonGroup>
      <div className="relative min-w-56 flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('adminFeedback.searchPlaceholder')}
          className="pl-8 h-9 text-base md:text-sm"
        />
      </div>
      {brandId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setBrandId(null)}
          className="text-xs text-rose-600"
        >
          {t('adminFeedback.clearBrandFilter')}
        </Button>
      )}
    </div>
  )
}

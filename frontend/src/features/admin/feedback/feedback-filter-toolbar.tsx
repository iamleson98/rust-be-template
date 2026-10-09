'use client'

/**
 * Filter toolbar of the admin feedback panel — status tabs (with the
 * active brand's per-status counts), the debounced search input and
 * the "clear brand filter" escape hatch.
 */

import { Search } from 'lucide-react'
import type { AdminReviewBrandSummary } from '@/api'
import { PillTab, PillTabs } from '@/components/console/pill-tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs } from '@/components/ui/tabs'
import { useT } from '@/lib/i18n'

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
    <div className="space-y-3">
      {/* Scrolls sideways on phones instead of pushing the page wider. */}
      <Tabs value={status} onValueChange={(v) => setStatus(String(v))}>
        <PillTabs>
          {STATUS_FILTERS.map((s) => (
            <PillTab
              key={s.value}
              value={s.value}
              label={t(s.labelKey)}
              count={s.value === 'all' ? undefined : activeSummary?.[s.value]}
            />
          ))}
        </PillTabs>
      </Tabs>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('adminFeedback.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        {brandId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setBrandId(null)}
            className="text-rose-600"
          >
            {t('adminFeedback.clearBrandFilter')}
          </Button>
        )}
      </div>
    </div>
  )
}

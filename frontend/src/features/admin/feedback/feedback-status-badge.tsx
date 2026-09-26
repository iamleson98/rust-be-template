'use client'

/**
 * Moderation status badge for the admin feedback table.
 *
 * Extracted from the original 'src/features/admin/feedback/feedback-panel.tsx'.
 */

import { useT } from '@/lib/i18n'

const STATUS_BADGE: Record<string, { labelKey: string; cls: string }> = {
  pending: { labelKey: 'adminFeedback.statusPending', cls: 'bg-amber-500/10 text-amber-600 ring-amber-500/20' },
  approved: { labelKey: 'adminFeedback.badgeApproved', cls: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20' },
  rejected: { labelKey: 'adminFeedback.statusRejected', cls: 'bg-rose-500/10 text-rose-600 ring-rose-500/20' },
  hidden: { labelKey: 'adminFeedback.statusHidden', cls: 'bg-slate-500/10 text-slate-600 ring-slate-500/20' },
}

export function StatusBadge({ status }: { status: string }) {
  const t = useT()
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.pending
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${s.cls}`}>
      {t(s.labelKey)}
    </span>
  )
}

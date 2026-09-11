'use client'

/**
 * Moderation status badge for the admin feedback table.
 *
 * Extracted from the original 'src/features/admin/feedback/feedback-panel.tsx'.
 */

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Chờ duyệt', cls: 'bg-amber-500/10 text-amber-600 ring-amber-500/20' },
  approved: { label: 'Hiển thị', cls: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20' },
  rejected: { label: 'Từ chối', cls: 'bg-rose-500/10 text-rose-600 ring-rose-500/20' },
  hidden: { label: 'Đã ẩn', cls: 'bg-slate-500/10 text-slate-600 ring-slate-500/20' },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.pending
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${s.cls}`}>
      {s.label}
    </span>
  )
}

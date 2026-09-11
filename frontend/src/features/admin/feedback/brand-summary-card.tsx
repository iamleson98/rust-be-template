'use client'

/**
 * Brand summary cards of the admin feedback page — the per-brand
 * volume, status breakdown and average star rating row. Clicking a
 * card scopes the table below to that brand (via `setBrandId`).
 *
 * Extracted from the original 'src/features/admin/feedback/feedback-panel.tsx'.
 */

import { Skeleton } from '@/components/ui/skeleton'
import {
  CheckCircle2,
  Clock,
  EyeOff,
  LayoutGrid,
  Star,
  XCircle,
} from 'lucide-react'
import type { AdminReviewBrandSummary } from '@/lib/api/types.gen'

function BrandSummaryCard({
  summary,
  active,
  onClick,
}: {
  summary: AdminReviewBrandSummary
  active: boolean
  onClick: () => void
}) {
  const accent = summary.brandAccent || '#2563eb'
  const totalNonZero = Math.max(1, summary.pending + summary.approved + summary.rejected + summary.hidden)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-xl border bg-card p-4 min-w-60 flex-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${
        active
          ? 'border-primary/60 ring-2 ring-primary/15'
          : 'border-border/60 hover:border-border'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className="size-10 shrink-0 rounded-lg grid place-items-center text-white font-bold text-sm"
          style={{ background: `linear-gradient(135deg, ${accent}, ${accent}bb)` }}
          aria-hidden
        >
          {(summary.brandName ?? '?').slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">
            {summary.brandName ?? 'Chưa phân loại'}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            <span className="text-xs font-semibold tabular-nums text-amber-600">
              {summary.avgRating?.toFixed(1) ?? '—'}
            </span>
            <span className="text-xs text-muted-foreground">· {summary.total} phản hồi</span>
          </div>
        </div>
      </div>

      {/* Status breakdown chips + stacked mini-bar */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {summary.pending > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
            <Clock className="size-2.5" /> {summary.pending} chờ
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
          <CheckCircle2 className="size-2.5" /> {summary.approved}
        </span>
        {summary.rejected > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
            <XCircle className="size-2.5" /> {summary.rejected}
          </span>
        )}
        {summary.hidden > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            <EyeOff className="size-2.5" /> {summary.hidden}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="bg-emerald-500" style={{ width: `${(summary.approved / totalNonZero) * 100}%` }} />
        <div className="bg-amber-400" style={{ width: `${(summary.pending / totalNonZero) * 100}%` }} />
        <div className="bg-rose-400" style={{ width: `${(summary.rejected / totalNonZero) * 100}%` }} />
        <div className="bg-slate-400" style={{ width: `${(summary.hidden / totalNonZero) * 100}%` }} />
      </div>
    </button>
  )
}

function BrandSummarySkeleton() {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 min-w-60 flex-1" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-4 w-14 rounded-full" />
        <Skeleton className="h-4 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-2.5 h-1.5 rounded-full" />
    </div>
  )
}

export function BrandSummaryStrip({
  summaries,
  isLoading,
  brandId,
  setBrandId,
}: {
  summaries: AdminReviewBrandSummary[]
  isLoading: boolean
  brandId: string | null
  setBrandId: React.Dispatch<React.SetStateAction<string | null>>
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <LayoutGrid className="size-3.5" />
        Theo hãng xe
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 scroll-thin -mx-1 px-1">
        {/* "All brands" card */}
        <button
          type="button"
          onClick={() => setBrandId(null)}
          aria-pressed={brandId === null}
          className={`text-left rounded-xl border bg-card p-4 min-w-52 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${
            brandId === null
              ? 'border-primary/60 ring-2 ring-primary/15'
              : 'border-border/60 hover:border-border'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <LayoutGrid className="size-4 text-primary" />
            Tất cả hãng xe
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {summaries.reduce((s, x) => s + x.total, 0)} phản hồi ·{' '}
            {summaries.reduce((s, x) => s + x.pending, 0)} chờ duyệt
          </div>
        </button>

        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <BrandSummarySkeleton key={i} />)
          : summaries.map((s) => (
              <BrandSummaryCard
                key={s.brandId ?? 'none'}
                summary={s}
                active={brandId === s.brandId}
                onClick={() => setBrandId(brandId === s.brandId ? null : (s.brandId ?? null))}
              />
            ))}
      </div>
    </div>
  )
}

'use client'

/**
 * FeedbackPanel — the admin "Phản hồi" page (`/admin/feedback`).
 *
 * Organizes customer feedback BY TRANSPORT BRAND (per the product spec):
 *
 *   1. Brand summary cards (from `GET /api/admin/reviews/summary`) —
 *      per-brand volume, status breakdown + avg star rating. Clicking a
 *      card scopes the table below to that brand.
 *   2. A server-side paginated DataTable (`GET /api/admin/reviews?…`
 *      with `total`) — columns: customer, rating, content preview,
 *      status, date. Status chips + debounced search mirror the other
 *      admin tables.
 *   3. Row click → moderation dialog: full content, brand reply editor,
 *      status actions (approve / reject / hide).
 */

import { useMemo, useState, useCallback } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Clock,
  EyeOff,
  LayoutGrid,
  MessageSquareHeart,
  RefreshCw,
  Search,
  Send,
  Star,
  XCircle,
} from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useAdminReviews, useAdminReviewBrandSummary, useModerateAdminReview } from '@/lib/queries'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { StarRating } from '@/components/feedback/star-rating'
import type { ReviewOut, AdminReviewBrandSummary } from '@/lib/api/types.gen'

/* ── Constants ─────────────────────────────────────────────────── */

const PAGE_SIZE = 20

/** Real backend moderation statuses (NOT the legacy `published/flagged`). */
const STATUS_FILTERS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã hiển thị' },
  { value: 'rejected', label: 'Từ chối' },
  { value: 'hidden', label: 'Đã ẩn' },
] as const

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Chờ duyệt', cls: 'bg-amber-500/10 text-amber-600 ring-amber-500/20' },
  approved: { label: 'Hiển thị', cls: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20' },
  rejected: { label: 'Từ chối', cls: 'bg-rose-500/10 text-rose-600 ring-rose-500/20' },
  hidden: { label: 'Đã ẩn', cls: 'bg-slate-500/10 text-slate-600 ring-slate-500/20' },
}

/* ── Column model ──────────────────────────────────────────────── */

type FeedbackRow = ReviewOut

const feedbackColumnHelper = createColumnHelper<DataTableFeatures, FeedbackRow>()

function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    const d = parseISO(s)
    if (!isValid(d)) return s
    return format(d, 'dd/MM/yyyy HH:mm', { locale: vi })
  } catch {
    return s ?? '—'
  }
}

/* ── Brand summary card ────────────────────────────────────────── */

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
          ? 'border-primary/60 ring-2 ring-primary/15 shadow-md'
          : 'border-border/60 hover:border-border hover:shadow-sm'
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

/* ── Main panel ────────────────────────────────────────────────── */

export function FeedbackPanel() {
  const [brandId, setBrandId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<FeedbackRow | null>(null)
  const [replyText, setReplyText] = useState('')
  const [updating, setUpdating] = useState(false)

  const debouncedSearch = useDebouncedValue(search, 400)

  // Reset paging whenever the filters change (a new result set).
  const filterKey = `${brandId ?? 'all'}|${status}|${debouncedSearch}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(0)
  }

  const summaryQuery = useAdminReviewBrandSummary()
  const listQuery = useAdminReviews({
    brandId: brandId ?? undefined,
    status: status === 'all' ? undefined : status,
    search: debouncedSearch.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const moderateMut = useModerateAdminReview()

  const rows: FeedbackRow[] = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const summaries = summaryQuery.data?.items ?? []

  const columns = useMemo(
    () =>
      feedbackColumnHelper.columns([
        feedbackColumnHelper.accessor('authorName', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Khách hàng" />,
          cell: ({ row }) => {
            const name = row.original.authorName || 'Ẩn danh'
            const phone = row.original.authorPhone
            return (
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-[11px] font-bold">
                    {name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{name}</div>
                  {phone && (
                    <div className="truncate text-[11px] text-muted-foreground">{phone}</div>
                  )}
                </div>
              </div>
            )
          },
          meta: { label: 'Khách hàng' },
        }),
        feedbackColumnHelper.accessor('rating', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Đánh giá" />,
          cell: ({ getValue }) => <StarRating value={getValue() as number} size="sm" />,
          meta: { label: 'Đánh giá' },
        }),
        feedbackColumnHelper.accessor('title', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Nội dung" />,
          cell: ({ row }) => {
            const r = row.original
            return (
              <div className="max-w-80 space-y-1">
                {r.title && <div className="text-sm font-medium truncate">{r.title}</div>}
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {r.content || '—'}
                </p>
                {(r.tags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(r.tags ?? []).slice(0, 3).map((t) => (
                      <Badge key={t} variant="secondary" className="text-[9px] font-normal px-1.5">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )
          },
          meta: { label: 'Nội dung' },
        }),
        feedbackColumnHelper.accessor('status', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Trạng thái" />,
          cell: ({ getValue }) => {
            const s = STATUS_BADGE[getValue() as string] ?? STATUS_BADGE.pending
            return (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${s.cls}`}>
                {s.label}
              </span>
            )
          },
          meta: { label: 'Trạng thái' },
        }),
        feedbackColumnHelper.accessor('createdAt', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Thời gian" />,
          cell: ({ getValue }) => (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDate(getValue() as string)}
            </span>
          ),
          meta: { label: 'Thời gian' },
        }),
      ]),
    [],
  )

  /* ── Moderation actions (from the detail dialog) ── */
  const moderate = useCallback(
    async (
      id: string,
      body: { status?: string; brandReply?: string | null },
      successMsg: string,
    ) => {
      setUpdating(true)
      try {
        await moderateMut.mutateAsync({ path: { id }, body: { status: body.status, brandReply: body.brandReply } } as any)
        toast.success(successMsg)
        return true
      } catch (e: any) {
        toast.error(e?.message ?? 'Cập nhật thất bại')
        return false
      } finally {
        setUpdating(false)
      }
    },
    [moderateMut],
  )

  const openDetail = (row: FeedbackRow) => {
    setSelected(row)
    setReplyText(row.reply ?? '')
  }

  const closeDetail = () => {
    setSelected(null)
    setReplyText('')
  }

  const activeSummary = summaries.find((s) => s.brandId === brandId) ?? null

  return (
    <div className="p-3 md:p-6 space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquareHeart className="size-5 text-primary" />
            Phản hồi khách hàng
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Phản hồi của hành khách theo từng hãng xe — kiểm duyệt, trả lời và theo dõi chất lượng dịch vụ.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void summaryQuery.refetch()
            void listQuery.refetch()
          }}
          className="gap-1.5"
        >
          <RefreshCw className="size-3.5" /> Làm mới
        </Button>
      </div>

      {/* ── Brand summary cards ── */}
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
                ? 'border-primary/60 ring-2 ring-primary/15 shadow-md'
                : 'border-border/60 hover:border-border hover:shadow-sm'
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

          {summaryQuery.isLoading
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

      {/* ── Toolbar: status chips + search ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatus(s.value)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                status === s.value
                  ? 'bg-background text-foreground shadow-sm'
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

      {/* ── Feedback table ── */}
      <DataTable
        columns={columns}
        data={rows}
        rowNoun="phản hồi"
        manualPagination
        totalRowCount={total}
        pageIndex={page}
        onPageIndexChange={setPage}
        pageSize={PAGE_SIZE}
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        onRowClick={openDetail}
        rowAriaLabel={(r) => `Phản hồi của ${r.authorName ?? 'khách ẩn danh'}`}
        emptyTitle="Chưa có phản hồi nào"
        emptyDescription={
          brandId || status !== 'all' || debouncedSearch
            ? 'Thử bỏ bớt bộ lọc để xem thêm phản hồi.'
            : 'Phản hồi của khách hàng sẽ xuất hiện ở đây khi họ đánh giá chuyến đi.'
        }
        emptyIcon={<MessageSquareHeart className="size-5" aria-hidden />}
      />

      {/* ── Moderation detail dialog ── */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && closeDetail()}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 pr-6">
                  <Avatar className="size-9">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                      {(selected.authorName || '?').slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-base">{selected.authorName || 'Khách ẩn danh'}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {formatDate(selected.createdAt)}
                    </div>
                  </div>
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Chi tiết phản hồi và kiểm duyệt
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <StarRating value={selected.rating} size="lg" />

                {selected.title && (
                  <div className="font-semibold text-sm">{selected.title}</div>
                )}
                {selected.content && (
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {selected.content}
                  </p>
                )}
                {(selected.tags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(selected.tags ?? []).map((t) => (
                      <Badge key={t} variant="secondary" className="text-[11px] font-normal">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Status action row */}
                <div className="flex flex-wrap gap-1.5">
                  {selected.status !== 'approved' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updating}
                      onClick={async () => {
                        if (await moderate(selected.id, { status: 'approved' }, 'Đã duyệt phản hồi')) {
                          setSelected({ ...selected, status: 'approved' })
                        }
                      }}
                      className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    >
                      <CheckCircle2 className="size-3.5" /> Duyệt hiển thị
                    </Button>
                  )}
                  {selected.status !== 'rejected' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updating}
                      onClick={async () => {
                        if (await moderate(selected.id, { status: 'rejected' }, 'Đã từ chối phản hồi')) {
                          setSelected({ ...selected, status: 'rejected' })
                        }
                      }}
                      className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
                    >
                      <XCircle className="size-3.5" /> Từ chối
                    </Button>
                  )}
                  {selected.status !== 'hidden' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updating}
                      onClick={async () => {
                        if (await moderate(selected.id, { status: 'hidden' }, 'Đã ẩn phản hồi')) {
                          setSelected({ ...selected, status: 'hidden' })
                        }
                      }}
                      className="gap-1.5"
                    >
                      <EyeOff className="size-3.5" /> Ẩn
                    </Button>
                  )}
                </div>

                {/* Brand reply editor */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">
                    Phản hồi của hãng xe (hiển thị kèm đánh giá)
                  </div>
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Cảm ơn bạn đã phản hồi…"
                    rows={3}
                    className="bg-background text-sm resize-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      disabled={updating || !replyText.trim()}
                      onClick={async () => {
                        if (await moderate(selected.id, { brandReply: replyText.trim() }, 'Đã gửi phản hồi')) {
                          setSelected({ ...selected, reply: replyText.trim() })
                        }
                      }}
                      className="gap-1.5"
                    >
                      <Send className="size-3.5" /> Gửi phản hồi
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

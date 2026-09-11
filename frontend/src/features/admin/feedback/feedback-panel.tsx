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
 *
 * The brand summary strip, filter toolbar, column model and moderation
 * dialog live in sibling files in this folder; this file is the
 * orchestrator (state + data wiring + layout).
 */

import { useState, useCallback } from 'react'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { MessageSquareHeart, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminReviewBrandSummary, useAdminReviews, useModerateAdminReview } from '@/lib/queries'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { BrandSummaryStrip } from './brand-summary-card'
import { useFeedbackColumns } from './feedback-columns'
import { FeedbackDetailDialog } from './feedback-detail-dialog'
import { FeedbackFilterToolbar } from './feedback-filter-toolbar'
import type { FeedbackRow } from './helpers'

/* ── Constants ─────────────────────────────────────────────────── */

const PAGE_SIZE = 20

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

  const columns = useFeedbackColumns()

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
      <BrandSummaryStrip
        summaries={summaries}
        isLoading={summaryQuery.isLoading}
        brandId={brandId}
        setBrandId={setBrandId}
      />

      {/* ── Toolbar: status chips + search ── */}
      <FeedbackFilterToolbar
        status={status}
        setStatus={setStatus}
        search={search}
        setSearch={setSearch}
        brandId={brandId}
        setBrandId={setBrandId}
        activeSummary={activeSummary}
      />

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
      <FeedbackDetailDialog
        selected={selected}
        setSelected={setSelected}
        replyText={replyText}
        setReplyText={setReplyText}
        updating={updating}
        moderate={moderate}
        onClose={closeDetail}
      />
    </div>
  )
}

'use client'

/**
 * ReviewsModerationPanel — admin tab for moderating customer reviews.
 *
 * Migrated from manual `useEffect + fetch + useState` to TanStack Query:
 *   - List/stats/brands fetched via `useAdminReviews({ status, brandId, search })`.
 *     The hook accepts filter params and uses them as part of the query key
 *     so each filter combination is cached independently.
 *   - Status updates + brand replies sent via `useModerateAdminReview()`.
 *     The mutation invalidates `['admin', 'reviews']`, which triggers a
 *     refetch of the filtered list + stats in a single request — replacing
 *     the original two-step PATCH + separate stats refetch.
 *   - Loading + error states rendered inline (Vietnamese strings + retry button).
 */

import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Star,
  Clock,
  CheckCircle2,
  EyeOff,
  Flag,
  Search,
  Filter,
  Reply,
  Send,
  MessageSquare,
  Bus,
  ThumbsUp,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { relativeTime } from '@/lib/types'
import { useAdminReviews, useModerateAdminReview, useAdminBrands } from '@/lib/queries'
import {
  Form,
  FormField,
  FormItem,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import type { AdminReview, AdminReviewStats } from '@/components/admin/dashboard/types'
import {
  REVIEW_TAG_LABELS,
  ReviewStatusBadge,
  StarsRow,
} from '@/components/admin/dashboard/badges'

// const EMPTY_STATS: AdminReviewStats = {
//   total: 0,
//   pending: 0,
//   published: 0,
//   hidden: 0,
//   flagged: 0,
//   avgRating: 0,
//   responseRate: 0,
// }

export function ReviewsModerationPanel() {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'published' | 'hidden' | 'flagged'>('all')
  const [filterBrand, setFilterBrand] = useState<string>('all')
  const [search, setSearch] = useState('')
  const searchSchema = z.object({
    query: z.string().trim().max(120, 'Tối đa 120 ký tự').optional().or(z.literal('')),
  })
  const searchForm = useForm<z.input<typeof searchSchema>, unknown, z.output<typeof searchSchema>>({
    resolver: zodResolver(searchSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { query: '' },
  })
  const [replyingId, setReplyingId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [savingReplyId, setSavingReplyId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Filtered reviews list — refetches automatically when filters change
  // (status/brandId/search are part of the query key).
  const { data, isLoading, isError, error, refetch } = useAdminReviews({
    status: filterStatus === 'all' ? undefined : filterStatus,
    brandId: filterBrand === 'all' ? undefined : filterBrand,
    search: search.trim() || undefined,
  })

  // Brand list — fetched separately so the brand filter dropdown has options.
  // The reviews list response only carries `items` (no `brands` payload).
  const brandsQuery = useAdminBrands()

  const items: AdminReview[] = (data?.items ?? []) as unknown as AdminReview[]
  // `AdminReviewListResponse` only exposes `items` (no `stats` payload), so
  // we derive the KPI stats client-side from the current page of reviews.
  const stats: AdminReviewStats = useMemo(() => {
    const pending = items.filter((r) => r.status === 'pending').length
    const published = items.filter((r) => r.status === 'approved' || r.status === 'published').length
    const hidden = items.filter((r) => r.status === 'hidden' || r.status === 'rejected').length
    const total = items.length
    const avgRating = total > 0
      ? items.reduce((s, r) => s + r.rating, 0) / total
      : 0
    const replied = items.filter((r) => !!r.reply).length
    return {
      total,
      pending,
      published,
      hidden,
      flagged: 0,
      avgRating,
      responseRate: total > 0 ? Math.round((replied / total) * 100) : 0,
    }
  }, [items])
  const brands: { id: string; name: string }[] = (brandsQuery.data?.items ?? []).map((b) => ({
    id: b.id,
    name: b.name,
  }))

  const moderateMutation = useModerateAdminReview()

  // Sync form field whenever the external `search` state changes (e.g. clearFilters).
  // useForm's defaultValues don't auto-sync with external state.
  useEffect(() => {
    searchForm.reset({ query: search })
  }, [search, searchForm])

  const updateReview = async (
    id: string,
    body: { status?: string; brandReply?: string | null },
    successMsg: string,
  ) => {
    setUpdatingId(id)
    try {
      await moderateMutation.mutateAsync({
        path: { id },
        body: { status: body.status, brandReply: body.brandReply },
      })
      toast.success(successMsg)
    } catch (e: any) {
      toast.error(e?.message ?? 'Cập nhật thất bại')
    } finally {
      setUpdatingId(null)
    }
  }

  const submitReply = async (id: string) => {
    if (!replyText.trim()) return
    setSavingReplyId(id)
    await updateReview(id, { brandReply: replyText.trim() }, 'Đã gửi phản hồi hãng xe')
    setSavingReplyId(null)
    setReplyingId(null)
    setReplyText('')
  }

  const startReply = (r: AdminReview) => {
    setReplyingId(r.id)
    setReplyText(r.reply ?? '')
  }

  const cancelReply = () => {
    setReplyingId(null)
    setReplyText('')
  }

  const onSearchSubmit = (values: z.output<typeof searchSchema>) => {
    setSearch(values.query ?? '')
  }

  const clearFilters = () => {
    setFilterStatus('all')
    setFilterBrand('all')
    setSearch('')
  }

  const hasActiveFilters = filterStatus !== 'all' || filterBrand !== 'all' || search.trim() !== ''

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Star className="h-3.5 w-3.5 text-amber-500" />
              Tổng đánh giá
            </div>
            <div className="text-2xl font-extrabold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              Chờ duyệt
            </div>
            <div className="text-2xl font-extrabold text-amber-600">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Star className="h-3.5 w-3.5 text-amber-500" />
              Đánh giá TB
            </div>
            <div className="text-2xl font-extrabold text-amber-600">{stats.avgRating.toFixed(1)}</div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Reply className="h-3.5 w-3.5 text-blue-600" />
              Tỷ lệ phản hồi
            </div>
            <div className="text-2xl font-extrabold text-blue-700">{stats.responseRate}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <Form {...searchForm}>
              <form onSubmit={searchForm.handleSubmit(onSearchSubmit)} className="relative flex-1 min-w-0">
                <FormField
                  control={searchForm.control}
                  name="query"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          <Input
                            {...field}
                            value={field.value ?? ''}
                            placeholder="Tìm theo nội dung, tiêu đề, tên tác giả…"
                            className="pl-8"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status filter */}
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
                {(['all', 'pending', 'published', 'hidden', 'flagged'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${filterStatus === s
                        ? 'bg-white text-blue-700'
                        : 'text-slate-600 hover:text-slate-900'
                      }`}
                  >
                    {s === 'all' ? 'Tất cả' : s === 'pending' ? 'Chờ' : s === 'published' ? 'Đã đăng' : s === 'hidden' ? 'Đã ẩn' : 'Báo cáo'}
                    {s !== 'all' && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {s === 'pending' ? stats.pending : s === 'published' ? stats.published : s === 'hidden' ? stats.hidden : stats.flagged}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Brand filter */}
              <Select value={filterBrand} onValueChange={setFilterBrand}>
                <SelectTrigger className="h-8 w-45 text-xs">
                  <Filter className="h-3 w-3 mr-1 text-muted-foreground" />
                  <SelectValue placeholder="Tất cả hãng xe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả hãng xe</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-rose-600 hover:bg-rose-50">
                  Xoá lọc
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reviews list */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-600" />
            Danh sách đánh giá
            <Badge variant="secondary" className="text-[10px] ml-1">{items.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Đang tải đánh giá…</div>
          ) : isError ? (
            <div className="p-8 text-center">
              <AlertCircle className="h-10 w-10 text-rose-300 mx-auto mb-3" />
              <h3 className="font-semibold text-sm">Không tải được đánh giá</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {(error as Error)?.message ?? 'Đã có lỗi xảy ra. Vui lòng thử lại.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3 h-7 text-xs">
                Thử lại
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <Star className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <h3 className="font-semibold text-sm">Không có đánh giá</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {hasActiveFilters ? 'Thử thay đổi bộ lọc để xem thêm.' : 'Chưa có đánh giá nào trong hệ thống.'}
              </p>
            </div>
          ) : (
            <div className="max-h-160 overflow-y-auto scrollbar-thin divide-y">
              {items.map((r) => {
                const isReplying = replyingId === r.id
                const isUpdating = updatingId === r.id
                return (
                  <div
                    key={r.id}
                    className="p-4 hover:bg-slate-50/60 transition-colors"
                  >
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-bold">
                            {(r.authorName || '?').slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm truncate">{r.authorName || 'Hành khách ẩn danh'}</span>
                            <ReviewStatusBadge status={r.status} />
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                            <span>{relativeTime(r.createdAt)}</span>
                            {r.brand && (
                              <>
                                <span>•</span>
                                <span className="inline-flex items-center gap-0.5">
                                  <Bus className="h-2.5 w-2.5" />
                                  {r.brand.name}
                                </span>
                              </>
                            )}
                            {r.route && (
                              <>
                                <span>•</span>
                                <span className="truncate">{r.route.name}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <StarsRow rating={r.rating} />
                    </div>

                    {/* Content */}
                    {r.title && (
                      <div className="font-medium text-sm mb-1 text-slate-900">{r.title}</div>
                    )}
                    {r.content && (
                      <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">{r.content}</p>
                    )}

                    {/* Tags + helpful */}
                    {(r.tags.length > 0 || r.helpfulCount > 0) && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        {r.tags.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px] bg-blue-50/50 border-blue-200 text-blue-700">
                            {REVIEW_TAG_LABELS[t] ?? t}
                          </Badge>
                        ))}
                        {r.helpfulCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <ThumbsUp className="h-2.5 w-2.5" />
                            {r.helpfulCount} hữu ích
                          </span>
                        )}
                      </div>
                    )}

                    {/* Existing brand reply */}
                    {r.reply && (
                      <div className="mt-3 rounded-lg bg-blue-50/60 border border-blue-200 p-2.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 mb-1">
                          <Reply className="h-3 w-3" />
                          Phản hồi từ {r.brand?.name ?? 'hãng xe'}
                          {r.repliedAt && (
                            <span className="text-muted-foreground font-normal ml-1">· {relativeTime(r.repliedAt)}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-700 leading-relaxed">{r.reply}</p>
                      </div>
                    )}

                    {/* Inline reply box */}
                    {isReplying && (
                      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700">
                          <Reply className="h-3 w-3" />
                          Phản hồi với tư cách {r.brand?.name ?? 'hãng xe'}
                        </div>
                        <Textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Nhập phản hồi cho khách hàng…"
                          rows={3}
                          className="bg-white text-sm resize-none"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={cancelReply} className="text-xs">
                            Huỷ
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => submitReply(r.id)}
                            disabled={!replyText.trim() || savingReplyId === r.id}
                            className="text-xs bg-blue-600 hover:bg-blue-700 gap-1"
                          >
                            {savingReplyId === r.id ? (
                              <>
                                <Clock className="h-3 w-3 animate-spin" /> Đang gửi…
                              </>
                            ) : (
                              <>
                                <Send className="h-3 w-3" /> Gửi phản hồi
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Action bar */}
                    {!isReplying && (
                      <div className="flex items-center flex-wrap gap-1.5 mt-3">
                        {r.status !== 'published' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateReview(r.id, { status: 'published' }, 'Đã duyệt đánh giá')}
                            disabled={isUpdating}
                            className="text-[11px] h-7 gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Duyệt đăng
                          </Button>
                        )}
                        {r.status !== 'hidden' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateReview(r.id, { status: 'hidden' }, 'Đã ẩn đánh giá')}
                            disabled={isUpdating}
                            className="text-[11px] h-7 gap-1 border-slate-300 text-slate-600 hover:bg-slate-100"
                          >
                            <EyeOff className="h-3 w-3" /> Ẩn
                          </Button>
                        )}
                        {r.status !== 'flagged' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateReview(r.id, { status: 'flagged' }, 'Đã đánh dấu báo cáo')}
                            disabled={isUpdating}
                            className="text-[11px] h-7 gap-1 border-rose-300 text-rose-700 hover:bg-rose-50"
                          >
                            <Flag className="h-3 w-3" /> Báo cáo
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startReply(r)}
                          disabled={isUpdating}
                          className="text-[11px] h-7 gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                        >
                          <Reply className="h-3 w-3" /> {r.reply ? 'Sửa phản hồi' : 'Phản hồi'}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

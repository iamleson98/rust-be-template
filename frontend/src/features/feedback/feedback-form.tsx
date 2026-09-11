'use client'

import { memo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import {
  Send,
  Loader2,
  Check,
  Sparkles,
  Bus,
  Route as RouteIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCreateReview, useUpdateReview } from '@/lib/queries'
import { BookingItem, ReviewSummary } from '@/features/booking/history/booking-types'
import { feedbackSchema, type FeedbackValues } from './feedback-schema'
import { ExistingReviewCard } from './existing-review-card'
import { FeedbackRatingField } from './feedback-rating-field'
import { FeedbackTagPickerField } from './feedback-tag-picker-field'
import { FeedbackCommentField } from './feedback-comment-field'
import { FeedbackPhotoField } from './feedback-photo-field'

type Props = {
  booking: BookingItem
  /** Existing review (if any) — when provided the form renders in "view/edit" mode. */
  existingReview?: ReviewSummary | null
  /** Called after a successful submit OR edit — parent should refresh state. */
  onSubmitted?: (review: ReviewSummary) => void
  /** Called when the user clicks "Đóng" / cancels. */
  onClose?: () => void
}

/**
 * FeedbackForm — inline review form rendered below a completed BookingCard.
 *
 * - If `existingReview` is provided: renders the review read-only with an
 *   "Chỉnh sửa" toggle to switch into edit mode (PATCH /api/reviews/[id]).
 * - Otherwise: renders an empty form (POST /api/reviews).
 *
 * Validation mirrors the server and is enforced by zod via react-hook-form.
 * Field controls live in the sibling `feedback-*-field.tsx` files; the
 * read-only view in `existing-review-card.tsx`.
 */
export const FeedbackForm = memo(function FeedbackForm({ booking, existingReview, onSubmitted, onClose }: Props) {
  const isEditingExisting = !!existingReview
  const [editMode, setEditMode] = useState(!isEditingExisting)
  const [hoverRating, setHoverRating] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  // Two mutations defined at HOOK CREATION — each carries its own
  // onSuccess/onError. mutate() takes only the params.
  const createMut = useCreateReview({
    onSuccess: (data: any) => {
      const review: ReviewSummary = data?.review ?? data?.data?.review
      if (review) onSubmitted?.(review)
      setSubmitted(true)
      toast.success('Cảm ơn đánh giá của bạn!')
    },
    onError: () => {
      toast.error('Không thể gửi đánh giá')
    },
  })

  const updateMut = useUpdateReview({
    onSuccess: (data: any) => {
      const review: ReviewSummary = data?.review ?? data?.data?.review
      if (review) onSubmitted?.(review)
      setSubmitted(true)
      toast.success('Đã cập nhật đánh giá!')
    },
    onError: () => {
      toast.error('Không thể cập nhật đánh giá')
    },
  })

  const submitting = createMut.isPending || updateMut.isPending

  const form = useForm<FeedbackValues>({
    resolver: zodResolver(feedbackSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      rating: existingReview?.rating ?? 0,
      title: existingReview?.title ?? '',
      content: existingReview?.content ?? '',
      tags: existingReview?.tags ?? [],
      photos: existingReview?.photos ?? [],
    },
  })

  // Live-watched values (for inline disabled-state + counter UX)
  const rating = form.watch('rating')
  const comment = form.watch('content')

  const onSubmit = (values: FeedbackValues) => {
    if (!booking.trip?.routeId || !booking.trip?.brandId) {
      toast.error('Thiếu thông tin tuyến/hãng để gửi đánh giá')
      return
    }
    const payload = {
      body: {
        bookingId: booking.id,
        rating: values.rating,
        title: values.title.trim(),
        content: values.content.trim(),
        tags: values.tags,
        photos: values.photos,
      },
    } as any
    if (existingReview) {
      updateMut.mutate({ path: { id: existingReview.id }, ...payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const reset = () => {
    form.reset({
      rating: 0,
      title: '',
      content: '',
      tags: [],
      photos: [],
    })
    setHoverRating(0)
    setSubmitted(false)
  }

  const accent = booking.trip?.brandAccent ?? '#2563eb'
  const isShortComment =
    comment.trim().length > 0 && comment.trim().length < 20

  // ─── "Read-only" view for an existing review ─────────────────
  if (isEditingExisting && !editMode) {
    return (
      <ExistingReviewCard
        existingReview={existingReview}
        setEditMode={setEditMode}
        onClose={onClose}
      />
    )
  }

  // ─── "Submitted" success state ─────────────────────────────
  if (submitted) {
    return (
      <Card className="ring-1 ring-amber-200 overflow-hidden">
        <div className="h-1 bg-linear-to-r from-amber-400 to-orange-500" />
        <CardContent className="p-6 text-center">
          <div className="inline-flex h-16 w-16 rounded-full bg-linear-to-br from-amber-400 to-orange-500 items-center justify-center mb-3">
            <Check className="h-8 w-8 text-white" strokeWidth={3} />
          </div>
          <h4 className="font-bold text-lg mb-1">Cảm ơn đánh giá của bạn!</h4>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Nhận xét của bạn giúp cộng đồng hành khách DatXeVui chọn chuyến đi tốt hơn và giúp hãng xe
            cải thiện dịch vụ.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 ring-1 ring-amber-200 px-3 py-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium text-amber-700">+10 điểm tích lũy</span>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditMode(false)
                reset()
              }}
            >
              Đóng
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ─── Editable form (POST new OR PATCH existing) ────────────
  return (
    <Card className="ring-1 ring-amber-200 overflow-hidden">
      <div className="h-1 bg-linear-to-r from-amber-400 to-orange-500" />
      <CardContent className="p-4 md:p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h4 className="font-bold text-base flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-amber-500" />
              {existingReview ? 'Chỉnh sửa đánh giá' : 'Đánh giá chuyến đi'}
            </h4>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1 bg-blue-50">
                <Bus className="h-3 w-3" />
                {booking.trip?.brandName ?? 'Nhà xe'}
              </Badge>
              <Badge variant="outline" className="gap-1 bg-slate-50">
                <RouteIcon className="h-3 w-3" />
                {booking.trip?.fromName} → {booking.trip?.toName}
              </Badge>
            </div>
          </div>
          {existingReview && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => setEditMode(false)}
            >
              Hủy chỉnh sửa
            </Button>
          )}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Star rating — custom control */}
            <FeedbackRatingField
              form={form}
              setHoverRating={setHoverRating}
              hoverRating={hoverRating}
              rating={rating}
              accent={accent}
            />

            {/* Tag picker — custom control */}
            <FeedbackTagPickerField form={form} />

            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Tiêu đề (tuỳ chọn)
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder="VD: Chuyến đi tuyệt vời, đúng giờ!"
                      maxLength={80}
                    />
                  </FormControl>
                  <div className="text-[10px] text-right text-muted-foreground">
                    {(field.value ?? '').length}/80
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Comment */}
            <FeedbackCommentField form={form} isShortComment={isShortComment} />

            {/* Photo upload */}
            <FeedbackPhotoField form={form} />

            {/* Submit */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="submit"
                disabled={rating === 0 || submitting || isShortComment}
                className="flex-1 gap-2 bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {existingReview ? 'Lưu chỉnh sửa' : 'Gửi đánh giá'}
              </Button>
              {onClose && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Hủy
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
})

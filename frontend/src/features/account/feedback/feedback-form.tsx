'use client'

import { reviewsCreateMutation, reviewsUpdateMutation } from '@/api'
import { useMutation } from '@tanstack/react-query'
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
import { Send, Loader2, Check, Sparkles, Bus, Route as RouteIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
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

export const FeedbackForm = memo(function FeedbackForm({
  booking,
  existingReview,
  onSubmitted,
  onClose,
}: Props) {
  const t = useT()
  const isEditingExisting = !!existingReview
  const [editMode, setEditMode] = useState(!isEditingExisting)
  const [submitted, setSubmitted] = useState(false)

  const createMut = useMutation({ ...reviewsCreateMutation(),
    onSuccess: (data) => {
      const review = (((data ?? {}) as { review?: unknown; data?: { review?: unknown } }).review ??
        ((data ?? {}) as { data?: { review?: unknown } }).data?.review) as ReviewSummary | undefined
      if (review) onSubmitted?.(review)
      setSubmitted(true)
      toast.success(t('feedbackForm.thanksToast'))
    },
    onError: () => {
      toast.error(t('feedbackForm.sendError'))
    },
  })

  const updateMut = useMutation({ ...reviewsUpdateMutation(),
    onSuccess: (data) => {
      const review = (((data ?? {}) as { review?: unknown; data?: { review?: unknown } }).review ??
        ((data ?? {}) as { data?: { review?: unknown } }).data?.review) as ReviewSummary | undefined
      if (review) onSubmitted?.(review)
      setSubmitted(true)
      toast.success(t('feedbackForm.updatedToast'))
    },
    onError: () => {
      toast.error(t('feedbackForm.updateError'))
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
    // The bookings list carries no routeId/brandId; the backend derives both from the booking.
    const body = {
      rating: values.rating,
      title: values.title.trim(),
      content: values.content.trim(),
      tags: values.tags,
      photos: values.photos,
    }
    if (existingReview) updateMut.mutate({ path: { id: existingReview.id }, body })
    else createMut.mutate({ body: { ...body, bookingId: booking.id } })
  }

  const reset = () => {
    form.reset({
      rating: 0,
      title: '',
      content: '',
      tags: [],
      photos: [],
    })
    setSubmitted(false)
  }

  const accent = booking.trip?.brandAccent ?? '#2563eb'
  const isShortComment = comment.trim().length > 0 && comment.trim().length < 20

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
      <Card className="border-border overflow-hidden">
        <CardContent className="p-6 text-center">
          <div className="inline-flex h-14 w-14 rounded-full bg-amber-50 items-center justify-center mb-3">
            <Check className="h-7 w-7 text-amber-600" strokeWidth={3} />
          </div>
          <h4 className="font-bold text-lg mb-1">{t('feedbackForm.thanksToast')}</h4>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {t('feedbackForm.thanksDesc')}
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium text-amber-700">
              {t('feedbackForm.pointsEarned')}
            </span>
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
              {t('common.close')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ─── Editable form (POST new OR PATCH existing) ────────────
  return (
    <Card className="border-border overflow-hidden">
      <CardContent className="p-4 md:p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h4 className="font-bold text-base flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-amber-500" />
              {existingReview ? t('feedbackForm.editTitle') : t('feedbackForm.formTitle')}
            </h4>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1 bg-blue-50">
                <Bus className="h-3 w-3" />
                {booking.trip?.brandName ?? t('bookingHistory.brandFallback')}
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
              {t('feedbackForm.cancelEdit')}
            </Button>
          )}
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Star rating — custom control */}
            <FeedbackRatingField form={form} accent={accent} />

            {/* Tag picker — custom control */}
            <FeedbackTagPickerField form={form} />

            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('feedbackForm.titleLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      placeholder={t('feedbackForm.titlePlaceholder')}
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
                className="flex-1 gap-2"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {existingReview ? t('feedbackForm.saveEdit') : t('feedbackForm.submit')}
              </Button>
              {onClose && (
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                  {t('feedbackForm.cancel')}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
})

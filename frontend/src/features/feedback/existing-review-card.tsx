'use client'

/**
 * ExistingReviewCard — the read-only "your review" card rendered by
 * FeedbackForm when an existing review is provided and edit mode is off
 * (with the "Chỉnh sửa" toggle that switches back to the editable form).
 *
 * Extracted from the original `feedback-form.tsx`.
 */

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, Star, Quote, Pencil } from 'lucide-react'
import { ReviewSummary, REVIEW_TAG_LABELS } from '@/features/booking/history/booking-types'

export function ExistingReviewCard({
  existingReview,
  setEditMode,
  onClose,
}: {
  existingReview: ReviewSummary | null | undefined
  setEditMode: (editMode: boolean) => void
  onClose?: () => void
}) {
    return (
      <Card className="ring-1 ring-amber-200 overflow-hidden">
        <div className="h-1 bg-linear-to-r from-amber-400 to-orange-500" />
        <CardContent className="p-4 md:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              Đánh giá của bạn về chuyến này
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => setEditMode(true)}
            >
              <Pencil className="h-3 w-3" />
              Chỉnh sửa
            </Button>
          </div>

          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className={`h-4 w-4 ${s <= (existingReview?.rating ?? 0)
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-slate-100 text-slate-200'
                  }`}
              />
            ))}
            <span className="ml-1.5 text-xs font-bold text-amber-600">
              {(existingReview?.rating ?? 0).toFixed(1)}
            </span>
          </div>

          {existingReview?.title && (
            <div className="flex items-start gap-2">
              <Quote className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <h4 className="font-bold text-sm md:text-base text-foreground leading-snug">
                {existingReview.title}
              </h4>
            </div>
          )}

          {existingReview?.content && (
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line pl-6">
              {existingReview.content}
            </p>
          )}

          {existingReview && existingReview.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {existingReview.tags.map((t, i) => {
                const meta = REVIEW_TAG_LABELS[t]
                return (
                  <Badge
                    key={`${t}-${i}`}
                    variant="outline"
                    className="text-[11px] gap-1 px-2 py-0.5 bg-amber-50/60 border-amber-200/60 text-amber-800 font-medium"
                  >
                    {meta ? (
                      <>
                        <span>{meta.emoji}</span>
                        {meta.label}
                      </>
                    ) : (
                      t.replace(/_/g, ' ')
                    )}
                  </Badge>
                )
              })}
            </div>
          )}

          {existingReview && existingReview.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {existingReview.photos.map((src, i) => (
                <a
                  key={i}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="aspect-square rounded-lg overflow-hidden ring-1 ring-black/5 hover:ring-amber-400 transition-all"
                >
                  <img src={src} alt={`Ảnh ${i + 1}`} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </a>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-dashed border-slate-200">
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onClose}>
              Đóng
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Cảm ơn bạn đã chia sẻ trải nghiệm!
            </span>
          </div>
        </CardContent>
      </Card>
  )
}

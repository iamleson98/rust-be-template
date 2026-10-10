import { Suspense } from 'react'
import { Pencil } from 'lucide-react'
import { BusTile } from '@/components/bus-tile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  BookingItem,
  ReviewItem,
  ReviewSummary,
} from '@/features/booking/history/booking-types'
import { formatDay } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { FeedbackForm, FormFallback } from './pending-ride-card'
import { REVIEW_STATUS } from './review-status'
import { StarRating } from './star-rating'

/** A submitted review with its moderation status, the brand's reply, and an inline editor. */
export function SentFeedbackCard({
  review,
  booking,
  editing,
  onEdit,
  onEdited,
}: {
  review: ReviewItem
  /** The ride it reviews, when still known (needed to edit). */
  booking?: BookingItem
  editing: boolean
  onEdit: () => void
  onEdited: () => void
}) {
  const t = useT()
  const status = REVIEW_STATUS[review.status] ?? REVIEW_STATUS.pending
  const trip = booking?.trip
  const canEdit = !!booking && review.status !== 'approved'

  return (
    <Card className="overflow-hidden border-border">
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 text-sm">
            <BusTile accent={trip?.brandAccent} size="xs" tint />
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {trip?.routeName || review.title || t('accountPage.feedback.tripFallback')}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {trip?.brandName} · {formatDay(trip?.departureAt || review.createdAt)}
              </div>
            </div>
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1',
              status.cls,
            )}
          >
            {t(status.labelKey)}
          </span>
        </div>

        <div className="flex items-start justify-between gap-3">
          <StarRating value={review.rating} />
          {canEdit && !editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              className="h-7 gap-1.5 text-xs text-muted-foreground"
            >
              <Pencil className="size-3" /> {t('common.edit')}
            </Button>
          )}
        </div>
        {review.content && (
          <p className="line-clamp-4 text-sm leading-relaxed text-foreground/90">
            {review.content}
          </p>
        )}
        {(review.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {review.tags.slice(0, 6).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[11px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {review.reply && (
          <div className="rounded-lg rounded-tl-sm border-l-2 border-primary/50 bg-primary/5 px-3.5 py-2.5">
            <div className="text-[11px] font-semibold text-primary">
              {t('accountPage.feedback.brandReplied', {
                brand: trip?.brandName || t('accountPage.feedback.brandFallback'),
              })}
            </div>
            <p className="mt-0.5 text-sm text-foreground/80">{review.reply}</p>
          </div>
        )}
      </div>

      {editing && booking && (
        <div className="border-t bg-muted/20 px-4 py-4">
          <Suspense fallback={FormFallback}>
            <FeedbackForm
              booking={booking}
              existingReview={review as unknown as ReviewSummary}
              onSubmitted={onEdited}
              onClose={onEdit}
            />
          </Suspense>
        </div>
      )}
    </Card>
  )
}

export function SentFeedbackSkeleton() {
  return (
    <Card className="overflow-hidden border-border" aria-hidden>
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
    </Card>
  )
}

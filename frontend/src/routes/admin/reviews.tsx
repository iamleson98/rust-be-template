/** Admin route — `/admin/reviews` — reviews moderation page. */
import { ReviewsModerationPanel } from '@/components/admin/reviews/reviews-panel'

export function AdminReviewsPage() {
  return (
    <div className="page-transition">
      <ReviewsModerationPanel />
    </div>
  )
}

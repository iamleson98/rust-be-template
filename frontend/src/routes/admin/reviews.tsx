/** Admin route — `/admin/reviews` — reviews moderation page. */
import { ReviewsModerationPanel } from '@/components/admin/reviews/reviews-panel'

export function AdminReviewsPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <ReviewsModerationPanel />
      </div>
    </div>
  )
}

/** Admin route — `/admin/reviews` — reviews moderation page. */
import { AdminShell } from '@/components/layout/admin-shell'
import { ReviewsModerationPanel } from '@/components/admin/reviews/reviews-panel'

export function AdminReviewsPage() {
  return <AdminShell><ReviewsModerationPanel /></AdminShell>
}

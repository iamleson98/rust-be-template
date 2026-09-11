/** Admin route — `/admin/feedback` — feedback management page.
 *
 * Customer feedback organized by transport brand with per-brand summary
 * cards + a server-side paginated moderation table. The persistent
 * AdminShell comes from the router's admin layout route.
 */
import { FeedbackPanel } from '@/features/admin/feedback/feedback-panel'

export function AdminFeedbackPage() {
  return (
    <div className="page-transition">
      <FeedbackPanel />
    </div>
  )
}

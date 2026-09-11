/** Admin route — `/admin/cron-jobs` — recurring background job management. */
import { CronJobsPanel } from '@/features/admin/cron-jobs/cron-jobs-panel'

export function AdminCronJobsPage() {
  return (
    <div className="page-transition">
      <CronJobsPanel />
    </div>
  )
}

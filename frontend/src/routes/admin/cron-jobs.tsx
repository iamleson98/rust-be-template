/** Admin route — `/admin/cron-jobs` — recurring background job management. */
import { AdminShell } from '@/components/layout/admin-shell'
import { CronJobsPanel } from '@/components/admin/cron-jobs/cron-jobs-panel'

export function AdminCronJobsPage() {
  return (
    <AdminShell>
      <CronJobsPanel />
    </AdminShell>
  )
}

/**
 * Pure formatting helpers for the admin cron-jobs page.
 *
 * Kept free of React/imports so they can be unit-tested directly
 * (see `__tests__/cron-jobs-helpers.test.ts`).
 */

export type CronJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Human label for a run status (Vietnamese, matching the admin UI). */
export function runStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return 'Đang chờ'
    case 'running':
      return 'Đang chạy'
    case 'succeeded':
      return 'Thành công'
    case 'failed':
      return 'Thất bại'
    case 'cancelled':
      return 'Đã dừng'
    default:
      return status
  }
}

/** Tailwind classes for the status badge (light + dark mode). */
export function runStatusClass(status: string): string {
  switch (status) {
    case 'queued':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
    case 'running':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
    case 'succeeded':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
    case 'failed':
      return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
    case 'cancelled':
      return 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600'
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  }
}

/** "Mỗi 14 ngày" / "Hàng ngày" / … (interval is days). */
export function scheduleIntervalLabel(intervalDays: number): string {
  if (intervalDays === 1) return 'Hàng ngày'
  if (intervalDays === 7) return 'Hàng tuần'
  if (intervalDays === 14) return 'Hai tuần một lần'
  if (intervalDays === 30) return 'Hàng tháng'
  return `Mỗi ${intervalDays} ngày`
}

/** `2:0` → "02:00". */
export function timeLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Duration between two ISO strings → "1 giờ 23 phút" / "45 giây". */
export function durationLabel(
  startedAt?: string | null,
  finishedAt?: string | null,
): string | null {
  if (!startedAt || !finishedAt) return null
  const start = Date.parse(startedAt)
  const end = Date.parse(finishedAt)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  return humanizeDuration(end - start)
}

/** Live elapsed for a still-running job, in ms. */
export function elapsedLabel(startedAt?: string | null, now = Date.now()): string | null {
  if (!startedAt) return null
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return null
  return humanizeDuration(Math.max(0, now - start))
}

/** ms → "1 giờ 23 phút" / "45 giây" / "< 1 giây". */
export function humanizeDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 1) return '< 1 giây'
  if (totalSeconds < 60) return `${totalSeconds} giây`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} phút`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`
}

/** Short date-time for run history rows: "02/09 02:00". */
export function dateTimeLabel(iso?: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Progress message from a run's `detail` JSON (message, else phase). */
export function progressMessage(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null
  const d = detail as Record<string, unknown>
  const message = typeof d.message === 'string' ? d.message : null
  const phase = typeof d.phase === 'string' ? d.phase : null
  return message ?? phase
}

/** A run is queued or running → the job cannot be triggered again. */
export function isActiveRun(status: string): boolean {
  return status === 'queued' || status === 'running'
}

/**
 * Card heading: the API's catalog description (single source of
 * truth, English config metadata), or a local Vietnamese override for
 * known job types, else the raw job type.
 */
export function jobHeading(job: { jobType: string; description?: string | null }): string {
  const local = jobTypeLabel(job.jobType)
  if (local !== job.jobType) return local
  return job.description ?? job.jobType
}

/** Friendly job-type label: "osm.import" → "Làm mới chỉ mục địa điểm OSM". */
export function jobTypeLabel(jobType: string): string {
  if (jobType === 'osm.import') return 'Làm mới chỉ mục địa điểm OSM'
  return jobType
}

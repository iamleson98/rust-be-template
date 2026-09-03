'use client'

/**
 * Admin — cron jobs panel (`/admin/cron-jobs`).
 *
 * Lists the recurring background jobs (e.g. the biweekly OSM → Tantivy
 * refresh) with status, next run, work time and live progress; lets an
 * operator trigger a run, enable/disable a schedule, or edit its
 * cadence; and shows recent run history. Auto-refreshes every 10s.
 */

import { useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { AlertTriangle, CalendarClock, Clock, Loader2, Play, RefreshCw, Settings2, Square } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'

import {
  useAdminCronJobRuns,
  useAdminCronJobs,
  useCancelCronJob,
  useTriggerCronJob,
  useUpdateCronJob,
} from '@/lib/queries'
import type { CronJobOut, CronJobRunOut } from '@/lib/api/types.gen'

import {
  dateTimeLabel,
  durationLabel,
  elapsedLabel,
  isActiveRun,
  jobHeading,
  progressMessage,
  runStatusClass,
  runStatusLabel,
  scheduleIntervalLabel,
  timeLabel,
} from './helpers'
import { ScheduleEditDialog } from './schedule-edit-dialog'

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${runStatusClass(status)}`}
      data-testid="cron-run-status"
    >
      {status === 'running' ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : status === 'succeeded' ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      ) : status === 'failed' ? (
        <AlertTriangle className="h-3 w-3" aria-hidden />
      ) : status === 'cancelled' ? (
        <Square className="h-3 w-3 fill-current" aria-hidden />
      ) : (
        <Clock className="h-3 w-3" aria-hidden />
      )}
      {runStatusLabel(status)}
    </span>
  )
}

function NextRunCell({ job }: { job: CronJobOut }) {
  if (!job.enabled) {
    return <span className="text-sm text-muted-foreground">— (đã tắt)</span>
  }
  if (!job.nextRunAt) {
    return <span className="text-sm text-muted-foreground">Chưa đặt lịch</span>
  }
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <CalendarClock className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden />
      <span className="tabular-nums">{dateTimeLabel(job.nextRunAt)}</span>
    </span>
  )
}

function LastRunCell({ job }: { job: CronJobOut }) {
  const last = job.lastRun
  if (!last) return <span className="text-sm text-muted-foreground">Chưa chạy lần nào</span>
  const workTime =
    last.status === 'running' || last.status === 'queued'
      ? elapsedLabel(last.startedAt)
      : durationLabel(last.startedAt, last.finishedAt)
  return (
    <div className="flex flex-col gap-1">
      <StatusBadge status={last.status} />
      {workTime ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {last.status === 'running' ? 'đã chạy ' : ''}
          {workTime}
        </span>
      ) : null}
    </div>
  )
}

function JobCard({
  job,
  onTrigger,
  onCancel,
  onEdit,
  onToggle,
  busy,
}: {
  job: CronJobOut
  onTrigger: (job: CronJobOut) => void
  onCancel: (job: CronJobOut) => void
  onEdit: (job: CronJobOut) => void
  onToggle: (job: CronJobOut, enabled: boolean) => void
  busy: boolean
}) {
  const active = job.lastRun ? isActiveRun(job.lastRun.status) : false
  const progress = job.lastRun ? progressMessage(job.lastRun.detail) : null
  // Heading prefers a localised label; the catalog description (from
  // the API) then goes in the subtitle when it isn't already the heading.
  const heading = jobHeading(job)
  const catalogNote = heading !== job.description ? job.description : null

  return (
    <Card data-testid="cron-job-card" data-job-type={job.jobType}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">{heading}</h3>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {job.jobType}
              </code>
              {!job.enabled ? (
                <Badge variant="outline" className="text-xs">
                  Đã tắt
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {scheduleIntervalLabel(job.intervalDays)} · lúc {timeLabel(job.atHour, job.atMinute)} (giờ Việt Nam)
            </p>
            {catalogNote ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground/80" title={catalogNote}>
                {catalogNote}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTrigger(job)}
              disabled={busy || active}
              title={active ? 'Một lượt chạy khác đang trong tiến trình' : 'Chạy ngay'}
            >
              <Play className="h-4 w-4 mr-1.5" />
              Chạy ngay
            </Button>
            {active ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCancel(job)}
                disabled={busy}
                title="Dừng lượt chạy đang chờ / đang chạy"
                data-testid="cron-job-cancel"
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              >
                <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
                Dừng
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onEdit(job)} disabled={busy}>
              <Settings2 className="h-4 w-4 mr-1.5" />
              Sửa lịch
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
              <Switch
                checked={job.enabled}
                onCheckedChange={(v) => onToggle(job, v)}
                disabled={busy}
                aria-label="Bật/tắt lịch chạy"
              />
              Bật
            </label>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Lần chạy kế tiếp
            </p>
            <NextRunCell job={job} />
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Lần chạy gần nhất
            </p>
            <LastRunCell job={job} />
          </div>
        </div>

        {progress ? (
          <p
            className="mt-3 truncate text-xs text-muted-foreground"
            title={progress}
            data-testid="cron-progress"
          >
            {progress}
          </p>
        ) : null}

        {job.lastRun?.error ? (
          <p
            className="mt-2 line-clamp-2 rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
            title={job.lastRun.error}
          >
            {job.lastRun.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ── Run-history table (shared DataTable) ─────────────────────

const runColumnHelper = createColumnHelper<DataTableFeatures, CronJobRunOut>()

const runHistoryColumns = runColumnHelper.columns([
  runColumnHelper.accessor('jobType', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Tác vụ" />,
    cell: ({ getValue }) => <code className="text-xs">{getValue()}</code>,
    sortFn: 'text',
    meta: { label: 'Tác vụ' },
  }),
  runColumnHelper.accessor('status', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Trạng thái" />,
    cell: ({ getValue }) => <StatusBadge status={getValue()} />,
    sortFn: 'text',
    meta: { label: 'Trạng thái' },
  }),
  runColumnHelper.accessor((run) => run.startedAt ?? run.createdAt, {
    id: 'startedAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Bắt đầu" />,
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {dateTimeLabel(row.original.startedAt ?? row.original.createdAt)}
      </span>
    ),
    sortFn: 'datetime',
    meta: { label: 'Bắt đầu' },
  }),
  runColumnHelper.accessor((run) => run.finishedAt ?? run.startedAt ?? run.createdAt, {
    id: 'duration',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Thời lượng" />,
    cell: ({ row }) => {
      const run = row.original
      return (
        <span className="text-sm tabular-nums">
          {run.status === 'running' || run.status === 'queued'
            ? elapsedLabel(run.startedAt) ?? '—'
            : durationLabel(run.startedAt, run.finishedAt) ?? '—'}
        </span>
      )
    },
    sortFn: 'datetime',
    meta: { label: 'Thời lượng' },
  }),
  runColumnHelper.display({
    id: 'detail',
    header: 'Chi tiết / lỗi',
    cell: ({ row }) => {
      const run = row.original
      return run.error ? (
        <span
          className="block max-w-[320px] truncate text-xs text-rose-600 dark:text-rose-400"
          title={run.error}
        >
          {run.error}
        </span>
      ) : (
        <span
          className="block max-w-[320px] truncate text-xs text-muted-foreground"
          title={progressMessage(run.detail) ?? undefined}
        >
          {progressMessage(run.detail) ?? '—'}
        </span>
      )
    },
    enableSorting: false,
    meta: { label: 'Chi tiết / lỗi' },
  }),
])

export function CronJobsPanel() {
  const jobsQuery = useAdminCronJobs()
  const runsQuery = useAdminCronJobRuns()
  const triggerMutation = useTriggerCronJob()
  const updateMutation = useUpdateCronJob()
  const cancelMutation = useCancelCronJob()

  const [editJob, setEditJob] = useState<CronJobOut | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data])
  const runs = useMemo(() => runsQuery.data?.items ?? [], [runsQuery.data])
  const schedulerEnabled = jobsQuery.data?.schedulerEnabled ?? false
  const busy = triggerMutation.isPending || updateMutation.isPending || cancelMutation.isPending

  const trigger = async (job: CronJobOut) => {
    try {
      await triggerMutation.mutateAsync({ path: { jobType: job.jobType } })
      toast.success(`Đã đưa «${job.jobType}» vào hàng chờ`)
    } catch (e: any) {
      // 409 = already running; 503 = worker disabled — the API messages
      // are already human-readable Vietnamese/English strings.
      toast.error(e?.error?.message ?? e?.message ?? 'Không thể chạy tác vụ')
    }
  }

  const cancel = async (job: CronJobOut) => {
    try {
      await cancelMutation.mutateAsync({ path: { jobType: job.jobType } })
      toast.success(`Đã gửi yêu cầu dừng «${job.jobType}»`)
    } catch (e: any) {
      // 404 = nothing queued/running to stop.
      toast.error(e?.error?.message ?? e?.message ?? 'Không thể dừng tác vụ')
    }
  }

  const toggle = async (job: CronJobOut, enabled: boolean) => {
    try {
      await updateMutation.mutateAsync({
        path: { jobType: job.jobType },
        body: { enabled },
      })
      toast.success(enabled ? 'Đã bật lịch chạy' : 'Đã tắt lịch chạy')
    } catch (e: any) {
      toast.error(e?.error?.message ?? e?.message ?? 'Không thể cập nhật lịch')
    }
  }

  const saveSchedule = async (body: import('@/lib/api/types.gen').UpdateCronJobRequest) => {
    if (!editJob) return
    try {
      await updateMutation.mutateAsync({
        path: { jobType: editJob.jobType },
        body,
      })
      toast.success('Đã lưu lịch chạy')
      setEditOpen(false)
    } catch (e: any) {
      toast.error(e?.error?.message ?? e?.message ?? 'Không thể lưu lịch')
    }
  }

  return (
    <div className="p-3 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-600" />
            Cron jobs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tác vụ nền định kỳ — tự động tải và đánh chỉ mục dữ liệu OSM hai tuần một lần vào ban đêm.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            jobsQuery.refetch()
            runsQuery.refetch()
          }}
          disabled={jobsQuery.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${jobsQuery.isFetching ? 'animate-spin' : ''}`} />
          Làm mới
        </Button>
      </div>

      {/* Scheduler offline banner */}
      {!schedulerEnabled && !jobsQuery.isLoading ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Bộ lập lịch đang tắt trên máy chủ này (<code>SCHEDULER_ENABLED=false</code>) — các lịch
            sẽ không tự chạy và nút «Chạy ngay» bị từ chối.
          </p>
        </div>
      ) : null}

      {/* Jobs */}
      {jobsQuery.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-2">
            <div className="h-11 w-11 rounded-full bg-blue-50 flex items-center justify-center">
              <CalendarClock className="h-5 w-5 text-blue-600" />
            </div>
            <p className="font-medium">Chưa có tác vụ định kỳ nào</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Các lịch mặc định được khởi tạo khi máy chủ khởi động cùng bộ lập lịch.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3" data-testid="cron-jobs-list">
          {jobs.map((job) => (
            <JobCard
              key={job.jobType}
              job={job}
              onTrigger={trigger}
              onCancel={cancel}
              onEdit={(j) => {
                setEditJob(j)
                setEditOpen(true)
              }}
              onToggle={toggle}
              busy={busy}
            />
          ))}
        </div>
      )}

      {/* Run history */}
      <Card className="overflow-hidden">
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Lịch sử chạy
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {runsQuery.isLoading ? (
            <div className="p-4">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <DataTable
              columns={runHistoryColumns}
              data={runs}
              rowNoun="lượt chạy"
              hidePagination
              emptyTitle="Chưa có lượt chạy nào được ghi lại"
              emptyDescription="Lịch sử sẽ xuất hiện sau lần chạy đầu tiên."
              emptyIcon={<CalendarClock className="h-5 w-5" aria-hidden />}
            />
          )}
        </CardContent>
      </Card>

      <ScheduleEditDialog
        job={editJob}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={saveSchedule}
        saving={updateMutation.isPending}
      />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        Tự làm mới mỗi 10 giây
      </p>
    </div>
  )
}

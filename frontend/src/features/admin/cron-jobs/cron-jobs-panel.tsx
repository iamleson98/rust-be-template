'use client'

/**
 * Admin — cron jobs panel (`/admin/cron-jobs`).
 *
 * Lists the recurring background jobs (e.g. the biweekly OSM → Tantivy
 * refresh) with status, next run, work time and live progress; lets an
 * operator trigger a run, enable/disable a schedule, or edit its
 * cadence; and shows recent run history. Auto-refreshes every 10s.
 */

import { useQuery, useMutation } from '@tanstack/react-query'
import {
  adminCronJobsListOptions,
  listRunsOptions,
  adminCronJobsCancelMutation,
  adminCronJobsTriggerMutation,
  adminCronJobsUpdateMutation,
} from '@/api'
import { useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'

import { ConsolePage, PageHeader } from '@/components/console/page'
import { EmptyState, Panel } from '@/components/console/panel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CronJobCardsSkeleton } from '@/features/admin/cron-jobs/cron-job-cards-skeleton'
import { RunHistorySkeleton } from '@/features/admin/cron-jobs/run-history-skeleton'
import { Switch } from '@/components/ui/switch'
import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'

import type { CronJobOut, CronJobRunOut, UpdateCronJobRequest } from '@/api'

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
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'

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
  const t = useT()
  if (!job.enabled) {
    return (
      <span className="text-sm text-muted-foreground">{t('adminCronJobs.nextRunDisabled')}</span>
    )
  }
  if (!job.nextRunAt) {
    return <span className="text-sm text-muted-foreground">{t('adminCronJobs.noSchedule')}</span>
  }
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <CalendarClock className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden />
      <span className="tabular-nums">{dateTimeLabel(job.nextRunAt)}</span>
    </span>
  )
}

function LastRunCell({ job }: { job: CronJobOut }) {
  const t = useT()
  const last = job.lastRun
  if (!last)
    return <span className="text-sm text-muted-foreground">{t('adminCronJobs.neverRun')}</span>
  const workTime =
    last.status === 'running' || last.status === 'queued'
      ? elapsedLabel(last.startedAt)
      : durationLabel(last.startedAt, last.finishedAt)
  return (
    <div className="flex flex-col gap-1">
      <StatusBadge status={last.status} />
      {workTime ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {last.status === 'running' ? t('adminCronJobs.runningFor') : ''}
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
  const t = useT()
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
                  {t('adminCronJobs.disabled')}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {scheduleIntervalLabel(job.intervalDays)}
              {t('adminCronJobs.scheduleAt', { time: timeLabel(job.atHour, job.atMinute) })}
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
              title={active ? t('adminCronJobs.anotherRunTitle') : t('adminCronJobs.runNow')}
            >
              <Play className="h-4 w-4 mr-1.5" />
              {t('adminCronJobs.runNow')}
            </Button>
            {active ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCancel(job)}
                disabled={busy}
                title={t('adminCronJobs.stopRunTitle')}
                data-testid="cron-job-cancel"
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              >
                <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
                {t('adminCronJobs.stop')}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onEdit(job)} disabled={busy}>
              <Settings2 className="h-4 w-4 mr-1.5" />
              {t('adminCronJobs.editSchedule')}
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
              <Switch
                checked={job.enabled}
                onCheckedChange={(v) => onToggle(job, v)}
                disabled={busy}
                aria-label={t('adminCronJobs.toggleSchedule')}
              />
              {t('adminCronJobs.on')}
            </label>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('adminCronJobs.nextRun')}
            </p>
            <NextRunCell job={job} />
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('adminCronJobs.lastRun')}
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

/** Column defs are built per-render so labels follow the UI language. */
const buildRunHistoryColumns = (t: ReturnType<typeof useT>) =>
  runColumnHelper.columns([
    runColumnHelper.accessor('jobType', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('adminCronJobs.colTask')} />
      ),
      cell: ({ getValue }) => <code className="text-xs">{getValue()}</code>,
      sortFn: 'text',
      meta: { label: t('adminCronJobs.colTask') },
    }),
    runColumnHelper.accessor('status', {
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} />,
      cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      sortFn: 'text',
      meta: { label: t('common.status') },
    }),
    runColumnHelper.accessor((run) => run.startedAt ?? run.createdAt, {
      id: 'startedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('adminCronJobs.colStarted')} />
      ),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {dateTimeLabel(row.original.startedAt ?? row.original.createdAt)}
        </span>
      ),
      sortFn: 'datetime',
      meta: { label: t('adminCronJobs.colStarted') },
    }),
    runColumnHelper.accessor((run) => run.finishedAt ?? run.startedAt ?? run.createdAt, {
      id: 'duration',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('adminCronJobs.colDuration')} />
      ),
      cell: ({ row }) => {
        const run = row.original
        return (
          <span className="text-sm tabular-nums">
            {run.status === 'running' || run.status === 'queued'
              ? (elapsedLabel(run.startedAt) ?? '—')
              : (durationLabel(run.startedAt, run.finishedAt) ?? '—')}
          </span>
        )
      },
      sortFn: 'datetime',
      meta: { label: t('adminCronJobs.colDuration') },
    }),
    runColumnHelper.display({
      id: 'detail',
      header: t('adminCronJobs.colDetail'),
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
      meta: { label: t('adminCronJobs.colDetail') },
    }),
  ])

export function CronJobsPanel() {
  const t = useT()
  const jobsQuery = useQuery({ ...adminCronJobsListOptions(), refetchInterval: 10_000 })
  const runsQuery = useQuery({ ...listRunsOptions(), refetchInterval: 10_000 })
  const triggerMutation = useMutation(adminCronJobsTriggerMutation())
  const updateMutation = useMutation(adminCronJobsUpdateMutation())
  const cancelMutation = useMutation(adminCronJobsCancelMutation())

  const [editJob, setEditJob] = useState<CronJobOut | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data])
  const runs = useMemo(() => runsQuery.data?.items ?? [], [runsQuery.data])
  const schedulerEnabled = jobsQuery.data?.schedulerEnabled ?? false
  const busy = triggerMutation.isPending || updateMutation.isPending || cancelMutation.isPending
  const runHistoryColumns = useMemo(() => buildRunHistoryColumns(t), [t])

  const trigger = async (job: CronJobOut) => {
    try {
      await triggerMutation.mutateAsync({ path: { jobType: job.jobType } })
      toast.success(t('adminCronJobs.queuedToast', { job: job.jobType }))
    } catch (e) {
      // 409 = already running; 503 = worker disabled — the API messages
      // are already human-readable Vietnamese/English strings.
      toast.error(getErrorMessage(e, t('adminCronJobs.triggerFailed')))
    }
  }

  const cancel = async (job: CronJobOut) => {
    try {
      await cancelMutation.mutateAsync({ path: { jobType: job.jobType } })
      toast.success(t('adminCronJobs.stopToast', { job: job.jobType }))
    } catch (e) {
      // 404 = nothing queued/running to stop.
      toast.error(getErrorMessage(e, t('adminCronJobs.stopFailed')))
    }
  }

  const toggle = async (job: CronJobOut, enabled: boolean) => {
    try {
      await updateMutation.mutateAsync({
        path: { jobType: job.jobType },
        body: { enabled },
      })
      toast.success(enabled ? t('adminCronJobs.enabledToast') : t('adminCronJobs.disabledToast'))
    } catch (e) {
      toast.error(getErrorMessage(e, t('adminCronJobs.updateFailed')))
    }
  }

  const saveSchedule = async (body: UpdateCronJobRequest) => {
    if (!editJob) return
    try {
      await updateMutation.mutateAsync({
        path: { jobType: editJob.jobType },
        body,
      })
      toast.success(t('adminCronJobs.savedToast'))
      setEditOpen(false)
    } catch (e) {
      toast.error(getErrorMessage(e, t('adminCronJobs.saveFailed')))
    }
  }

  return (
    <ConsolePage>
      <PageHeader
        title={t('admin.cronJobs')}
        description={t('adminCronJobs.subtitle')}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              jobsQuery.refetch()
              runsQuery.refetch()
            }}
            disabled={jobsQuery.isFetching}
          >
            <RefreshCw className={jobsQuery.isFetching ? 'animate-spin' : undefined} />
            {t('common.refresh')}
          </Button>
        }
      />

      {!schedulerEnabled && !jobsQuery.isLoading ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertDescription>
            <p>
              {t('adminCronJobs.schedulerOffLead')}
              <code>SCHEDULER_ENABLED=false</code>
              {t('adminCronJobs.schedulerOffTail')}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Jobs */}
      {jobsQuery.isLoading ? (
        <CronJobCardsSkeleton count={3} />
      ) : jobs.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<CalendarClock />}
            text={
              <>
                <span className="block font-medium text-foreground">
                  {t('adminCronJobs.emptyTitle')}
                </span>
                {t('adminCronJobs.emptyDesc')}
              </>
            }
          />
        </Panel>
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
      <Panel
        title={t('adminCronJobs.runHistory')}
        className="overflow-hidden"
        bodyClassName="mt-3 border-t p-0"
      >
        {runsQuery.isLoading ? (
          <RunHistorySkeleton rows={5} />
        ) : (
          /* The panel provides the surface — render the table unbordered. */
          <DataTable
            bordered={false}
            columns={runHistoryColumns}
            data={runs}
            rowNoun={t('adminCronJobs.rowNoun')}
            hidePagination
            emptyTitle={t('adminCronJobs.noRuns')}
            emptyDescription={t('adminCronJobs.noRunsDesc')}
            emptyIcon={<CalendarClock className="h-5 w-5" aria-hidden />}
          />
        )}
      </Panel>

      <ScheduleEditDialog
        job={editJob}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={saveSchedule}
        saving={updateMutation.isPending}
      />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        {t('adminCronJobs.autoRefresh')}
      </p>
    </ConsolePage>
  )
}

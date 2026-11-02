"use client";

/** One scheduled job: its status, next and last run, run history and controls. */

import { createColumnHelper } from "@tanstack/react-table";
import {
  AlertTriangle,
  CalendarClock,
  Clock,
  Loader2,
  Play,
  Settings2,
  Square,
} from "lucide-react";
import { Badge } from "@spa/components/ui/badge";
import { Button } from "@spa/components/ui/button";
import { Card, CardContent } from "@spa/components/ui/card";
import { Switch } from "@spa/components/ui/switch";
import { DataTableColumnHeader, type DataTableFeatures } from "@spa/components/data-table";
import type { CronJobOut, CronJobRunOut } from "@spa/api";
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
} from "./helpers";
import { useT } from "@spa/lib/i18n";

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${runStatusClass(status)}`}
      data-testid="cron-run-status"
    >
      {status === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : status === "succeeded" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      ) : status === "failed" ? (
        <AlertTriangle className="h-3 w-3" aria-hidden />
      ) : status === "cancelled" ? (
        <Square className="h-3 w-3 fill-current" aria-hidden />
      ) : (
        <Clock className="h-3 w-3" aria-hidden />
      )}
      {runStatusLabel(status)}
    </span>
  );
}

function NextRunCell({ job }: { job: CronJobOut }) {
  const t = useT();
  if (!job.enabled) {
    return (
      <span className="text-sm text-muted-foreground">{t("adminCronJobs.nextRunDisabled")}</span>
    );
  }
  if (!job.nextRunAt) {
    return <span className="text-sm text-muted-foreground">{t("adminCronJobs.noSchedule")}</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <CalendarClock className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden />
      <span className="tabular-nums">{dateTimeLabel(job.nextRunAt)}</span>
    </span>
  );
}

function LastRunCell({ job }: { job: CronJobOut }) {
  const t = useT();
  const last = job.lastRun;
  if (!last)
    return <span className="text-sm text-muted-foreground">{t("adminCronJobs.neverRun")}</span>;
  const workTime =
    last.status === "running" || last.status === "queued"
      ? elapsedLabel(last.startedAt)
      : durationLabel(last.startedAt, last.finishedAt);
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge status={last.status} />
      {workTime ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {last.status === "running" ? t("adminCronJobs.runningFor") : ""}
          {workTime}
        </span>
      ) : null}
    </div>
  );
}

export function JobCard({
  job,
  onTrigger,
  onCancel,
  onEdit,
  onToggle,
  busy,
}: {
  job: CronJobOut;
  onTrigger: (job: CronJobOut) => void;
  onCancel: (job: CronJobOut) => void;
  onEdit: (job: CronJobOut) => void;
  onToggle: (job: CronJobOut, enabled: boolean) => void;
  busy: boolean;
}) {
  const t = useT();
  const active = job.lastRun ? isActiveRun(job.lastRun.status) : false;
  const progress = job.lastRun ? progressMessage(job.lastRun.detail) : null;
  // Heading prefers a localised label; the catalog description (from
  // the API) then goes in the subtitle when it isn't already the heading.
  const heading = jobHeading(job);
  const catalogNote = heading !== job.description ? job.description : null;

  return (
    <Card className="py-0" data-testid="cron-job-card" data-job-type={job.jobType}>
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
                  {t("adminCronJobs.disabled")}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {scheduleIntervalLabel(job.intervalDays)}
              {t("adminCronJobs.scheduleAt", { time: timeLabel(job.atHour, job.atMinute) })}
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
              title={active ? t("adminCronJobs.anotherRunTitle") : t("adminCronJobs.runNow")}
            >
              <Play className="h-4 w-4 mr-1.5" />
              {t("adminCronJobs.runNow")}
            </Button>
            {active ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCancel(job)}
                disabled={busy}
                title={t("adminCronJobs.stopRunTitle")}
                data-testid="cron-job-cancel"
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              >
                <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
                {t("adminCronJobs.stop")}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onEdit(job)} disabled={busy}>
              <Settings2 className="h-4 w-4 mr-1.5" />
              {t("adminCronJobs.editSchedule")}
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
              <Switch
                checked={job.enabled}
                onCheckedChange={(v) => onToggle(job, v)}
                disabled={busy}
                aria-label={t("adminCronJobs.toggleSchedule")}
              />
              {t("adminCronJobs.on")}
            </label>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("adminCronJobs.nextRun")}
            </p>
            <NextRunCell job={job} />
          </div>
          <div className="space-y-1 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("adminCronJobs.lastRun")}
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
  );
}

// ── Run-history table (shared DataTable) ─────────────────────

const runColumnHelper = createColumnHelper<DataTableFeatures, CronJobRunOut>();

/** Column defs are built per-render so labels follow the UI language. */
export const buildRunHistoryColumns = (t: ReturnType<typeof useT>) =>
  runColumnHelper.columns([
    runColumnHelper.accessor("jobType", {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("adminCronJobs.colTask")} />
      ),
      cell: ({ getValue }) => <code className="text-xs">{getValue()}</code>,
      sortFn: "text",
      meta: { label: t("adminCronJobs.colTask") },
    }),
    runColumnHelper.accessor("status", {
      header: ({ column }) => <DataTableColumnHeader column={column} title={t("common.status")} />,
      cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      sortFn: "text",
      meta: { label: t("common.status") },
    }),
    runColumnHelper.accessor((run) => run.startedAt ?? run.createdAt, {
      id: "startedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("adminCronJobs.colStarted")} />
      ),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {dateTimeLabel(row.original.startedAt ?? row.original.createdAt)}
        </span>
      ),
      sortFn: "datetime",
      meta: { label: t("adminCronJobs.colStarted") },
    }),
    runColumnHelper.accessor((run) => run.finishedAt ?? run.startedAt ?? run.createdAt, {
      id: "duration",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("adminCronJobs.colDuration")} />
      ),
      cell: ({ row }) => {
        const run = row.original;
        return (
          <span className="text-sm tabular-nums">
            {run.status === "running" || run.status === "queued"
              ? (elapsedLabel(run.startedAt) ?? "—")
              : (durationLabel(run.startedAt, run.finishedAt) ?? "—")}
          </span>
        );
      },
      sortFn: "datetime",
      meta: { label: t("adminCronJobs.colDuration") },
    }),
    runColumnHelper.display({
      id: "detail",
      header: t("adminCronJobs.colDetail"),
      cell: ({ row }) => {
        const run = row.original;
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
            {progressMessage(run.detail) ?? "—"}
          </span>
        );
      },
      enableSorting: false,
      meta: { label: t("adminCronJobs.colDetail") },
    }),
  ]);

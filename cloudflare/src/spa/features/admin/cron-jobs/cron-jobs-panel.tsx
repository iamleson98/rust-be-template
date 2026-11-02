"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import {
  adminCronJobsListOptions,
  listRunsOptions,
  adminCronJobsCancelMutation,
  adminCronJobsTriggerMutation,
  adminCronJobsUpdateMutation,
} from "@spa/api";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ConsolePage, PageHeader } from "@spa/components/console/page";
import { EmptyState, Panel } from "@spa/components/console/panel";
import { Alert, AlertDescription } from "@spa/components/ui/alert";
import { Button } from "@spa/components/ui/button";
import { CronJobCardsSkeleton } from "@spa/features/admin/cron-jobs/cron-job-cards-skeleton";
import { RunHistorySkeleton } from "@spa/features/admin/cron-jobs/run-history-skeleton";
import { DataTable } from "@spa/components/data-table";
import type { CronJobOut, UpdateCronJobRequest } from "@spa/api";
import { ScheduleEditDialog } from "./schedule-edit-dialog";
import { getErrorMessage } from "@spa/lib/error-message";
import { useT } from "@spa/lib/i18n";
import { JobCard, buildRunHistoryColumns } from "./job-card";

export function CronJobsPanel() {
  const t = useT();
  const jobsQuery = useQuery({ ...adminCronJobsListOptions(), refetchInterval: 10_000 });
  const runsQuery = useQuery({ ...listRunsOptions(), refetchInterval: 10_000 });
  const triggerMutation = useMutation(adminCronJobsTriggerMutation());
  const updateMutation = useMutation(adminCronJobsUpdateMutation());
  const cancelMutation = useMutation(adminCronJobsCancelMutation());

  const [editJob, setEditJob] = useState<CronJobOut | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data]);
  const runs = useMemo(() => runsQuery.data?.items ?? [], [runsQuery.data]);
  const schedulerEnabled = jobsQuery.data?.schedulerEnabled ?? false;
  const busy = triggerMutation.isPending || updateMutation.isPending || cancelMutation.isPending;
  const runHistoryColumns = useMemo(() => buildRunHistoryColumns(t), [t]);

  const trigger = async (job: CronJobOut) => {
    try {
      await triggerMutation.mutateAsync({ path: { jobType: job.jobType } });
      toast.success(t("adminCronJobs.queuedToast", { job: job.jobType }));
    } catch (e) {
      // 409 = already running; 503 = worker disabled — the API messages
      // are already human-readable Vietnamese/English strings.
      toast.error(getErrorMessage(e, t("adminCronJobs.triggerFailed")));
    }
  };

  const cancel = async (job: CronJobOut) => {
    try {
      await cancelMutation.mutateAsync({ path: { jobType: job.jobType } });
      toast.success(t("adminCronJobs.stopToast", { job: job.jobType }));
    } catch (e) {
      // 404 = nothing queued/running to stop.
      toast.error(getErrorMessage(e, t("adminCronJobs.stopFailed")));
    }
  };

  const toggle = async (job: CronJobOut, enabled: boolean) => {
    try {
      await updateMutation.mutateAsync({
        path: { jobType: job.jobType },
        body: { enabled },
      });
      toast.success(enabled ? t("adminCronJobs.enabledToast") : t("adminCronJobs.disabledToast"));
    } catch (e) {
      toast.error(getErrorMessage(e, t("adminCronJobs.updateFailed")));
    }
  };

  const saveSchedule = async (body: UpdateCronJobRequest) => {
    if (!editJob) return;
    try {
      await updateMutation.mutateAsync({
        path: { jobType: editJob.jobType },
        body,
      });
      toast.success(t("adminCronJobs.savedToast"));
      setEditOpen(false);
    } catch (e) {
      toast.error(getErrorMessage(e, t("adminCronJobs.saveFailed")));
    }
  };

  return (
    <ConsolePage>
      <PageHeader
        title={t("admin.cronJobs")}
        description={t("adminCronJobs.subtitle")}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              jobsQuery.refetch();
              runsQuery.refetch();
            }}
            disabled={jobsQuery.isFetching}
          >
            <RefreshCw className={jobsQuery.isFetching ? "animate-spin" : undefined} />
            {t("common.refresh")}
          </Button>
        }
      />

      {!schedulerEnabled && !jobsQuery.isLoading ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertDescription>
            <p>
              {t("adminCronJobs.schedulerOffLead")}
              <code>SCHEDULER_ENABLED=false</code>
              {t("adminCronJobs.schedulerOffTail")}
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
                  {t("adminCronJobs.emptyTitle")}
                </span>
                {t("adminCronJobs.emptyDesc")}
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
                setEditJob(j);
                setEditOpen(true);
              }}
              onToggle={toggle}
              busy={busy}
            />
          ))}
        </div>
      )}

      {/* Run history */}
      <Panel
        title={t("adminCronJobs.runHistory")}
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
            rowNoun={t("adminCronJobs.rowNoun")}
            hidePagination
            emptyTitle={t("adminCronJobs.noRuns")}
            emptyDescription={t("adminCronJobs.noRunsDesc")}
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
        {t("adminCronJobs.autoRefresh")}
      </p>
    </ConsolePage>
  );
}

"use client";

/**
 * The VPS service: machine resources, search latency, the OpenStreetMap
 * index and the cron jobs it drives. Every number comes from the service's
 * `/v1/status`; what it did not report shows "—".
 */

import { AlertCircle, Cpu, Gauge, HardDrive, Map, MemoryStick, Server } from "lucide-react";

import { Badge } from "@spa/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@spa/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@spa/components/ui/table";
import { formatDayTime, relativeTime } from "@spa/lib/format";
import { useT } from "@spa/lib/i18n";
import { formatBytes, formatMs, formatPercent, formatUptime, usagePercent } from "./metric-helpers";
import { StatCard, type Health } from "./stat-card";
import type { SystemReport, VpsStatus } from "./system-api";

export function VpsSection({ vps }: { vps: SystemReport["vps"] }) {
  const t = useT();
  return (
    <section className="space-y-3" data-testid="system-vps">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Server className="size-5" aria-hidden />
        {t("adminSystem.vpsTitle")}
        {vps.status && (
          <span className="text-sm font-normal text-muted-foreground">
            {t("adminSystem.vpsDetail", {
              version: vps.status.service.version,
              uptime: formatUptime(vps.status.service.uptimeSecs),
              latency: formatMs(vps.latencyMs),
            })}
          </span>
        )}
      </h2>
      {!vps.configured ? (
        <Notice text={t("adminSystem.vpsNotConfigured")} />
      ) : !vps.status ? (
        <Notice tone="down" text={t("adminSystem.vpsUnreachable", { error: vps.error ?? "—" })} />
      ) : (
        <>
          <Resources status={vps.status} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SearchPerformance status={vps.status} />
            <IndexCard status={vps.status} />
          </div>
          <JobsCard status={vps.status} />
        </>
      )}
    </section>
  );
}

function Notice({ text, tone = "idle" }: { text: string; tone?: "idle" | "down" }) {
  return (
    <Card>
      <CardContent
        className={`flex items-center gap-3 text-sm ${tone === "down" ? "text-red-600" : "text-muted-foreground"}`}
      >
        <AlertCircle className="size-5 shrink-0" aria-hidden />
        {text}
      </CardContent>
    </Card>
  );
}

const health = (pct: number | null): Health | undefined =>
  pct == null ? undefined : pct >= 90 ? "down" : pct >= 70 ? "warn" : "ok";

function Resources({ status }: { status: VpsStatus }) {
  const t = useT();
  const s = status.system;
  const memUsed =
    s.memoryTotalBytes != null && s.memoryAvailableBytes != null
      ? s.memoryTotalBytes - s.memoryAvailableBytes
      : null;
  const memPct = usagePercent(memUsed, s.memoryTotalBytes);
  const diskUsed =
    s.diskTotalBytes != null && s.diskFreeBytes != null ? s.diskTotalBytes - s.diskFreeBytes : null;
  const diskPct = usagePercent(diskUsed, s.diskTotalBytes);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <StatCard
        testId="vps-cpu"
        icon={Cpu}
        title="CPU"
        health={health(s.cpuPercent)}
        headline={formatPercent(s.cpuPercent)}
        percent={s.cpuPercent}
      >
        <div>
          {t("adminSystem.cpuDetail", {
            cores: s.cpus,
            load: s.loadAverage ? s.loadAverage.map((l) => l.toFixed(2)).join(" · ") : "—",
          })}
        </div>
        <div>{t("adminSystem.serviceCpu", { pct: formatPercent(s.processCpuPercent) })}</div>
      </StatCard>
      <StatCard
        testId="vps-memory"
        icon={MemoryStick}
        title={t("adminSystem.memory")}
        health={health(memPct)}
        headline={formatPercent(memPct)}
        percent={memPct}
      >
        <div>
          {t("adminSystem.usedOf", {
            used: formatBytes(memUsed),
            total: formatBytes(s.memoryTotalBytes),
          })}
        </div>
        <div>{t("adminSystem.serviceMemory", { size: formatBytes(s.processRssBytes) })}</div>
      </StatCard>
      <StatCard
        testId="vps-disk"
        icon={HardDrive}
        title={t("adminSystem.disk")}
        health={health(diskPct)}
        headline={formatPercent(diskPct)}
        percent={diskPct}
      >
        <div>
          {t("adminSystem.usedOf", {
            used: formatBytes(diskUsed),
            total: formatBytes(s.diskTotalBytes),
          })}
        </div>
        <div>{t("adminSystem.indexOnDisk", { size: formatBytes(status.index.diskBytes) })}</div>
      </StatCard>
    </div>
  );
}

function SearchPerformance({ status }: { status: VpsStatus }) {
  const t = useT();
  const rows = [
    ["search", status.requests.search],
    ["reverse", status.requests.reverse],
  ] as const;
  return (
    <Card data-testid="vps-search-performance">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4 text-muted-foreground" aria-hidden />
          {t("adminSystem.searchPerf")}
        </CardTitle>
        <CardDescription>{t("adminSystem.searchPerfDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(([key, l]) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{t(`adminSystem.endpoint.${key}`)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("adminSystem.requestCount", { n: l.count.toLocaleString() })}
                {l.errors > 0 && (
                  <span className="text-red-600">
                    {" "}
                    · {t("adminSystem.errors", { n: l.errors })}
                  </span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["p50", l.p50Ms],
                  ["p95", l.p95Ms],
                  ["p99", l.p99Ms],
                ] as const
              ).map(([label, ms]) => (
                <div key={label} className="rounded-md bg-muted/50 px-2 py-1.5">
                  <div className="text-[11px] text-muted-foreground uppercase">{label}</div>
                  <div className="font-semibold tabular-nums">{formatMs(ms)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const OUTCOME_VARIANT = {
  updated: "default",
  unchanged: "secondary",
  failed: "destructive",
} as const;

function IndexCard({ status }: { status: VpsStatus }) {
  const t = useT();
  const { index } = status;
  const run = index.lastRun;
  const runSecs = run
    ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : null;
  return (
    <Card data-testid="vps-index">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Map className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1">{t("adminSystem.index")}</span>
          <Badge variant={index.state === "ready" ? "outline" : "secondary"}>
            {t(`adminSystem.indexState.${index.state}`)}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t("adminSystem.indexSchedule", {
            cron: index.schedule,
            tz: status.service.timezone,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="text-2xl font-semibold tabular-nums">
          {index.places != null
            ? t("adminSystem.places", { n: index.places.toLocaleString() })
            : "—"}
        </div>
        {index.current && (
          <div className="text-xs text-muted-foreground">
            {t("adminSystem.builtAt", {
              when: formatDayTime(index.current.builtAt),
              profile: index.current.profile,
            })}
          </div>
        )}
        {run && (
          <div className="space-y-1 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t("adminSystem.lastRun")}</span>
              <Badge variant={OUTCOME_VARIANT[run.outcome]}>
                {t(`adminSystem.outcome.${run.outcome}`)}
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground">
                {relativeTime(run.finishedAt)}
              </span>
            </div>
            {run.outcome === "failed" ? (
              <p className="text-xs break-words text-red-600">{run.detail}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("adminSystem.runStats", {
                  secs: runSecs ?? "—",
                  cpu: run.extractorCpuSecs != null ? run.extractorCpuSecs.toFixed(0) : "—",
                  mem: formatBytes(run.extractorPeakRssBytes),
                })}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function JobsCard({ status }: { status: VpsStatus }) {
  const t = useT();
  return (
    <Card data-testid="vps-jobs">
      <CardHeader>
        <CardTitle className="text-base">{t("adminSystem.jobs")}</CardTitle>
        <CardDescription>{t("adminSystem.jobsDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {status.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("adminSystem.noJobs")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminSystem.job")}</TableHead>
                <TableHead>{t("adminSystem.schedule")}</TableHead>
                <TableHead>{t("adminSystem.lastRun")}</TableHead>
                <TableHead>{t("adminSystem.nextRun")}</TableHead>
                <TableHead className="text-right">{t("adminSystem.failures")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.jobs.map((job) => (
                <TableRow key={job.name}>
                  <TableCell className="font-medium">{job.name}</TableCell>
                  <TableCell className="font-mono text-xs">{job.schedule}</TableCell>
                  <TableCell className="max-w-80">
                    {job.lastRun ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <Badge variant={job.lastRun.ok ? "outline" : "destructive"}>
                            {job.lastRun.ok
                              ? "OK"
                              : t("adminSystem.jobFailed", {
                                  status: job.lastRun.httpStatus ?? "—",
                                })}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {relativeTime(job.lastRun.startedAt)} ·{" "}
                            {formatMs(job.lastRun.durationMs)}
                          </span>
                        </div>
                        <div
                          className="truncate text-xs text-muted-foreground"
                          title={job.lastRun.summary}
                        >
                          {job.lastRun.summary}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t("adminSystem.notYet")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {job.nextRunAt ? formatDayTime(job.nextRunAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {job.failures}
                    {job.consecutiveFailures > 0 && (
                      <span className="text-red-600">
                        {" "}
                        ({t("adminSystem.inARow", { n: job.consecutiveFailures })})
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

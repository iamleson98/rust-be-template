"use client";

/**
 * Overview row: the Worker, D1, who drives the scheduled jobs, and which
 * index answers place search.
 */

import { CalendarClock, Cloud, Database, MapPin } from "lucide-react";

import { relativeTime } from "@spa/lib/format";
import { useT } from "@spa/lib/i18n";
import { formatBytes, formatMs, formatUptime } from "./metric-helpers";
import { StatCard } from "./stat-card";
import type { SystemReport } from "./system-api";

export function OverviewCards({ report }: { report: SystemReport }) {
  const t = useT();
  const { worker, database, cron, placeSearch } = report;
  const lastTick = cron.driver === "vps" ? cron.lastDriverTickAt : cron.lastSweepAt;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        testId="system-worker"
        icon={Cloud}
        title={t("adminSystem.worker")}
        health="ok"
        headline={worker.colo ?? "—"}
      >
        <div>{t("adminSystem.workerEnv", { env: worker.appEnv ?? "—" })}</div>
        <div>
          {t("adminSystem.isolateUptime", { time: formatUptime(worker.isolateUptimeSecs) })}
        </div>
      </StatCard>

      <StatCard
        testId="system-database"
        icon={Database}
        title={t("adminSystem.database")}
        health={database.reachable ? "ok" : "down"}
        headline={
          database.reachable ? formatBytes(database.sizeBytes) : t("adminSystem.unreachable")
        }
      >
        {database.reachable ? (
          <div>
            {t("adminSystem.dbDetail", {
              tables: database.tables ?? "—",
              latency: formatMs(database.latencyMs),
            })}
          </div>
        ) : (
          <div className="text-red-600">{database.error}</div>
        )}
      </StatCard>

      <StatCard
        testId="system-cron"
        icon={CalendarClock}
        title={t("adminSystem.cron")}
        health={cron.driver === "vps" ? "ok" : cron.driver === "worker" ? "warn" : "down"}
        headline={t(`adminSystem.driver.${cron.driver}`)}
      >
        <div>
          {t("adminSystem.lastTick", {
            when: lastTick ? relativeTime(lastTick) : t("adminSystem.never"),
          })}
        </div>
        {cron.driver !== "vps" && <div>{t(`adminSystem.driverHint.${cron.driver}`)}</div>}
      </StatCard>

      <StatCard
        testId="system-place-search"
        icon={MapPin}
        title={t("adminSystem.placeSearch")}
        health={placeSearch.engine === "vps" ? "ok" : "warn"}
        headline={t(`adminSystem.engine.${placeSearch.engine}`)}
      >
        <div>{t(`adminSystem.engineHint.${placeSearch.engine}`)}</div>
      </StatCard>
    </div>
  );
}

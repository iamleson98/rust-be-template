/** Admin route — `/admin/system` — what runs the site, and how it is doing.
 *
 * Polls `GET /api/admin/system` every 10 s:
 *   • Overview — the Cloudflare Worker, D1, who drives the scheduled jobs
 *     (the VPS, or the Worker's fallback trigger), and which index answers
 *     place search.
 *   • VPS service — CPU / memory / disk, search latency percentiles, the
 *     OpenStreetMap index and its last refresh, and the cron jobs it drives.
 *
 * While the first report loads the page shows a structure-matched skeleton.
 */
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle } from "lucide-react";

import { Card, CardContent } from "@spa/components/ui/card";
import { ConsolePage, PageHeader } from "@spa/components/console/page";
import { getErrorMessage } from "@spa/lib/error-message";
import { useT } from "@spa/lib/i18n";
import { OverviewCards } from "./overview-cards";
import { systemReportOptions } from "./system-api";
import { SystemSkeleton } from "./system-skeleton";
import { VpsSection } from "./vps-section";

export function AdminSystemPage() {
  const t = useT();
  const { data, isLoading, error } = useQuery(systemReportOptions());

  return (
    <ConsolePage>
      <PageHeader
        title={t("admin.systemMonitoring")}
        description={
          <span className="inline-flex items-center gap-1.5">
            <Activity className="size-3.5 animate-pulse" aria-hidden />
            {t("adminSystem.autoRefresh")}
          </span>
        }
      />
      {isLoading ? (
        <SystemSkeleton />
      ) : !data ? (
        <Card data-testid="system-error">
          <CardContent className="flex items-center gap-3 text-red-600">
            <AlertCircle className="size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{t("adminSystem.loadFailed")}</p>
              <p className="text-sm text-muted-foreground">
                {getErrorMessage(error, t("adminSystem.unknownError"))}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <section className="space-y-3" data-testid="system-overview">
            <h2 className="text-lg font-semibold">{t("adminSystem.overview")}</h2>
            <OverviewCards report={data} />
          </section>
          <VpsSection vps={data.vps} />
        </div>
      )}
    </ConsolePage>
  );
}

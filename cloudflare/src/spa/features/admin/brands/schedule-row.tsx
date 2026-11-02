"use client";

/** A schedule row of the brands tree: departure, stops, fares and its actions. */

import { Clock, Pencil, Trash2 } from "lucide-react";
import { TableCell, TableRow } from "@spa/components/ui/table";
import { useT } from "@spa/lib/i18n";
import { formatVND } from "@spa/lib/format";
import type { AdminBrandOut, AdminRouteOut, AdminScheduleOut } from "@spa/api";
import { cn } from "@spa/lib/utils";
import {
  dayChips,
  daysLabel,
  effectiveWindow,
  schedulePointsSummary,
  schedulePriceRange,
  scheduleStopTimes,
  vehicleLabelFor,
} from "./brand-tree-helpers";
import type { BrandTreeCallbacks } from "./brand-tree-table";
import { IconAction, RowActions } from "./tree-parts";

export function ScheduleRow({
  schedule,
  route,
  brand,
  callbacks,
}: {
  schedule: AdminScheduleOut;
  route: AdminRouteOut;
  brand: AdminBrandOut;
  callbacks: BrandTreeCallbacks;
}) {
  const t = useT();
  const chips = dayChips(schedule.daysOfWeek);
  return (
    <TableRow data-testid={`schedule-row-${schedule.id}`} className="hover:bg-muted/40">
      <TableCell className="px-3 py-2">
        <Clock className="ml-9 h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums">
            {schedule.departureTime}
          </span>
          {scheduleStopTimes(schedule) && (
            <span className="text-[11px] text-muted-foreground">
              ({scheduleStopTimes(schedule)})
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{vehicleLabelFor(schedule)}</div>
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1" title={daysLabel(schedule.daysOfWeek)}>
          {chips.map((c) => (
            <span
              key={c.label}
              className={cn(
                "inline-flex h-5 min-w-6 items-center justify-center rounded px-1 text-[10px] font-medium",
                c.active
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "bg-muted text-muted-foreground/50",
              )}
            >
              {c.label}
            </span>
          ))}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{effectiveWindow(schedule)}</div>
      </TableCell>
      <TableCell className="px-3 py-2 text-xs text-muted-foreground">—</TableCell>
      <TableCell className="px-3 py-2 text-right">
        <div className="font-semibold tabular-nums">
          {(() => {
            const [min, max] = schedulePriceRange(schedule);
            return min === max ? formatVND(min) : `${formatVND(min)} – ${formatVND(max)}`;
          })()}
        </div>
        {schedule.basePriceChild != null && schedule.basePriceChild > 0 && (
          <div className="text-[11px] text-muted-foreground">
            {t("adminBrands.childPrice", { price: formatVND(schedule.basePriceChild) })}
          </div>
        )}
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="max-w-72 truncate text-xs" title={schedulePointsSummary(schedule)}>
          {schedulePointsSummary(schedule)}
        </div>
      </TableCell>
      <TableCell className="px-3 py-2">
        <RowActions>
          <IconAction
            label={t("adminBrands.editScheduleOf", {
              time: schedule.departureTime,
              name: route.name,
            })}
            onClick={() => callbacks.onEditSchedule(schedule, route, brand)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </IconAction>
          <IconAction
            label={t("adminBrands.deleteScheduleOf", {
              time: schedule.departureTime,
              name: route.name,
            })}
            danger
            onClick={() => callbacks.onDeleteSchedule(schedule, route)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconAction>
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

/* ── Shared bits ────────────────────────────────────────────── */

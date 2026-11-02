"use client";

/** A route row of the brands tree, expanding to its schedules (loaded on first open). */

import { useQuery } from "@tanstack/react-query";
import { adminSchedulesListOptions } from "@spa/api";
import { useMemo } from "react";
import { Route as RouteIcon, Clock, Plus, Pencil, Trash2, MapPin, Loader2 } from "lucide-react";
import { Badge } from "@spa/components/ui/badge";
import { Button } from "@spa/components/ui/button";
import { TableCell, TableRow } from "@spa/components/ui/table";
import { useT } from "@spa/lib/i18n";
import type { AdminBrandOut, AdminRouteOut, AdminScheduleOut } from "@spa/api";
import { cn } from "@spa/lib/utils";
import { routeDirection, sortSchedules, type ScheduleSort } from "./brand-tree-helpers";
import type { BrandTreeCallbacks } from "./brand-tree-table";
import { ScheduleRow } from "./schedule-row";
import { Expander, IconAction, RowActions } from "./tree-parts";

export function RouteNode({
  route,
  brand,
  expanded,
  onToggle,
  scheduleSort,
  callbacks,
}: {
  route: AdminRouteOut;
  brand: AdminBrandOut;
  expanded: boolean;
  onToggle: () => void;
  scheduleSort: ScheduleSort | null;
  callbacks: BrandTreeCallbacks;
}) {
  const t = useT();
  const schedulesQuery = useQuery({
    ...adminSchedulesListOptions({ query: { routeId: route.id } }),
    enabled: expanded,
  });
  const sorted = useMemo(() => {
    const schedules = (schedulesQuery.data?.items ?? []) as unknown as AdminScheduleOut[];
    return scheduleSort ? sortSchedules(schedules, scheduleSort) : schedules;
  }, [schedulesQuery.data, scheduleSort]);

  return (
    <>
      <TableRow
        data-testid={`route-row-${route.id}`}
        className={cn(
          "bg-slate-50/60 hover:bg-slate-100/60 dark:bg-slate-900/30",
          expanded && "border-b-0",
        )}
      >
        <TableCell className="px-3 py-2.5">
          <Expander
            expanded={expanded}
            disabled={route.scheduleCount === 0}
            onToggle={onToggle}
            label={t("adminBrands.expandSchedules", { name: route.name })}
            small
          />
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <RouteIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="font-medium">{route.name}</span>
            <code className="hidden font-mono text-[10px] text-muted-foreground xl:inline">
              {route.id.slice(0, 8)}
            </code>
          </div>
        </TableCell>
        <TableCell className="px-3 py-2.5 text-xs">{routeDirection(route)}</TableCell>
        <TableCell className="px-3 py-2.5">
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Clock className="h-3 w-3" aria-hidden />{" "}
            {t("brands.schedulesCount", { count: route.scheduleCount })}
          </Badge>
        </TableCell>
        <TableCell className="px-3 py-2.5" />
        <TableCell className="px-3 py-2.5">
          <Badge variant="outline" className="gap-1 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3" aria-hidden />{" "}
            {t("brands.pointsCount", { count: route.pickupPointCount })}
          </Badge>
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <RowActions>
            <IconAction
              label={t("brands.addScheduleFor", { name: route.name })}
              onClick={() => callbacks.onAddSchedule(route, brand)}
            >
              <Plus className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction
              label={t("adminBrands.pointsOfRoute", { name: route.name })}
              onClick={() => callbacks.onPickupPoints(route)}
            >
              <MapPin className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction
              label={t("brands.editRoute", { name: route.name })}
              onClick={() => callbacks.onEditRoute(route, brand)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction
              label={t("brands.deleteRoute", { name: route.name })}
              danger
              onClick={() => callbacks.onDeleteRoute(route)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconAction>
          </RowActions>
        </TableCell>
      </TableRow>

      {expanded && (
        <>
          {schedulesQuery.isLoading ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="px-3 py-0">
                <div className="flex items-center gap-2 border-l-2 border-slate-300 py-2.5 pl-16 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />{" "}
                  {t("adminBrands.loadingSchedules")}
                </div>
              </TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="px-3 py-0">
                <div className="flex items-center justify-between gap-2 border-l-2 border-slate-300 py-2 pl-16 pr-3">
                  <span className="text-xs text-muted-foreground">
                    {t("adminBrands.noSchedulesYet")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => callbacks.onAddSchedule(route, brand)}
                  >
                    <Plus className="h-3.5 w-3.5" /> {t("adminBrands.addSchedule")}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                route={route}
                brand={brand}
                callbacks={callbacks}
              />
            ))
          )}
        </>
      )}
    </>
  );
}

/* ── Level 3: schedule row ──────────────────────────────────── */

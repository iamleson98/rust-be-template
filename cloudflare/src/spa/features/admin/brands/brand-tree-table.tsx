"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { adminRoutesListOptions } from "@spa/api";
import { useMemo } from "react";
import { Building2, Route as RouteIcon, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Badge } from "@spa/components/ui/badge";
import { Button } from "@spa/components/ui/button";
import { Shimmer } from "@spa/components/ui/shimmer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@spa/components/ui/table";
import { useT } from "@spa/lib/i18n";
import type { AdminBrandOut, AdminRouteOut, AdminScheduleOut } from "@spa/api";
import { cn } from "@spa/lib/utils";
import type { ScheduleSort } from "./brand-tree-helpers";
import { RouteNode } from "./route-node";
import { BrandLogoTile, Expander, IconAction, RowActions } from "./tree-parts";

export type BrandTreeCallbacks = {
  onAddRoute: (brand: AdminBrandOut) => void;
  onEditRoute: (route: AdminRouteOut, brand: AdminBrandOut) => void;
  onDeleteRoute: (route: AdminRouteOut) => void;
  onAddSchedule: (route: AdminRouteOut, brand: AdminBrandOut) => void;
  onEditSchedule: (schedule: AdminScheduleOut, route: AdminRouteOut, brand: AdminBrandOut) => void;
  onDeleteSchedule: (schedule: AdminScheduleOut, route: AdminRouteOut) => void;
  onPickupPoints: (route: AdminRouteOut) => void;
  onEditBrand: (brand: AdminBrandOut) => void;
  onDeleteBrand: (brand: AdminBrandOut) => void;
};

type BrandTreeTableProps = {
  brands: AdminBrandOut[];
  brandsLoading: boolean;
  expandedBrands: Set<string>;
  onToggleBrand: (brandId: string) => void;
  expandedRoutes: Set<string>;
  onToggleRoute: (routeId: string) => void;
  scheduleSort: ScheduleSort | null;
  /** Routes matching the smart start/end filter (one parent-level
   *  server query). `null` = filter off → routes load lazily per
   *  expanded brand instead. */
  filteredRoutes: AdminRouteOut[] | null;
  callbacks: BrandTreeCallbacks;
  /** Free-text brand search (applied by the parent, listed here for
   *  the empty-state message). */
  hasSearch: boolean;
  hasLocationFilter: boolean;
};

export function BrandTreeTable({
  brands,
  brandsLoading,
  expandedBrands,
  onToggleBrand,
  expandedRoutes,
  onToggleRoute,
  scheduleSort,
  filteredRoutes,
  callbacks,
  hasSearch,
  hasLocationFilter,
}: BrandTreeTableProps) {
  const t = useT();
  if (brandsLoading) {
    return (
      <div
        className="overflow-hidden rounded-lg border bg-card"
        role="status"
        aria-busy="true"
        aria-label={t("adminBrands.loadingBrands")}
      >
        <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
          <Shimmer className="h-4 w-36" />
          <Shimmer className="h-4 w-24" />
          <Shimmer className="h-4 w-20 hidden sm:block" />
          <div className="flex-1" />
          <Shimmer className="h-4 w-16" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b last:border-b-0 px-4 py-4">
            <Shimmer className="h-5 w-6" />
            <Shimmer className="h-5 w-44" />
            <Shimmer className="h-5 w-28" />
            <Shimmer className="h-5 w-16 hidden sm:block" />
            <div className="flex-1" />
            <Shimmer className="h-7 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center">
          <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Building2 className="size-5" aria-hidden />
          </div>
          <p className="text-sm font-medium">
            {hasSearch || hasLocationFilter ? t("adminBrands.emptyFiltered") : t("brands.emptyAll")}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {hasSearch || hasLocationFilter
              ? t("adminBrands.emptyFilteredHint")
              : t("adminBrands.emptyAllHint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* Phones: no sideways table — the header hides and every row (brand,
          route, schedule) becomes a wrapping line of its cells. */}
      <div className="md:overflow-x-auto">
        <Table className="md:min-w-210 max-md:block max-md:[&_tbody]:block max-md:[&_thead]:hidden max-md:[&_tr]:flex max-md:[&_tr]:flex-wrap max-md:[&_tr]:items-center max-md:[&_tr]:gap-x-1 max-md:[&_tr]:px-1 max-md:[&_tr]:py-1.5 max-md:[&_td]:block max-md:[&_td]:px-1.5 max-md:[&_td]:py-1 max-md:[&_td:empty]:hidden">
          <TableHeader>
            <TableRow className="border-border/60 bg-muted/50 hover:bg-muted/50">
              <TableHead
                scope="col"
                className="h-10 w-28 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("brandLogo.label")}
              </TableHead>
              <TableHead
                scope="col"
                className="h-10 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("common.name")}
              </TableHead>
              <TableHead
                scope="col"
                className="h-10 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("common.details")}
              </TableHead>
              <TableHead
                scope="col"
                className="h-10 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("adminBrands.colSchedules")}
              </TableHead>
              <TableHead
                scope="col"
                className="h-10 bg-transparent px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("search.sort.price")}
              </TableHead>
              <TableHead
                scope="col"
                className="h-10 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("adminBrands.colPoints")}
              </TableHead>
              <TableHead
                scope="col"
                className="h-10 bg-transparent px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("common.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.map((brand) => (
              <BrandNode
                key={brand.id}
                brand={brand}
                expanded={expandedBrands.has(brand.id)}
                onToggle={() => onToggleBrand(brand.id)}
                expandedRoutes={expandedRoutes}
                onToggleRoute={onToggleRoute}
                scheduleSort={scheduleSort}
                filteredRoutes={filteredRoutes}
                callbacks={callbacks}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ── Level 1: brand row + its route subtree ─────────────────── */

function BrandNode({
  brand,
  expanded,
  onToggle,
  expandedRoutes,
  onToggleRoute,
  scheduleSort,
  filteredRoutes,
  callbacks,
}: {
  brand: AdminBrandOut;
  expanded: boolean;
  onToggle: () => void;
  expandedRoutes: Set<string>;
  onToggleRoute: (routeId: string) => void;
  scheduleSort: ScheduleSort | null;
  filteredRoutes: AdminRouteOut[] | null;
  callbacks: BrandTreeCallbacks;
}) {
  const t = useT();
  // Smart filter active → the parent already fetched the matching
  // routes across brands (one query); slice this brand's share and
  // never fetch again. Otherwise fetch lazily on expansion.
  const shouldFetch = expanded && !filteredRoutes;
  const routesQuery = useQuery({
    ...adminRoutesListOptions({ query: { brandId: brand.id } }),
    enabled: shouldFetch,
    placeholderData: keepPreviousData,
  });
  const visibleRoutes = useMemo(
    () =>
      filteredRoutes
        ? filteredRoutes.filter((r) => r.brandId === brand.id)
        : ((routesQuery.data?.items ?? []) as unknown as AdminRouteOut[]),
    [filteredRoutes, brand.id, routesQuery.data],
  );

  const expandable = filteredRoutes ? visibleRoutes.length > 0 : brand.routeCount > 0;

  return (
    <>
      <TableRow
        data-testid={`brand-row-${brand.slug}`}
        className={cn(
          "bg-blue-50/40 hover:bg-blue-50/60 dark:bg-blue-950/20",
          expanded && "border-b-0",
        )}
      >
        <TableCell className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            <Expander
              expanded={expandable && expanded}
              disabled={!expandable}
              onToggle={onToggle}
              label={t("brands.expandRoutes", { name: brand.name })}
            />
            <BrandLogoTile logoUrl={brand.logoUrl} name={brand.name} />
          </div>
        </TableCell>
        <TableCell className="px-3 py-3">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold">{brand.name}</span>
            <Badge
              variant="outline"
              className="hidden lg:inline-flex text-[10px] text-muted-foreground"
            >
              {brand.slug}
            </Badge>
          </div>
          {(brand.contactPhone || brand.contactEmail) && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {brand.contactPhone}
              {brand.contactPhone && brand.contactEmail ? " · " : ""}
              {brand.contactEmail}
            </div>
          )}
        </TableCell>
        <TableCell className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="gap-1 text-[11px]">
              <RouteIcon className="h-3 w-3" aria-hidden />{" "}
              {t("brands.routesCount", { count: brand.routeCount })}
            </Badge>
            <Badge variant="secondary" className="text-[11px]">
              {t("brands.layoutsCount", { count: brand.layoutCount })}
            </Badge>
            {brand.rating != null && brand.rating > 0 && (
              <Badge variant="outline" className="text-[11px]">
                ★ {brand.rating.toFixed(1)}
              </Badge>
            )}
          </div>
        </TableCell>
        {/* Routes load when the brand expands; each shows its own schedules. */}
        <TableCell className="px-3 py-3" />
        <TableCell className="px-3 py-3" />
        <TableCell className="px-3 py-3" />
        <TableCell className="px-3 py-3">
          <RowActions>
            <IconAction
              label={t("brands.addRouteFor", { name: brand.name })}
              onClick={() => callbacks.onAddRoute(brand)}
            >
              <Plus className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction
              label={t("brands.editBrand", { name: brand.name })}
              onClick={() => callbacks.onEditBrand(brand)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction
              label={t("brands.deleteBrand", { name: brand.name })}
              danger
              onClick={() => callbacks.onDeleteBrand(brand)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconAction>
          </RowActions>
        </TableCell>
      </TableRow>

      {expanded && (
        <>
          {routesQuery.isLoading ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="px-3 py-0">
                <div className="flex items-center gap-2 border-l-2 border-blue-200 py-3 pl-10 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />{" "}
                  {t("adminBrands.loadingRoutes")}
                </div>
              </TableCell>
            </TableRow>
          ) : visibleRoutes.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="px-3 py-0">
                <div className="flex items-center justify-between gap-2 border-l-2 border-blue-200 py-2.5 pl-10 pr-3">
                  <span className="text-xs text-muted-foreground">
                    {t("adminBrands.noRoutesYet")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => callbacks.onAddRoute(brand)}
                  >
                    <Plus className="h-3.5 w-3.5" /> {t("adminRoutes.addRoute")}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            visibleRoutes.map((route) => (
              <RouteNode
                key={route.id}
                route={route}
                brand={brand}
                expanded={expandedRoutes.has(route.id)}
                onToggle={() => onToggleRoute(route.id)}
                scheduleSort={scheduleSort}
                callbacks={callbacks}
              />
            ))
          )}
        </>
      )}
    </>
  );
}

/* ── Level 2: route row + its schedule subtree ──────────────── */

'use client'

/**
 * BrandTreeTable — the /admin/brands subtree table.
 *
 * Three nesting levels as expandable rows:
 *   1. brands  (từ useAdminBrands)
 *   2. routes  (lazy — fetched by <BrandRow> only when the brand expands,
 *               or pre-filtered by the start/end smart filter)
 *   3. schedules (lazy — fetched by <RouteRow> only when the route expands)
 *
 * Expansion state lives in the parent (`index.tsx`) so the smart filter
 * can auto-expand matching brands. Sorting applies WITHIN each route
 * group (schedule rows never interleave with route/brand rows).
 */

import { useMemo } from 'react'
import { ChevronRight, Building2, Route as RouteIcon, Clock, Plus, Pencil, Trash2, MapPin, Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Shimmer } from '@/components/ui/shimmer'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useT } from '@/lib/i18n'
import { useAdminRoutes, useAdminSchedules } from '@/lib/queries'
import { formatVND } from '@/lib/types'
import type { AdminBrandOut, AdminRouteOut, AdminScheduleOut } from '@/lib/api/types.gen'
import { cn } from '@/lib/utils'
import {
  dayChips,
  daysLabel,
  effectiveWindow,
  routeDirection,
  schedulePointsSummary,
  scheduleStopTimes,
  sortSchedules,
  vehicleLabelFor,
  type ScheduleSort,
} from './brand-tree-helpers'

export type BrandTreeCallbacks = {
  onAddRoute: (brand: AdminBrandOut) => void
  onEditRoute: (route: AdminRouteOut, brand: AdminBrandOut) => void
  onDeleteRoute: (route: AdminRouteOut) => void
  onAddSchedule: (route: AdminRouteOut, brand: AdminBrandOut) => void
  onEditSchedule: (schedule: AdminScheduleOut, route: AdminRouteOut, brand: AdminBrandOut) => void
  onDeleteSchedule: (schedule: AdminScheduleOut, route: AdminRouteOut) => void
  onPickupPoints: (route: AdminRouteOut) => void
  onEditBrand: (brand: AdminBrandOut) => void
  onDeleteBrand: (brand: AdminBrandOut) => void
}

type BrandTreeTableProps = {
  brands: AdminBrandOut[]
  brandsLoading: boolean
  expandedBrands: Set<string>
  onToggleBrand: (brandId: string) => void
  expandedRoutes: Set<string>
  onToggleRoute: (routeId: string) => void
  scheduleSort: ScheduleSort | null
  /** Routes matching the smart start/end filter (one parent-level
   *  server query). `null` = filter off → routes load lazily per
   *  expanded brand instead. */
  filteredRoutes: AdminRouteOut[] | null
  callbacks: BrandTreeCallbacks
  /** Free-text brand search (applied by the parent, listed here for
   *  the empty-state message). */
  hasSearch: boolean
  hasLocationFilter: boolean
}

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
  const t = useT()
  if (brandsLoading) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card" role="status" aria-busy="true" aria-label={t('adminBrands.loadingBrands')}>
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
    )
  }

  if (brands.length === 0) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center">
          <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Building2 className="size-5" aria-hidden />
          </div>
          <p className="text-sm font-medium">
            {hasSearch || hasLocationFilter
              ? t('adminBrands.emptyFiltered')
              : t('brands.emptyAll')}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {hasSearch || hasLocationFilter
              ? t('adminBrands.emptyFilteredHint')
              : t('adminBrands.emptyAllHint')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <Table className="min-w-210">
          <TableHeader>
            <TableRow className="border-border/60 bg-muted/50 hover:bg-muted/50">
              <TableHead scope="col" className="h-10 w-16 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" />
              <TableHead scope="col" className="h-10 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('common.name')}
              </TableHead>
              <TableHead scope="col" className="h-10 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('common.details')}
              </TableHead>
              <TableHead scope="col" className="h-10 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('adminBrands.colSchedules')}
              </TableHead>
              <TableHead scope="col" className="h-10 bg-transparent px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('search.sort.price')}
              </TableHead>
              <TableHead scope="col" className="h-10 bg-transparent px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('adminBrands.colPoints')}
              </TableHead>
              <TableHead scope="col" className="h-10 bg-transparent px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('common.actions')}
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
  )
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
  brand: AdminBrandOut
  expanded: boolean
  onToggle: () => void
  expandedRoutes: Set<string>
  onToggleRoute: (routeId: string) => void
  scheduleSort: ScheduleSort | null
  filteredRoutes: AdminRouteOut[] | null
  callbacks: BrandTreeCallbacks
}) {
  const t = useT()
  // Smart filter active → the parent already fetched the matching
  // routes across brands (one query); slice this brand's share and
  // never fetch again. Otherwise fetch lazily on expansion.
  const shouldFetch = expanded && !filteredRoutes
  const routesQuery = useAdminRoutes(shouldFetch ? { brandId: brand.id } : undefined)
  const visibleRoutes = useMemo(
    () =>
      filteredRoutes
        ? filteredRoutes.filter((r) => r.brandId === brand.id)
        : ((routesQuery.data?.items ?? []) as unknown as AdminRouteOut[]),
    [filteredRoutes, brand.id, routesQuery.data],
  )

  const expandable = filteredRoutes ? visibleRoutes.length > 0 : brand.routeCount > 0

  return (
    <>
      <TableRow
        data-testid={`brand-row-${brand.slug}`}
        className={cn('bg-blue-50/40 hover:bg-blue-50/60 dark:bg-blue-950/20', expanded && 'border-b-0')}
      >
        <TableCell className="px-3 py-3">
          <Expander expanded={expandable && expanded} disabled={!expandable} onToggle={onToggle} label={t('brands.expandRoutes', { name: brand.name })} />
        </TableCell>
        <TableCell className="px-3 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: brand.accentColor ?? '#94a3b8' }}
              aria-hidden
            />
            <span className="font-semibold">{brand.name}</span>
            <Badge variant="outline" className="hidden lg:inline-flex text-[10px] text-muted-foreground">
              {brand.slug}
            </Badge>
          </div>
          {(brand.contactPhone || brand.contactEmail) && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {brand.contactPhone}
              {brand.contactPhone && brand.contactEmail ? ' · ' : ''}
              {brand.contactEmail}
            </div>
          )}
        </TableCell>
        <TableCell className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="gap-1 text-[11px]">
              <RouteIcon className="h-3 w-3" aria-hidden /> {t('brands.routesCount', { count: brand.routeCount })}
            </Badge>
            <Badge variant="secondary" className="text-[11px]">{t('brands.layoutsCount', { count: brand.layoutCount })}</Badge>
            {brand.rating != null && brand.rating > 0 && (
              <Badge variant="outline" className="text-[11px]">★ {brand.rating.toFixed(1)}</Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="px-3 py-3 text-xs text-muted-foreground">{t('brands.tripsCount', { count: brand.totalTrips })}</TableCell>
        <TableCell className="px-3 py-3" />
        <TableCell className="px-3 py-3" />
        <TableCell className="px-3 py-3">
          <RowActions>
            <IconAction label={t('brands.addRouteFor', { name: brand.name })} onClick={() => callbacks.onAddRoute(brand)}>
              <Plus className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label={t('brands.editBrand', { name: brand.name })} onClick={() => callbacks.onEditBrand(brand)}>
              <Pencil className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label={t('brands.deleteBrand', { name: brand.name })} danger onClick={() => callbacks.onDeleteBrand(brand)}>
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
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /> {t('adminBrands.loadingRoutes')}
                </div>
              </TableCell>
            </TableRow>
          ) : visibleRoutes.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="px-3 py-0">
                <div className="flex items-center justify-between gap-2 border-l-2 border-blue-200 py-2.5 pl-10 pr-3">
                  <span className="text-xs text-muted-foreground">{t('adminBrands.noRoutesYet')}</span>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => callbacks.onAddRoute(brand)}>
                    <Plus className="h-3.5 w-3.5" /> {t('adminRoutes.addRoute')}
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
  )
}

/* ── Level 2: route row + its schedule subtree ──────────────── */

function RouteNode({
  route,
  brand,
  expanded,
  onToggle,
  scheduleSort,
  callbacks,
}: {
  route: AdminRouteOut
  brand: AdminBrandOut
  expanded: boolean
  onToggle: () => void
  scheduleSort: ScheduleSort | null
  callbacks: BrandTreeCallbacks
}) {
  const t = useT()
  const schedulesQuery = useAdminSchedules(expanded ? route.id : undefined)
  const sorted = useMemo(() => {
    const schedules = (schedulesQuery.data?.items ?? []) as unknown as AdminScheduleOut[]
    return scheduleSort ? sortSchedules(schedules, scheduleSort) : schedules
  }, [schedulesQuery.data, scheduleSort])

  return (
    <>
      <TableRow
        data-testid={`route-row-${route.id}`}
        className={cn('bg-slate-50/60 hover:bg-slate-100/60 dark:bg-slate-900/30', expanded && 'border-b-0')}
      >
        <TableCell className="px-3 py-2.5">
          <Expander
            expanded={expanded}
            disabled={route.scheduleCount === 0}
            onToggle={onToggle}
            label={t('adminBrands.expandSchedules', { name: route.name })}
            small
          />
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <RouteIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="font-medium">{route.name}</span>
            <code className="hidden font-mono text-[10px] text-muted-foreground xl:inline">{route.id.slice(0, 8)}</code>
          </div>
        </TableCell>
        <TableCell className="px-3 py-2.5 text-xs">{routeDirection(route)}</TableCell>
        <TableCell className="px-3 py-2.5">
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Clock className="h-3 w-3" aria-hidden /> {t('brands.schedulesCount', { count: route.scheduleCount })}
          </Badge>
        </TableCell>
        <TableCell className="px-3 py-2.5" />
        <TableCell className="px-3 py-2.5">
          <Badge variant="outline" className="gap-1 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3" aria-hidden /> {t('brands.pointsCount', { count: route.pickupPointCount })}
          </Badge>
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <RowActions>
            <IconAction label={t('brands.addScheduleFor', { name: route.name })} onClick={() => callbacks.onAddSchedule(route, brand)}>
              <Plus className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label={t('adminBrands.pointsOfRoute', { name: route.name })} onClick={() => callbacks.onPickupPoints(route)}>
              <MapPin className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label={t('brands.editRoute', { name: route.name })} onClick={() => callbacks.onEditRoute(route, brand)}>
              <Pencil className="h-3.5 w-3.5" />
            </IconAction>
            <IconAction label={t('brands.deleteRoute', { name: route.name })} danger onClick={() => callbacks.onDeleteRoute(route)}>
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
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /> {t('adminBrands.loadingSchedules')}
                </div>
              </TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="px-3 py-0">
                <div className="flex items-center justify-between gap-2 border-l-2 border-slate-300 py-2 pl-16 pr-3">
                  <span className="text-xs text-muted-foreground">{t('adminBrands.noSchedulesYet')}</span>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => callbacks.onAddSchedule(route, brand)}>
                    <Plus className="h-3.5 w-3.5" /> {t('adminBrands.addSchedule')}
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
  )
}

/* ── Level 3: schedule row ──────────────────────────────────── */

function ScheduleRow({
  schedule,
  route,
  brand,
  callbacks,
}: {
  schedule: AdminScheduleOut
  route: AdminRouteOut
  brand: AdminBrandOut
  callbacks: BrandTreeCallbacks
}) {
  const t = useT()
  const chips = dayChips(schedule.daysOfWeek)
  return (
    <TableRow
      data-testid={`schedule-row-${schedule.id}`}
      className="hover:bg-muted/40"
    >
      <TableCell className="px-3 py-2">
        <Clock className="ml-9 h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums">{schedule.departureTime}</span>
          {scheduleStopTimes(schedule) && (
            <span className="text-[11px] text-muted-foreground">({scheduleStopTimes(schedule)})</span>
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
                'inline-flex h-5 min-w-6 items-center justify-center rounded px-1 text-[10px] font-medium',
                c.active ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'bg-muted text-muted-foreground/50',
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
        <div className="font-semibold tabular-nums">{formatVND(schedule.basePriceAdult)}</div>
        {schedule.basePriceChild != null && schedule.basePriceChild > 0 && (
          <div className="text-[11px] text-muted-foreground">{t('adminBrands.childPrice', { price: formatVND(schedule.basePriceChild) })}</div>
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
            label={t('adminBrands.editScheduleOf', { time: schedule.departureTime, name: route.name })}
            onClick={() => callbacks.onEditSchedule(schedule, route, brand)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </IconAction>
          <IconAction
            label={t('adminBrands.deleteScheduleOf', { time: schedule.departureTime, name: route.name })}
            danger
            onClick={() => callbacks.onDeleteSchedule(schedule, route)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconAction>
        </RowActions>
      </TableCell>
    </TableRow>
  )
}

/* ── Shared bits ────────────────────────────────────────────── */

function Expander({
  expanded,
  disabled,
  onToggle,
  label,
  small,
}: {
  expanded: boolean
  disabled?: boolean
  onToggle: () => void
  label: string
  small?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-expanded={expanded}
      aria-label={label}
      className={cn(
        'flex items-center justify-center rounded transition-colors',
        small ? 'h-6 w-6' : 'h-7 w-7',
        disabled ? 'text-muted-foreground/30' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <ChevronRight
        className={cn('transition-transform', small ? 'h-3.5 w-3.5' : 'h-4 w-4', expanded && 'rotate-90')}
        aria-hidden
      />
    </button>
  )
}

function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-0.5">{children}</div>
}

function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded transition-colors',
        danger
          ? 'text-muted-foreground hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

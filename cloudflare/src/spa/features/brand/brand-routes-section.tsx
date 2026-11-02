import { ArrowRight, ChevronDown, Clock, Route as RouteIcon, Search } from "lucide-react";
import { Badge } from "@spa/components/ui/badge";
import { Button } from "@spa/components/ui/button";
import { Card, CardContent, CardFooter } from "@spa/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@spa/components/ui/collapsible";
import { HomeSection } from "@spa/features/home/section";
import { useT } from "@spa/lib/i18n";
import { useMoney } from "@spa/lib/format";
import type { ProfileRoute } from "./api";
import { SECTION_IDS, SECTION_SCROLL_MARGIN, useDaysLabel } from "./brand-format";

/** Departure times shown on the card; the rest are one tap away in the details. */
const TIME_CHIPS = 6;

function RouteCard({ route, onSearch }: { route: ProfileRoute; onSearch: () => void }) {
  const t = useT();
  const money = useMoney();
  const days = useDaysLabel();
  const { schedules } = route;
  const prices = schedules.map((s) => s.priceAdult);
  const low = prices.length ? Math.min(...prices) : null;
  const high = prices.length ? Math.max(...prices) : null;
  // Schedules arrive sorted by departure time.
  const times = [...new Set(schedules.map((s) => s.departureTime))];
  const vehicles = [...new Set(schedules.flatMap((s) => (s.vehicleType ? [s.vehicleType] : [])))];

  return (
    <Card className="gap-3 pb-3">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-x-2 text-base font-semibold text-slate-900">
              <span>{route.from.name}</span>
              <ArrowRight className="size-4 shrink-0 text-primary" />
              <span>{route.to.name}</span>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {[t("brandDetail.tripsPerDayCount", { count: schedules.length }), ...vehicles].join(
                " · ",
              )}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {low != null && high != null ? (
              <>
                <div className="text-xs text-slate-500">{t("brandPage.fareLabel")}</div>
                <div className="font-bold text-primary tabular-nums">{money(low)}</div>
                {high > low && (
                  <div className="text-xs text-slate-400 tabular-nums">– {money(high)}</div>
                )}
              </>
            ) : (
              <span className="text-xs text-slate-500">{t("brandPage.noPrice")}</span>
            )}
          </div>
        </div>

        {times.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-xs text-slate-500">
              <Clock className="size-3" />
              {times.length === 1
                ? t("brandPage.departAt", { time: times[0] })
                : t("brandPage.departWindow", { first: times[0], last: times[times.length - 1] })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {times.slice(0, TIME_CHIPS).map((time) => (
                <Badge key={time} variant="secondary" className="tabular-nums">
                  {time}
                </Badge>
              ))}
              {times.length > TIME_CHIPS && (
                <Badge variant="outline">
                  {t("brandPage.moreTimes", { count: times.length - TIME_CHIPS })}
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <Collapsible className="border-t pt-3">
        <CardFooter className="gap-2">
          {schedules.length > 0 && (
            <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-medium text-primary [&[data-panel-open]>svg]:rotate-180">
              {t("brandPage.timetableDetails")}
              <ChevronDown className="size-3.5 transition-transform" />
            </CollapsibleTrigger>
          )}
          <Button size="sm" className="ml-auto" onClick={onSearch}>
            <Search />
            {t("nav.searchTrips")}
          </Button>
        </CardFooter>
        <CollapsibleContent>
          <ul className="mx-5 mt-2 divide-y divide-slate-100">
            {schedules.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-12 shrink-0 font-semibold text-slate-900 tabular-nums">
                  {s.departureTime}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                  {[s.vehicleType, days(s.daysOfWeek)].filter(Boolean).join(" · ")}
                </span>
                <span className="shrink-0 font-medium text-slate-700 tabular-nums">
                  {money(s.priceAdult)}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** The routes the brand runs: fares, departure times and a search for tomorrow. */
export function BrandRoutesSection({
  routes,
  onSearch,
}: {
  routes: ProfileRoute[];
  onSearch: (route: ProfileRoute) => void;
}) {
  const t = useT();
  return (
    <HomeSection
      id={SECTION_IDS.routes}
      className={SECTION_SCROLL_MARGIN}
      title={t("brandPage.routesTitle")}
      subtitle={t("brandPage.routesSubtitle")}
    >
      {routes.length === 0 ? (
        <Card className="items-center gap-1 py-10 text-center">
          <RouteIcon className="size-8 text-slate-300" />
          <p className="font-medium text-slate-900">{t("brandDetail.noRoutesTitle")}</p>
          <p className="text-sm text-slate-500">{t("brandDetail.noRoutesSubtitle")}</p>
        </Card>
      ) : (
        <ul className="grid items-start gap-3 md:grid-cols-2">
          {routes.map((r) => (
            <li key={r.id} className="min-w-0">
              <RouteCard route={r} onSearch={() => onSearch(r)} />
            </li>
          ))}
        </ul>
      )}
    </HomeSection>
  );
}

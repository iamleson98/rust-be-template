import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Badge } from "@spa/components/ui/badge";
import { Card } from "@spa/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@spa/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@spa/components/ui/tabs";
import { HomeSection } from "@spa/features/home/section";
import { useT } from "@spa/lib/i18n";
import { useMoney } from "@spa/lib/format";
import { cn } from "@spa/lib/utils";
import type { ProfileRoute, ProfileTrip } from "./api";
import { SECTION_IDS, SECTION_SCROLL_MARGIN, useDayLabel } from "./brand-format";

/** Days of departures the server lists (`UPCOMING_DAYS` in `services/brand-profile.ts`). */
const UPCOMING_DAYS = 3;
/** Seats left at or under which a trip is flagged as almost full. */
const FEW_SEATS = 5;
/** The route filter's "every route" value. */
const ALL = "all";

function SeatBadge({ seats }: { seats: number }) {
  const t = useT();
  if (seats <= 0) return <Badge variant="destructive">{t("brandPage.soldOut")}</Badge>;
  if (seats <= FEW_SEATS)
    return (
      <Badge className="border-transparent bg-amber-100 text-amber-800">
        {t("brandPage.fewSeats", { count: seats })}
      </Badge>
    );
  return <Badge variant="secondary">{t("brandPage.seatsLeft", { count: seats })}</Badge>;
}

function TripRow({ trip, route }: { trip: ProfileTrip; route: ProfileRoute | undefined }) {
  const money = useMoney();
  const soldOut = trip.availableSeats <= 0;
  return (
    <li>
      <Link
        to="/trips/$tripId"
        params={{ tripId: trip.tripId }}
        className={cn(
          "group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50",
          soldOut && "opacity-60",
        )}
      >
        <span className="w-14 shrink-0 text-lg font-bold text-slate-900 tabular-nums">
          {trip.departureTime}
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-slate-900">
            <span>{route?.from.name}</span>
            <ArrowRight className="size-3.5 shrink-0 text-primary" />
            <span>{route?.to.name}</span>
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {trip.vehicleType && <span className="truncate">{trip.vehicleType}</span>}
            <SeatBadge seats={trip.availableSeats} />
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 font-semibold tabular-nums",
            soldOut ? "text-slate-400 line-through" : "text-primary",
          )}
        >
          {money(trip.priceAdult)}
        </span>
        <ChevronRight className="size-4 shrink-0 text-slate-300 group-hover:text-primary" />
      </Link>
    </li>
  );
}

/**
 * The trips about to leave: a tab per day, narrowed to one route when the
 * brand runs several, each opening its booking page.
 */
export function BrandTripsSection({
  trips,
  routes,
}: {
  trips: ProfileTrip[];
  routes: ProfileRoute[];
}) {
  const t = useT();
  const dayLabel = useDayLabel();
  const [routeId, setRouteId] = useState(ALL);
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const routesWithTrips = routes.filter((r) => trips.some((x) => x.routeId === r.id));
  const matching = trips.filter((x) => routeId === ALL || x.routeId === routeId);
  const days = [...new Set(trips.map((x) => x.date))];
  const routeOptions = [
    { value: ALL, label: t("brandPage.allRoutes") },
    ...routesWithTrips.map((r) => ({ value: r.id, label: `${r.from.name} → ${r.to.name}` })),
  ];

  return (
    <HomeSection
      id={SECTION_IDS.trips}
      className={SECTION_SCROLL_MARGIN}
      title={t("brandPage.tripsTitle")}
      subtitle={t("brandPage.tripsSubtitle", { days: UPCOMING_DAYS })}
    >
      {trips.length === 0 ? (
        <Card className="px-5 text-center text-sm text-slate-500">
          {t("brandPage.noTrips", { days: UPCOMING_DAYS })}
        </Card>
      ) : (
        <Tabs defaultValue={days[0]} className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="max-w-full overflow-x-auto [scrollbar-width:none]">
              {days.map((d) => (
                <TabsTrigger key={d} value={d} className="gap-1.5">
                  {dayLabel(d)}
                  <Badge variant="secondary" className="px-1.5 tabular-nums">
                    {matching.filter((x) => x.date === d).length}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
            {routesWithTrips.length > 1 && (
              <Select value={routeId} onValueChange={setRouteId} items={routeOptions}>
                <SelectTrigger aria-label={t("brandPage.route")} className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {routeOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {days.map((d) => {
            const shown = matching.filter((x) => x.date === d);
            return (
              <TabsContent key={d} value={d}>
                {shown.length === 0 ? (
                  <Card className="px-5 text-center text-sm text-slate-500">
                    {t("brandPage.noTripsThatDay")}
                  </Card>
                ) : (
                  <Card className="py-0">
                    <ul className="divide-y divide-slate-100">
                      {shown.map((trip) => (
                        <TripRow
                          key={trip.tripId}
                          trip={trip}
                          route={routeById.get(trip.routeId)}
                        />
                      ))}
                    </ul>
                  </Card>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </HomeSection>
  );
}

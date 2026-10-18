"use client";

/**
 * ShareTripCard — what is being shared, as the recipient will see it: the
 * operator, the route, when it leaves, the vehicle and the starting price,
 * then the short link.
 */

import { formatCurrency, formatDateVN, formatTimeVN } from "@spa/lib/format";
import { useT } from "@spa/lib/i18n";
import { ArrowRight, Star } from "lucide-react";
import type { ShareTrip } from "@spa/stores/ui";

export function ShareTripCard({
  shareTripData: trip,
  shareInfo,
  currency,
}: {
  shareTripData: ShareTrip;
  shareInfo: { code: string; url: string };
  currency: "VND" | "USD";
}) {
  const t = useT();
  const time = trip.departureTime || (trip.departureAt ? formatTimeVN(trip.departureAt) : "");
  const day = trip.departureAt
    ? formatDateVN(trip.departureAt, { weekday: "short", day: "2-digit", month: "2-digit" })
    : "";
  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="p-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">
            {trip.brandName}
          </span>
          {trip.brandRating ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-slate-700">
              <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
              {trip.brandRating.toFixed(1)}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
          <span className="min-w-0 truncate">{trip.fromName}</span>
          <ArrowRight className="size-4 shrink-0 text-slate-400" aria-hidden />
          <span className="min-w-0 truncate">{trip.toName}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {[time, day, trip.vehicleTypeLabel || t("trips.defaultVehicleType")]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="text-xs text-slate-500">{t("common.fromPrice")}</span>
          <span className="text-xl font-bold text-primary tabular-nums">
            {formatCurrency(trip.minPrice, currency)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-dashed border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">
        <span className="shrink-0 font-mono font-semibold text-slate-700">{shareInfo.code}</span>
        <span className="min-w-0 truncate">{shareInfo.url}</span>
      </div>
    </div>
  );
}

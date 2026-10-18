import { ArrowLeftRight, ArrowRight } from "lucide-react";
import { useT } from "@spa/lib/i18n";
import type { Leg, SearchParams } from "@spa/lib/search-params";
import { cn } from "@spa/lib/utils";

/** `YYYY-MM-DD` → `dd/MM`, as the date strip shows days. */
const dayMonth = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;

/** A round trip's two legs, each searched on its own: outbound, then the way back. */
export function LegTabs({ search, onPick }: { search: SearchParams; onPick: (leg: Leg) => void }) {
  const t = useT();
  const legs = [
    {
      leg: "out",
      label: t("searchPage.legOut"),
      from: search.from,
      to: search.to,
      day: search.date,
    },
    {
      leg: "return",
      label: t("searchPage.legReturn"),
      from: search.to,
      to: search.from,
      day: search.returnDate,
    },
  ] as const;

  return (
    <div role="tablist" aria-label={t("search.roundTrip")} className="grid grid-cols-2 gap-2">
      {legs.map(({ leg, label, from, to, day }) => {
        const active = search.leg === leg;
        const Icon = leg === "out" ? ArrowRight : ArrowLeftRight;
        return (
          <button
            key={leg}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onPick(leg)}
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
              active
                ? "border-primary bg-primary/5"
                : "border-slate-200 bg-white hover:border-primary/40",
            )}
          >
            <span
              className={cn(
                "hidden size-8 shrink-0 place-items-center rounded-lg sm:grid",
                active ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-500",
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span
                  className={cn(
                    "text-xs font-bold tracking-wide uppercase",
                    active ? "text-primary" : "text-slate-500",
                  )}
                >
                  {label}
                </span>
                <span className="truncate text-xs text-slate-500 tabular-nums">
                  {dayMonth(day)}
                </span>
              </span>
              <span className="block truncate text-sm font-semibold text-slate-900">
                {from} → {to}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDateVN } from "@spa/lib/format";
import { useT } from "@spa/lib/i18n";
import { vnDate } from "@spa/lib/search-params";
import { cn } from "@spa/lib/utils";

const DAYS = 7;

/** `YYYY-MM-DD` plus `n` days (calendar arithmetic, time zone free). */
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A week of dates around the chosen one: change the travel day in one tap,
 * the way people compare "tonight or tomorrow morning". Never before today
 * (or `min`: a return leg never comes back before it left).
 */
export function DateStrip({
  date,
  onPick,
  min,
}: {
  date: string;
  onPick: (day: string) => void;
  /** Earliest day, `YYYY-MM-DD`; today when later or missing. */
  min?: string;
}) {
  const t = useT();
  const today = vnDate();
  const first = [today, min ?? ""].sort()[1];
  const start = [addDays(date, -3), first].sort()[1];
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));

  const step = (n: number) => {
    const next = addDays(date, n);
    if (next >= first) onPick(next);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={date <= first}
        aria-label={t("searchPage.previousDay")}
        className="hidden size-9 shrink-0 place-items-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition-colors hover:text-primary disabled:opacity-40 sm:grid"
      >
        <ChevronLeft className="size-4" />
      </button>
      {/* A sideways scroller clips vertically too: pills draw a border (inside their
          box, never a ring outside it) and the padding leaves room for the focus ring. */}
      <div className="-mx-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-4 py-1 scrollbar-none sm:-mx-1 sm:px-1">
        {days.map((day) => {
          const active = day === date;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              aria-pressed={active}
              className={cn(
                "flex min-w-17 flex-1 flex-col items-center rounded-xl border px-2 py-1.5 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-slate-200 bg-white text-slate-700 hover:border-primary/40",
              )}
            >
              <span
                className={cn(
                  "text-[11px]",
                  active ? "text-primary-foreground/85" : "text-slate-500",
                )}
              >
                {day === today ? t("searchPage.today") : formatDateVN(day, { weekday: "short" })}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {day.slice(8)}/{day.slice(5, 7)}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label={t("searchPage.nextDay")}
        className="hidden size-9 shrink-0 place-items-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition-colors hover:text-primary sm:grid"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

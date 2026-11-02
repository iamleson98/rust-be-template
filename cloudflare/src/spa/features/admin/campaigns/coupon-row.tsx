/** One coupon of the payouts table, with the signs of abuse to check before paying it. */
import { Check, CircleCheck, Network, Phone, UserPlus } from "lucide-react";
import type { AdminCouponOut } from "@spa/api";
import { Button } from "@spa/components/ui/button";
import { formatDayTime, useMoney } from "@spa/lib/format";
import { useT } from "@spa/lib/i18n";
import { cn } from "@spa/lib/utils";

export function Tick({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded border",
        on ? "border-primary bg-primary text-primary-foreground" : "border-slate-300 bg-background",
      )}
    >
      {on && <Check className="size-3" />}
    </span>
  );
}

/** One coupon: who claimed it, where it was used, the warning signs, and the decision. */
export function CouponRow({
  coupon: c,
  payable,
  picked,
  onPick,
  onReject,
}: {
  coupon: AdminCouponOut;
  payable: boolean;
  picked: boolean;
  onPick: () => void;
  onReject: () => void;
}) {
  const t = useT();
  const money = useMoney();
  const signs = [
    c.sharedPhone > 0 && {
      icon: Phone,
      text: t("adminCampaigns.flagSharedPhone", { count: c.sharedPhone }),
      tone: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
    },
    c.sharedIp > 0 && {
      icon: Network,
      text: t("adminCampaigns.flagSharedIp", { count: c.sharedIp }),
      tone: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
    },
    c.newAccount && {
      icon: UserPlus,
      text: t("adminCampaigns.flagNewAccount"),
      tone: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
    },
  ].filter((s) => !!s);

  return (
    <li className={cn("flex items-start gap-3 px-2 py-3", picked && "bg-primary/5")}>
      {payable && (
        <button
          type="button"
          role="checkbox"
          aria-checked={picked}
          aria-label={c.code}
          onClick={onPick}
          className="mt-0.5"
        >
          <Tick on={picked} />
        </button>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <code className="font-mono text-xs font-bold tracking-wide">{c.code}</code>
          <span className="text-sm font-semibold tabular-nums">{money(c.amount)}</span>
          <span className="truncate text-xs text-muted-foreground">{c.campaignName}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {c.owner ? `${c.owner.name} · ${c.owner.email}` : "—"}
          {c.booking && (
            <>
              {" · "}
              {t("adminCampaigns.colBooking")}{" "}
              <span className="font-mono font-semibold text-foreground">{c.booking.code}</span>
            </>
          )}
          {c.brand && ` · ${c.brand.name}`}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {c.settledAt
            ? `${t("adminCampaigns.status." + c.status)} ${formatDayTime(c.settledAt)}${c.settlementNote ? ` · ${c.settlementNote}` : ""}`
            : c.redeemedAt
              ? `${t("adminCampaigns.tripDone")} ${formatDayTime(c.redeemedAt)}`
              : `${t("adminCampaigns.claimedAt")} ${formatDayTime(c.claimedAt)}`}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {signs.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
              <CircleCheck className="size-3" aria-hidden />
              {t("adminCampaigns.noFlags")}
            </span>
          ) : (
            signs.map((s) => (
              <span
                key={s.text}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                  s.tone,
                )}
              >
                <s.icon className="size-3" aria-hidden />
                {s.text}
              </span>
            ))
          )}
        </div>
      </div>
      {payable && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          onClick={onReject}
        >
          {t("adminCampaigns.reject")}
        </Button>
      )}
    </li>
  );
}
